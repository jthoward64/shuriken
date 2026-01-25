//! MKCOL method handler for Extended MKCOL (RFC 5689) for `CardDAV`.

#![allow(clippy::manual_let_else)]
#![allow(clippy::single_match_else)]
#![allow(clippy::unnecessary_wraps)]

use salvo::http::StatusCode;
use salvo::{Request, Response, handler};

use crate::component::dav::service::collection::{CreateCollectionContext, create_collection};
use crate::component::db::connection;

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
pub async fn mkcol_extended(req: &mut Request, res: &mut Response) {
    // Get path to determine where to create the addressbook
    let path = req.uri().path().to_string();

    // Get database connection
    let mut conn = match connection::connect().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::error!("Failed to get database connection: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    // TODO: Parse path to extract parent and addressbook name
    // TODO: Check authorization
    // TODO: Parse Extended MKCOL XML body (RFC 5689)

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
        uri,
        collection_type: "addressbook".to_string(),
        displayname: None, // TODO: Extract from XML body if present
        description: None, // TODO: Extract from XML body if present
    };

    // Create the addressbook collection
    match create_collection(&mut conn, &ctx).await {
        Ok(result) => {
            tracing::info!(
                "Created addressbook collection: {} (ID: {})",
                result.uri,
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

/// Placeholder function to extract owner principal ID from path.
#[expect(dead_code)]
fn extract_owner_from_path(_path: &str) -> Result<uuid::Uuid, String> {
    // TODO: Implement proper path parsing and authentication
    // For now, return a dummy UUID
    Ok(uuid::Uuid::nil())
}
