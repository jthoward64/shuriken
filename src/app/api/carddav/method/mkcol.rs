//! MKCOL method handler for Extended MKCOL (RFC 5689) for `CardDAV`.

#![allow(clippy::manual_let_else)]
#![allow(clippy::single_match_else)]

use salvo::http::StatusCode;
use salvo::{Depot, Request, Response, handler};

use crate::app::api::dav::extract::auth::{get_auth_context, resource_id_for};
use crate::component::auth::{Action, ResourceType};
use crate::component::dav::service::collection::{CreateCollectionContext, create_collection};
use crate::component::db::connection;
use crate::component::rfc::dav::parse::{MkcolRequest, parse_mkcol};

/// ## Summary
/// Handles Extended MKCOL requests to create addressbook collections.
///
/// Parses the Extended MKCOL XML request body (RFC 5689) with resourcetype and properties,
/// creates an addressbook collection in the database, and sets the resourcetype.
///
/// ## Side Effects
/// - Creates addressbook collection in database
/// - Sets DAV:resourcetype to include DAV:collection and CARDDAV:addressbook
/// - Applies initial properties (displayname, addressbook-description, etc.)
/// - Returns 201 Created
///
/// ## Errors
/// Returns 400 for invalid XML, 403 for authorization failures, 409 if exists, 500 for errors.
#[handler]
pub async fn mkcol_extended(req: &mut Request, res: &mut Response, depot: &Depot) {
    // Get path to determine where to create the addressbook
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

    // Check authorization: user must have Edit (write) permission on parent collection
    let (subjects, authorizer) = match get_auth_context(depot, &mut conn).await {
        Ok(ctx) => ctx,
        Err(status) => {
            res.status_code(status);
            return;
        }
    };

    // Build a resource ID for the parent collection (user's addressbooks namespace)
    let parent_resource = match extract_resource_type_from_path(&path) {
        Some(resource_type) => resource_id_for(resource_type, uuid::Uuid::nil(), None),
        None => {
            tracing::warn!(path = %path, "Cannot determine resource type from path");
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };

    if let Err(e) = authorizer.require(&subjects, &parent_resource, Action::Edit) {
        tracing::debug!(error = %e, "Authorization denied for MKCOL");
        res.status_code(StatusCode::FORBIDDEN);
        return;
    }

    // Parse Extended MKCOL XML body (RFC 5689)
    let body = req.payload().await;
    let parsed_request = match body {
        Ok(bytes) if !bytes.is_empty() => match parse_mkcol(bytes) {
            Ok(request) => request,
            Err(e) => {
                tracing::error!("Failed to parse Extended MKCOL body: {}", e);
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

    // Extract URI from path (last segment)
    let uri = path
        .split('/')
        .next_back()
        .unwrap_or("addressbook")
        .to_string();

    // TODO: Get authenticated user's principal ID
    // For now, use a placeholder
    let owner_principal_id = match extract_owner_from_path(&path) {
        Ok(id) => id,
        Err(_) => {
            tracing::error!("Failed to extract owner from path: {}", path);
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };

    // Create collection context
    let ctx = CreateCollectionContext {
        owner_principal_id,
        slug: uri,
        collection_type: "addressbook".to_string(),
        displayname: parsed_request.displayname,
        description: parsed_request.description,
    };

    // Create the addressbook collection
    match create_collection(&mut conn, &ctx).await {
        Ok(result) => {
            tracing::info!(
                "Created addressbook collection: {} (ID: {})",
                result.slug,
                result.collection_id
            );
            res.status_code(StatusCode::CREATED);
            // TODO: Set Location header
        }
        Err(e) => {
            tracing::error!("Failed to create addressbook collection: {}", e);
            // Check if it's a conflict (already exists)
            if e.to_string().contains("duplicate") || e.to_string().contains("exists") {
                res.status_code(StatusCode::CONFLICT);
            } else {
                res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            }
        }
    }
}

/// Extract resource type from path.
fn extract_resource_type_from_path(path: &str) -> Option<ResourceType> {
    if path.contains("/calendars/") {
        Some(ResourceType::Calendar)
    } else if path.contains("/addressbooks/") {
        Some(ResourceType::Addressbook)
    } else {
        None
    }
}

/// Placeholder function to extract owner principal ID from path.
#[expect(clippy::unnecessary_wraps)]
fn extract_owner_from_path(_path: &str) -> Result<uuid::Uuid, String> {
    // TODO: Implement proper path parsing and authentication
    // For now, return a dummy UUID
    Ok(uuid::Uuid::nil())
}
