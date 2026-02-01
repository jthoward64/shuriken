//! MKCALENDAR method handler for `CalDAV` calendar collection creation.

#![allow(clippy::manual_let_else)]
#![allow(clippy::single_match_else)]

use salvo::http::StatusCode;
use salvo::{Depot, Request, Response, handler};

use crate::app::api::dav::extract::auth::get_auth_context;
use crate::app::api::dav::util::build_full_url;
use shuriken_rfc::rfc::dav::parse::{MkcolRequest, parse_mkcol};
use shuriken_service::auth::{
    Action, PathSegment, ResourceIdentifier, ResourceLocation, get_resolved_location_from_depot,
};
use shuriken_service::dav::service::collection::{CreateCollectionContext, create_collection};

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

    if let Err(e) = authorizer.require(&subjects, &parent_resource, Action::Edit) {
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

    // Extract slug from path (last segment), trimming trailing slashes
    let slug = path
        .trim_end_matches('/')
        .split('/')
        .next_back()
        .unwrap_or("calendar")
        .to_string();

    tracing::debug!(path = %path, slug = %slug, "Extracted slug from MKCALENDAR path");

    // Get owner principal ID from authenticated subjects
    let owner_principal_id = match extract_owner_principal_id(&subjects) {
        Ok(id) => id,
        Err(e) => {
            tracing::error!(error = %e, "Failed to extract owner principal ID");
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };

    // Create collection context
    let ctx = CreateCollectionContext {
        owner_principal_id,
        slug,
        collection_type: shuriken_db::db::enums::CollectionType::Calendar,
        displayname: parsed_request.displayname,
        description: parsed_request.description,
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
            // Check if it's a conflict (already exists)
            if e.to_string().contains("duplicate") || e.to_string().contains("exists") {
                res.status_code(StatusCode::CONFLICT);
            } else {
                res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            }
        }
    }
}

/// Extracts owner principal ID from auth context.
fn extract_owner_principal_id(
    subjects: &shuriken_service::auth::ExpandedSubjects,
) -> anyhow::Result<uuid::Uuid> {
    use shuriken_service::auth::Subject;

    // The first subject should be the user's principal
    for subject in subjects.iter() {
        if let Subject::Principal(id) = subject {
            return Ok(*id);
        }
    }

    anyhow::bail!("No authenticated principal found in subjects")
}
