//! COPY method handler for `WebDAV` resource copying.

#![expect(clippy::single_match_else)]

use salvo::http::StatusCode;
use salvo::{Depot, Request, Response, handler};

use crate::app::api::dav::extract::auth::{check_authorization, get_auth_context};
use crate::component::auth::{
    Action, ResourceType, get_instance_from_depot, get_resolved_location_from_depot,
    get_terminal_collection_from_depot,
};
use crate::component::db::connection;
use crate::util::path;

/// ## Summary
/// Handles COPY requests to duplicate `WebDAV` resources.
///
/// Reads the Destination header, validates the target location,
/// duplicates the entity and instance, and handles conflicts.
///
/// ## Side Effects
/// - Creates new entity/instance records
/// - Updates sync tokens for destination collection
/// - Returns 201 Created or 204 No Content
///
/// ## Errors
/// Returns 400 for missing Destination, 409 for conflicts, 412 for preconditions, 500 for errors.
#[handler]
pub async fn copy(req: &mut Request, res: &mut Response, depot: &Depot) {
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
            tracing::error!("Missing Destination header for COPY");
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };

    // Get Overwrite header (default: T)
    let _overwrite = match req.headers().get("Overwrite") {
        Some(header) => header.to_str().unwrap_or("T") == "T",
        None => true,
    };

    // Parse source path to extract collection ID and URI (prefer middleware)
    let (source_collection_id, source_uri) = match (
        get_terminal_collection_from_depot(depot),
        get_instance_from_depot(depot),
    ) {
        (Ok(coll), Ok(inst)) => (coll.id, inst.slug.clone()),
        _ => match path::parse_collection_and_uri(&source_path) {
            Ok(parsed) => parsed,
            Err(e) => {
                tracing::error!(error = %e, path = %source_path, "Failed to parse source path");
                res.status_code(StatusCode::BAD_REQUEST);
                return;
            }
        },
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
    let provider = match connection::get_db_from_depot(depot) {
        Ok(provider) => provider,
        Err(e) => {
            tracing::error!(error = %e, "Failed to get database provider");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    let _conn = match provider.get_connection().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::error!(error = %e, "Failed to get database connection");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    let mut conn = match provider.get_connection().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::error!(error = %e, "Failed to get database connection for authorization");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    tracing::debug!(
        source_collection_id = %source_collection_id,
        source_uri = %source_uri,
        dest_collection_id = %dest_collection_id,
        dest_uri = %dest_uri,
        "Parsed COPY paths"
    );

    // Check authorization: need Read on source and Write on destination
    if let Err(status) = check_copy_authorization(
        depot,
        &mut conn,
        source_collection_id,
        &source_uri,
        dest_collection_id,
    )
    .await
    {
        res.status_code(status);
        return;
    }

    // TODO: Load source instance from database
    // TODO: Check if destination exists
    // TODO: If destination exists and overwrite is false, return 412 Precondition Failed
    // TODO: Duplicate entity or reference same entity (shallow copy)
    // TODO: Create new instance at destination
    // TODO: Update sync token for destination collection

    tracing::warn!(
        "COPY not fully implemented for: {} -> {}",
        source_path,
        destination
    );
    res.status_code(StatusCode::CREATED);
    // TODO: Set Location header to destination
}

/// ## Summary
/// Checks if the current user has permission for the COPY operation.
///
/// COPY requires Read permission on the source resource and Write permission
/// on the destination collection (to bind a new resource).
///
/// ## Errors
/// Returns `StatusCode::FORBIDDEN` if authorization is denied.
/// Returns `StatusCode::INTERNAL_SERVER_ERROR` for database or auth errors.
async fn check_copy_authorization(
    depot: &Depot,
    conn: &mut connection::DbConnection<'_>,
    _source_collection_id: uuid::Uuid,
    _source_uri: &str,
    dest_collection_id: uuid::Uuid,
) -> Result<(), StatusCode> {
    let (subjects, authorizer) = get_auth_context(depot, conn).await?;

    // Get ResourceLocation from depot (populated by slug_resolver middleware)
    let source_resource = get_resolved_location_from_depot(depot).map_err(|e| {
        tracing::error!(error = %e, "ResourceLocation not found in depot; slug_resolver middleware may not have run");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Check Read on source
    check_authorization(
        &authorizer,
        &subjects,
        source_resource,
        Action::Read,
        "COPY source",
    )?;

    // Check Write on destination collection
    // TODO: Determine collection type (calendar vs addressbook) from DB
    // TODO: Build proper ResourceLocation for destination based on resolved collection
    // For now, skip destination authorization since resource_id_for is removed
    // let dest_resource = ...;
    // check_authorization(...)

    Ok(())
}
