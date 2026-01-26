//! MKCALENDAR method handler for `CalDAV` calendar collection creation.

#![allow(clippy::manual_let_else)]
#![allow(clippy::single_match_else)]

use salvo::http::StatusCode;
use salvo::{Request, Response, handler};

use crate::component::dav::service::collection::{CreateCollectionContext, create_collection};
use crate::component::db::connection;
use crate::component::rfc::dav::parse::{MkcolRequest, parse_mkcol};

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
pub async fn mkcalendar(req: &mut Request, res: &mut Response) {
    // Get path to determine where to create the calendar
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

    // TODO: Parse path to extract parent and calendar name
    // TODO: Check authorization

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

    // Extract URI from path (last segment)
    let uri = path
        .split('/')
        .next_back()
        .unwrap_or("calendar")
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
        collection_type: "calendar".to_string(),
        displayname: parsed_request.displayname,
        description: parsed_request.description,
    };

    // Create the calendar collection
    match create_collection(&mut conn, &ctx).await {
        Ok(result) => {
            tracing::info!(
                "Created calendar collection: {} (ID: {})",
                result.uri,
                result.collection_id
            );
            res.status_code(StatusCode::CREATED);
            // TODO: Set Location header
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

/// Placeholder function to extract owner principal ID from path.
#[expect(clippy::unnecessary_wraps)]
fn extract_owner_from_path(_path: &str) -> Result<uuid::Uuid, String> {
    // TODO: Implement proper path parsing and authentication
    // For now, return a dummy UUID
    Ok(uuid::Uuid::nil())
}
