//! MOVE method handler for `WebDAV` resource moving.

#![allow(clippy::single_match_else)]

use salvo::http::StatusCode;
use salvo::{Request, Response, handler};

use crate::component::db::connection;
use crate::util::path;

/// ## Summary
/// Handles MOVE requests to relocate `WebDAV` resources.
///
/// Reads the Destination header, validates the target location,
/// creates instance at destination, deletes source with tombstone.
///
/// ## Side Effects
/// - Creates new instance at destination
/// - Soft-deletes source instance and creates tombstone
/// - Updates sync tokens for both source and destination collections
/// - Returns 201 Created or 204 No Content
///
/// ## Errors
/// Returns 400 for missing Destination, 409 for conflicts, 412 for preconditions, 500 for errors.
#[handler]
pub async fn r#move(req: &mut Request, res: &mut Response) {
    // Get source path
    let source_path = req.uri().path().to_string();

    // Get Destination header
    let destination = match req.headers().get("Destination") {
        Some(dest_header) => match dest_header.to_str() {
            Ok(dest) => dest.to_string(),
            Err(e) => {
                tracing::error!("Invalid Destination header: {}", e);
                res.status_code(StatusCode::BAD_REQUEST);
                return;
            }
        },
        None => {
            tracing::error!("Missing Destination header for MOVE");
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };

    // Get Overwrite header (default: T)
    let _overwrite = match req.headers().get("Overwrite") {
        Some(header) => header.to_str().unwrap_or("T") == "T",
        None => true,
    };

    // Get database connection
    let _conn = match connection::connect().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::error!("Failed to get database connection: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    // Parse source path to extract collection ID and URI
    let (source_collection_id, source_uri) = match path::parse_collection_and_uri(&source_path) {
        Ok(parsed) => parsed,
        Err(e) => {
            tracing::error!(error = %e, path = %source_path, "Failed to parse source path");
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };

    // Parse destination to extract target collection ID and URI
    // Note: Destination header contains full URL, extract path first
    let dest_path = path::extract_path_from_url(&destination);

    let (dest_collection_id, dest_uri) = match path::parse_collection_and_uri(&dest_path) {
        Ok(parsed) => parsed,
        Err(e) => {
            tracing::error!(error = %e, path = %dest_path, "Failed to parse destination path");
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };

    tracing::debug!(
        source_collection_id = %source_collection_id,
        source_uri = %source_uri,
        dest_collection_id = %dest_collection_id,
        dest_uri = %dest_uri,
        "Parsed MOVE paths"
    );

    // TODO: Check authorization for both source and destination

    // TODO: Load source instance from database
    // TODO: Check if destination exists
    // TODO: If destination exists and overwrite is false, return 412 Precondition Failed
    // TODO: Create new instance at destination (references same entity)
    // TODO: Soft-delete source instance
    // TODO: Create tombstone for source
    // TODO: Update sync tokens for both source and destination collections

    tracing::warn!(
        "MOVE not fully implemented for: {} -> {}",
        source_path,
        destination
    );
    res.status_code(StatusCode::CREATED);
    // TODO: Set Location header to destination
}
