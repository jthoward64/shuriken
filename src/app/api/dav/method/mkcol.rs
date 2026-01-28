//! MKCOL method handler for WebDAV collection creation.

use salvo::http::StatusCode;
use salvo::{Depot, Request, Response, handler};

use crate::app::api::dav::extract::auth::get_auth_context;
use crate::component::auth::{Action, ResourceType, get_resolved_location_from_depot};
use crate::component::dav::service::collection::{CreateCollectionContext, create_collection};
use crate::component::db::connection;
use crate::component::rfc::dav::parse::{MkcolRequest, parse_mkcol};

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
    let provider = match connection::get_db_from_depot(depot) {
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

    let parent_resource = match get_resolved_location_from_depot(depot) {
        Ok(loc) => loc,
        Err(_) => {
            tracing::warn!(path = %path, "Resource location not found in depot");
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };

    if let Err(e) = authorizer.require(&subjects, parent_resource, Action::Edit) {
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

    // Determine collection type from path context
    let collection_type = match determine_collection_type(&path, &parsed_request) {
        Ok(ctype) => ctype,
        Err(e) => {
            tracing::error!(error = %e, "Failed to determine collection type");
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };

    // Extract slug from path (last segment)
    let slug = path
        .trim_end_matches('/')
        .split('/')
        .last()
        .unwrap_or("collection")
        .to_string();

    // Get owner principal ID from auth context
    let owner_principal_id = match extract_owner_principal_id(depot, &subjects) {
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
        slug: slug.clone(),
        collection_type,
        displayname: parsed_request.displayname,
        description: parsed_request.description,
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
            if e.to_string().contains("duplicate") || e.to_string().contains("exists") {
                res.status_code(StatusCode::CONFLICT);
            } else {
                res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            }
        }
    }
}

/// Determines collection type from path context and request body.
fn determine_collection_type(path: &str, request: &MkcolRequest) -> anyhow::Result<String> {
    // Check if request specifies resourcetype
    if let Some(rt) = &request.resource_type {
        if rt.contains("calendar") {
            return Ok("calendar".to_string());
        } else if rt.contains("addressbook") {
            return Ok("addressbook".to_string());
        }
    }

    // Infer from path context
    if path.contains("/cal/") {
        Ok("collection".to_string()) // Plain collection in calendar context
    } else if path.contains("/card/") {
        Ok("collection".to_string()) // Plain collection in addressbook context
    } else {
        Ok("collection".to_string()) // Generic collection
    }
}

/// Extracts owner principal ID from auth context.
fn extract_owner_principal_id(
    _depot: &Depot,
    subjects: &crate::component::auth::ExpandedSubjects,
) -> anyhow::Result<uuid::Uuid> {
    use crate::component::auth::Subject;

    // The first subject should be the user's principal
    for subject in subjects.iter() {
        if let Subject::Principal(id) = subject {
            return Ok(*id);
        }
    }

    anyhow::bail!("No authenticated principal found in subjects")
}
