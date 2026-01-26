//! MOVE method handler for `WebDAV` resource moving.

#![allow(clippy::single_match_else)]

use diesel_async::AsyncConnection;
use diesel_async::scoped_futures::ScopedFutureExt;
use salvo::http::StatusCode;
use salvo::{Request, Response, handler};

use crate::component::db::connection::{self, DbConnection};
use crate::component::db::query::dav::{collection, instance};
use crate::component::model::dav::instance::NewDavInstance;
use crate::component::model::dav::tombstone::NewDavTombstone;
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
    let overwrite = match req.headers().get("Overwrite") {
        Some(header) => header.to_str().unwrap_or("T") == "T",
        None => true,
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

    if source_collection_id.is_nil() || dest_collection_id.is_nil() {
        res.status_code(StatusCode::NOT_FOUND);
        return;
    }

    // Get database connection
    let mut conn = match connection::connect().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::error!("Failed to get database connection: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
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

    // Perform the move operation
    match perform_move(
        &mut conn,
        source_collection_id,
        &source_uri,
        dest_collection_id,
        &dest_uri,
        overwrite,
    )
    .await
    {
        Ok(MoveResult::Created) => {
            res.status_code(StatusCode::CREATED);
            if let Err(e) = res.add_header("Location", &destination, true) {
                tracing::error!(error = %e, "Failed to set Location header");
            }
        }
        Ok(MoveResult::NoContent) => {
            res.status_code(StatusCode::NO_CONTENT);
        }
        Err(MoveError::SourceNotFound) => {
            tracing::warn!("Source resource not found for MOVE");
            res.status_code(StatusCode::NOT_FOUND);
        }
        Err(MoveError::DestinationExists) => {
            tracing::warn!("Destination exists and overwrite is false");
            res.status_code(StatusCode::PRECONDITION_FAILED);
        }
        Err(MoveError::DatabaseError(e)) => {
            tracing::error!(error = %e, "Database error during MOVE");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
        }
    }
}

/// Result of a MOVE operation.
enum MoveResult {
    /// Resource was created at destination (201 Created).
    Created,
    /// Resource was replaced at destination (204 No Content).
    NoContent,
}

/// Errors that can occur during a MOVE operation.
enum MoveError {
    /// Source resource was not found.
    SourceNotFound,
    /// Destination exists and overwrite is false.
    DestinationExists,
    /// Database operation failed.
    DatabaseError(anyhow::Error),
}

impl From<diesel::result::Error> for MoveError {
    fn from(e: diesel::result::Error) -> Self {
        match e {
            diesel::result::Error::NotFound => Self::SourceNotFound,
            _ => Self::DatabaseError(anyhow::Error::from(e)),
        }
    }
}

/// ## Summary
/// Performs the MOVE operation by creating a new instance at destination
/// and soft-deleting the source instance with a tombstone.
///
/// ## Side Effects
/// - Creates new instance at destination
/// - Soft-deletes source instance
/// - Creates tombstone for source
/// - Updates sync tokens for both collections
///
/// ## Errors
/// Returns `MoveError` if source not found, destination exists (and overwrite is false),
/// or database operations fail.
#[tracing::instrument(skip(conn))]
#[expect(clippy::too_many_arguments)]
#[expect(clippy::too_many_lines)]
async fn perform_move(
    conn: &mut DbConnection<'_>,
    source_collection_id: uuid::Uuid,
    source_uri: &str,
    dest_collection_id: uuid::Uuid,
    dest_uri: &str,
    overwrite: bool,
) -> Result<MoveResult, MoveError> {
    use diesel::prelude::*;
    use diesel_async::RunQueryDsl;

    tracing::debug!("Performing MOVE operation");

    let source_uri = source_uri.to_string();
    let dest_uri = dest_uri.to_string();

    conn.transaction::<_, MoveError, _>(move |tx| {
        let source_uri = source_uri.clone();
        let dest_uri = dest_uri.clone();

        async move {
            // Load source instance
            let source_instance =
                instance::by_collection_and_uri(source_collection_id, &source_uri)
                    .select(crate::component::model::dav::instance::DavInstance::as_select())
                    .first(tx)
                    .await?;

            tracing::debug!(
                source_instance_id = %source_instance.id,
                entity_id = %source_instance.entity_id,
                "Loaded source instance"
            );

            // Check if destination exists
            let dest_exists = instance::by_collection_and_uri(dest_collection_id, &dest_uri)
                .select(diesel::dsl::count(
                    crate::component::db::schema::dav_instance::id,
                ))
                .first::<i64>(tx)
                .await
                .map_err(|e| MoveError::DatabaseError(anyhow::Error::from(e)))?
                > 0;

            if dest_exists && !overwrite {
                return Err(MoveError::DestinationExists);
            }

            // Determine result status
            let result = if dest_exists {
                MoveResult::NoContent
            } else {
                MoveResult::Created
            };

            // If destination exists and overwrite is true, soft-delete it first
            if dest_exists {
                let dest_instance = instance::by_collection_and_uri(dest_collection_id, &dest_uri)
                    .select(crate::component::model::dav::instance::DavInstance::as_select())
                    .first(tx)
                    .await
                    .map_err(|e| MoveError::DatabaseError(anyhow::Error::from(e)))?;

                instance::soft_delete_instance(tx, dest_instance.id)
                    .await
                    .map_err(|e| MoveError::DatabaseError(anyhow::Error::from(e)))?;
            }

            // Update sync tokens for both collections first, then use the new values
            let new_dest_synctoken = collection::update_synctoken(tx, dest_collection_id)
                .await
                .map_err(|e| MoveError::DatabaseError(anyhow::Error::from(e)))?;

            let new_source_synctoken = collection::update_synctoken(tx, source_collection_id)
                .await
                .map_err(|e| MoveError::DatabaseError(anyhow::Error::from(e)))?;

            tracing::debug!(
                new_dest_synctoken,
                new_source_synctoken,
                "Updated sync tokens for both collections"
            );

            // Create new instance at destination with updated sync revision
            let new_sync_revision = new_dest_synctoken;
            // Keep the same ETag since content hasn't changed
            let new_etag = &source_instance.etag;
            let now = chrono::Utc::now();

            let new_instance = NewDavInstance {
                collection_id: dest_collection_id,
                entity_id: source_instance.entity_id,
                uri: &dest_uri,
                content_type: &source_instance.content_type,
                etag: new_etag,
                sync_revision: new_sync_revision,
                last_modified: now,
            };

            instance::create_instance(tx, &new_instance)
                .await
                .map_err(|e| MoveError::DatabaseError(anyhow::Error::from(e)))?;

            tracing::debug!("Created new instance at destination");

            // Soft-delete source instance
            instance::soft_delete_instance(tx, source_instance.id)
                .await
                .map_err(|e| MoveError::DatabaseError(anyhow::Error::from(e)))?;

            tracing::debug!("Soft-deleted source instance");

            // Create tombstone for source with updated synctoken
            let tombstone = NewDavTombstone {
                collection_id: source_collection_id,
                uri: &source_uri,
                entity_id: Some(source_instance.entity_id),
                synctoken: new_source_synctoken,
                sync_revision: source_instance.sync_revision,
                deleted_at: now,
                last_etag: Some(&source_instance.etag),
                logical_uid: None,
            };

            instance::create_tombstone(tx, &tombstone)
                .await
                .map_err(|e| MoveError::DatabaseError(anyhow::Error::from(e)))?;

            tracing::debug!("Created tombstone for source");

            Ok(result)
        }
        .scope_boxed()
    })
    .await
}
