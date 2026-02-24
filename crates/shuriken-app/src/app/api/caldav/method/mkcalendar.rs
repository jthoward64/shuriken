//! MKCALENDAR method handler for `CalDAV` calendar collection creation.

#![allow(clippy::manual_let_else)]
#![allow(clippy::single_match_else)]

use salvo::http::StatusCode;
use salvo::{Depot, Request, Response, handler};

use crate::app::api::dav::extract::auth::get_auth_context;
use crate::app::api::dav::response::error::write_precondition_error;
use crate::app::api::dav::util::{build_full_url, owner_principal_id_from_subjects};
use shuriken_db::db::enums::CollectionType;
use shuriken_rfc::rfc::dav::core::PreconditionError;
use shuriken_rfc::rfc::dav::parse::{MkcolRequest, parse_mkcol};
use shuriken_service::auth::{
    Action, PathSegment, ResourceIdentifier, ResourceLocation, get_collection_chain_from_depot,
    get_resolved_location_from_depot, get_terminal_collection_from_depot,
};
use shuriken_service::dav::service::collection::{CreateCollectionContext, create_collection};
use shuriken_service::error::ServiceError;

/// ## Summary
/// Handles MKCALENDAR requests to create calendar collections.
///
/// Parses the optional MKCALENDAR XML request body with initial properties,
/// creates a calendar collection in the database, and sets the resourcetype.
///
/// ## Side Effects
/// - Creates calendar collection in database
/// - Sets DAV:resourcetype to include DAV:collection and CALDAV:calendar
/// - Applies initial properties (displayname, description, timezone, etc.)
/// - Returns 201 Created
///
/// ## Errors
/// Returns 400 for invalid XML, 403 for authorization failures, 409 if exists, 500 for errors.
#[handler]
#[tracing::instrument(skip_all, fields(path = %req.uri().path()))]
pub async fn mkcalendar(req: &mut Request, res: &mut Response, depot: &Depot) {
    // Get path to determine where to create the calendar
    let path = req.uri().path().to_string();

    // Get database connection
    let provider = match crate::db_handler::get_db_from_depot(depot) {
        Ok(provider) => provider,
        Err(e) => {
            tracing::error!("Failed to get database provider: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    let mut conn = match provider.get_connection().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::error!("Failed to get database connection: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    // Check authorization: user must have Edit (write) permission on parent collection
    let (subjects, authorizer) = match get_auth_context(depot, &mut conn).await {
        Ok(ctx) => ctx,
        Err(status) => {
            res.status_code(status);
            return;
        }
    };

    // For MKCALENDAR, authorize against the parent, not the resource itself
    // (which doesn't exist yet). Try to get the resolved location (parent),
    // or fall back to constructing it from the path location.
    let parent_resource = if let Ok(loc) = get_resolved_location_from_depot(depot) {
        // If resolved location exists, it's the parent
        tracing::debug!(path = %path, "Using resolved parent location for MKCALENDAR authorization");
        loc.clone()
    } else {
        // Otherwise, construct parent path from original location
        use shuriken_service::auth::depot::get_path_location_from_depot;

        let path_loc = match get_path_location_from_depot(depot) {
            Ok(loc) => loc.clone(),
            Err(_) => {
                tracing::warn!(path = %path, "Neither resolved nor path location found in depot");
                res.status_code(StatusCode::NOT_FOUND);
                return;
            }
        };

        // Build parent location by removing the last collection segment
        let segments = path_loc.segments();
        let parent_segments: Vec<_> = segments
            .iter()
            .take(segments.len().saturating_sub(1))
            .cloned()
            .collect();

        if parent_segments.is_empty() {
            tracing::warn!(path = %path, "Cannot determine parent resource for MKCALENDAR");
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }

        tracing::debug!(path = %path, parent_segment_count = parent_segments.len(), "Constructed parent path for MKCALENDAR authorization");
        match ResourceLocation::from_segments(parent_segments) {
            Ok(resource) => resource,
            Err(e) => {
                tracing::error!(error = %e, "Failed to build parent resource for MKCALENDAR authorization");
                res.status_code(StatusCode::BAD_REQUEST);
                return;
            }
        }
    };

    // Extract slug from path early so it can be used for the auth resource below.
    let slug = path
        .trim_end_matches('/')
        .split('/')
        .next_back()
        .unwrap_or("calendar")
        .to_string();

    // When the parent resource only has [ResourceType, Owner] segments (creating a top-level
    // collection), the path e.g. `/calendars/<uuid>` does not glob-match the Casbin policy
    // `/calendars/<uuid>/**`. Include the new collection slug so the path becomes
    // `/calendars/<uuid>/caltest1` which does match.
    let auth_resource = if parent_resource.segments().len() == 2 {
        let mut segments = parent_resource.segments().to_vec();
        segments.push(PathSegment::Collection(ResourceIdentifier::Slug(slug.clone())));
        ResourceLocation::from_segments(segments).unwrap_or_else(|_| parent_resource.clone())
    } else {
        parent_resource.clone()
    };

    if let Err(e) = authorizer.require(&subjects, &auth_resource, Action::Edit) {
        tracing::debug!(error = %e, "Authorization denied for MKCALENDAR");
        res.status_code(StatusCode::FORBIDDEN);
        return;
    }

    // Parse optional MKCALENDAR XML body for initial properties
    let body = req.payload().await;
    let parsed_request = match body {
        Ok(bytes) if !bytes.is_empty() => match parse_mkcol(bytes) {
            Ok(request) => request,
            Err(e) => {
                tracing::error!("Failed to parse MKCALENDAR body: {}", e);
                res.status_code(StatusCode::BAD_REQUEST);
                return;
            }
        },
        Ok(_) => {
            // Empty body - no initial properties
            MkcolRequest::default()
        }
        Err(e) => {
            tracing::error!("Failed to read request body: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    // Reject requests that contain server-computed (protected) properties like
    // DAV:getetag. Per RFC 5689 §3, the server MUST return a failure response
    // when a requested property cannot be set. We return 422 Unprocessable Entity.
    if parsed_request.has_protected_props {
        tracing::debug!(path = %path, "Rejecting MKCALENDAR: body contains non-settable properties");
        res.status_code(StatusCode::UNPROCESSABLE_ENTITY);
        return;
    }

    tracing::debug!(path = %path, slug = %slug, "Extracted slug from MKCALENDAR path");

    // Get owner principal ID from authenticated subjects
    let owner_principal_id = match owner_principal_id_from_subjects(&subjects) {
        Ok(id) => id,
        Err(e) => {
            tracing::error!(error = %e, "Failed to extract owner principal ID");
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };

    // Check that we're not trying to create a calendar inside an existing calendar.
    // RFC 4791 §4.2 forbids nesting calendar collections inside other calendars.
    //
    // The TRUE PARENT of the collection being created is:
    // - chain[-2] if the target collection is in the chain (target already exists)
    // - chain[-1] (terminal) if the target is NOT in the chain
    // This is always checked regardless of whether the target exists, because a
    // structural violation (parent is Calendar) takes priority over a conflict.
    let chain_opt = get_collection_chain_from_depot(depot).ok();
    let parent_collection = match get_terminal_collection_from_depot(depot) {
        Ok(_) => {
            // Target is in chain → parent is the second-to-last element
            chain_opt.and_then(|chain| {
                let n = chain.len();
                if n >= 2 {
                    chain.collections().get(n - 2).cloned()
                } else {
                    None
                }
            })
        }
        Err(_) => {
            // Target not in chain → the chain's terminal is the parent
            chain_opt.and_then(|chain| chain.terminal().cloned())
        }
    };
    if let Some(parent) = &parent_collection {
        if parent.collection_type == CollectionType::Calendar {
            tracing::debug!(path = %path, "Rejecting MKCALENDAR inside an existing calendar collection");
            write_precondition_error(res, &PreconditionError::CalendarCollectionLocationOk);
            return;
        }
    }
    let parent_collection_id = parent_collection.map(|c| c.id);

    // Create collection context
    let ctx = CreateCollectionContext {
        owner_principal_id,
        slug,
        collection_type: shuriken_db::db::enums::CollectionType::Calendar,
        displayname: parsed_request.displayname,
        description: parsed_request.description,
        parent_collection_id,
        supported_components: parsed_request.supported_components,
    };

    // Create the calendar collection
    match create_collection(&mut conn, &ctx).await {
        Ok(result) => {
            tracing::info!(
                "Created calendar collection: {} (ID: {})",
                result.slug,
                result.collection_id
            );
            res.status_code(StatusCode::CREATED);

            // Set Location header with full URL (RFC 4918 §8.10.4)
            let mut segments = parent_resource.segments().to_vec();
            segments.push(PathSegment::Collection(ResourceIdentifier::Id(
                result.collection_id,
            )));
            let location_resource = ResourceLocation::from_segments(segments).ok();
            let location = build_full_url(req, depot, location_resource.as_ref(), &path);

            #[expect(
                clippy::let_underscore_must_use,
                reason = "Location header addition failure is non-fatal"
            )]
            let _ = res.add_header("Location", location, true);
        }
        Err(e) => {
            tracing::error!("Failed to create calendar collection: {}", e);
            match e {
                ServiceError::Conflict(_) => {
                    write_precondition_error(res, &PreconditionError::ResourceMustBeNull);
                }
                _ => {
                    res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
                }
            }
        }
    }
}
