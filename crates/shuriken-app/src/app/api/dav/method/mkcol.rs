//! MKCOL method handler for WebDAV collection creation.

use salvo::http::StatusCode;
use salvo::{Depot, Request, Response, handler};

use crate::app::api::dav::extract::auth::get_auth_context;
use crate::app::api::dav::response::error::write_precondition_error;
use crate::app::api::dav::util::{owner_principal_id_from_subjects, resource_type_from_location};
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
/// Handles MKCOL requests to create WebDAV collections.
///
/// Supports both plain MKCOL (empty body) and Extended MKCOL (RFC 5689) with
/// resourcetype and initial properties.
///
/// ## Side Effects
/// - Creates collection in database
/// - Sets DAV:resourcetype based on request body or parent path type
/// - Applies initial properties (displayname, description, etc.)
/// - Returns 201 Created
///
/// ## Errors
/// Returns 400 for invalid XML, 403 for authorization failures, 409 if exists, 500 for errors.
#[handler]
pub async fn mkcol(req: &mut Request, res: &mut Response, depot: &Depot) {
    let path = req.uri().path().to_string();

    // Get database connection
    let provider = match crate::db_handler::get_db_from_depot(depot) {
        Ok(provider) => provider,
        Err(e) => {
            tracing::error!(error = %e, "Failed to get database provider");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    let mut conn = match provider.get_connection().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::error!(error = %e, "Failed to get database connection");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    // Check authorization: user must have Edit permission on parent
    let (subjects, authorizer) = match get_auth_context(depot, &mut conn).await {
        Ok(ctx) => ctx,
        Err(status) => {
            res.status_code(status);
            return;
        }
    };

    // For MKCOL, we need to authorize against the parent, not the resource itself
    // (which doesn't exist yet). Try to get the resolved location (parent),
    // or fall back to constructing it from the path location.
    let parent_resource = if let Ok(loc) = get_resolved_location_from_depot(depot) {
        // If resolved location exists, it's the parent
        tracing::debug!(path = %path, "Using resolved parent location for MKCOL authorization");
        loc.clone()
    } else {
        // Otherwise, construct parent path from original location
        use shuriken_service::auth::{ResourceLocation, depot::get_path_location_from_depot};

        let path_loc = if let Ok(loc) = get_path_location_from_depot(depot) {
            loc.clone()
        } else {
            tracing::warn!(path = %path, "Neither resolved nor path location found in depot");
            res.status_code(StatusCode::NOT_FOUND);
            return;
        };

        // Build parent location by removing the last collection segment
        let segments = path_loc.segments();
        let parent_segments: Vec<_> = segments
            .iter()
            .take(segments.len().saturating_sub(1))
            .cloned()
            .collect();

        if parent_segments.is_empty() {
            tracing::warn!(path = %path, "Cannot determine parent resource for MKCOL");
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }

        tracing::debug!(path = %path, parent_segment_count = parent_segments.len(), "Constructed parent path for MKCOL authorization");
        match ResourceLocation::from_segments(parent_segments) {
            Ok(resource) => resource,
            Err(e) => {
                tracing::error!(error = %e, "Failed to build parent resource for MKCOL authorization");
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
        .unwrap_or("collection")
        .to_string();

    // When the parent resource only has [ResourceType, Owner] segments (creating a top-level
    // collection), the path e.g. `/calendars/<uuid>` does not glob-match the Casbin policy
    // `/calendars/<uuid>/**`. Include the new collection slug so the path becomes
    // `/calendars/<uuid>/newcol` which does match.
    let auth_resource = if parent_resource.segments().len() == 2 {
        let mut segments = parent_resource.segments().to_vec();
        segments.push(PathSegment::Collection(ResourceIdentifier::Slug(slug.clone())));
        ResourceLocation::from_segments(segments).unwrap_or_else(|_| parent_resource.clone())
    } else {
        parent_resource.clone()
    };

    if let Err(e) = authorizer.require(&subjects, &auth_resource, Action::Edit) {
        tracing::debug!(error = %e, "Authorization denied for MKCOL");
        res.status_code(StatusCode::FORBIDDEN);
        return;
    }

    // Parse MKCOL XML body (RFC 5689) or empty for plain MKCOL
    let body = req.payload().await;
    let parsed_request = match body {
        Ok(bytes) if !bytes.is_empty() => match parse_mkcol(bytes) {
            Ok(request) => request,
            Err(e) => {
                tracing::error!("Failed to parse MKCOL body: {}", e);
                res.status_code(StatusCode::BAD_REQUEST);
                return;
            }
        },
        Ok(_) => {
            // Empty body - plain MKCOL (creates generic collection)
            MkcolRequest::default()
        }
        Err(e) => {
            tracing::error!("Failed to read request body: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    // Reject requests that contain server-computed (protected) properties.
    if parsed_request.has_protected_props {
        tracing::debug!(path = %path, "Rejecting MKCOL: body contains non-settable properties");
        res.status_code(StatusCode::UNPROCESSABLE_ENTITY);
        return;
    }

    // Determine collection type from path context
    let collection_type = determine_collection_type(&parent_resource, &parsed_request);

    tracing::debug!(path = %path, slug = %slug, "Extracted slug from MKCOL path");

    // Get owner principal ID from auth context
    let owner_principal_id = match owner_principal_id_from_subjects(&subjects) {
        Ok(id) => id,
        Err(e) => {
            tracing::error!(error = %e, "Failed to extract owner principal ID");
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };

    // Reject MKCOL inside a calendar collection — RFC 4791 §4.2 prohibits
    // creating any collection (including plain WebDAV collections) inside a
    // calendar collection.
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
            tracing::debug!(path = %path, "Rejecting MKCOL inside a calendar collection");
            write_precondition_error(res, &PreconditionError::CalendarCollectionLocationOk);
            return;
        }
    }
    let parent_collection_id = parent_collection.map(|c| c.id);

    // Create collection context
    let ctx = CreateCollectionContext {
        owner_principal_id,
        slug: slug.clone(),
        collection_type,
        displayname: parsed_request.displayname,
        description: parsed_request.description,
        parent_collection_id,
        supported_components: parsed_request.supported_components,
    };

    // Create the collection
    match create_collection(&mut conn, &ctx).await {
        Ok(result) => {
            tracing::info!(
                "Created collection: {} (ID: {})",
                result.slug,
                result.collection_id
            );
            res.status_code(StatusCode::CREATED);
        }
        Err(e) => {
            tracing::error!(error = %e, "Failed to create collection");
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

/// Determines collection type from path context and request body.
fn determine_collection_type(
    parent_resource: &shuriken_service::auth::ResourceLocation,
    request: &MkcolRequest,
) -> shuriken_db::db::enums::CollectionType {
    use shuriken_db::db::enums::CollectionType;

    // Check if request specifies resourcetype
    if let Some(rt) = &request.resource_type {
        if rt.contains("calendar") {
            return CollectionType::Calendar;
        }
        if rt.contains("addressbook") {
            return CollectionType::Addressbook;
        }
    }

    // Infer from resource type context
    match resource_type_from_location(parent_resource) {
        Some(shuriken_service::auth::ResourceType::Calendar) => CollectionType::Calendar,
        Some(shuriken_service::auth::ResourceType::Addressbook) => CollectionType::Addressbook,
        _ => CollectionType::Collection,
    }
}
