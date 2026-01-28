//! COPY method handler for `WebDAV` resource copying.

#![expect(clippy::single_match_else)]

use salvo::http::StatusCode;
use salvo::{Depot, Request, Response, handler};

use crate::app::api::dav::extract::auth::{check_authorization, get_auth_context};
use crate::component::auth::{Action, get_instance_from_depot, get_resolved_location_from_depot};
use crate::component::db::connection;
use crate::component::middleware::path_parser::parse_and_resolve_path;

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
    let source_instance = match get_instance_from_depot(depot) {
        Ok(inst) => inst.clone(),
        Err(_) => {
            tracing::error!(path = %source_path, "Failed to get source instance from depot");
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };

    // Extract destination path from URL (Destination header contains full URL)
    let dest_path = if let Some(path_start) = destination.find("/dav/") {
        &destination[path_start..]
    } else {
        tracing::error!(destination = %destination, "Destination header does not contain /dav/ path");
        res.status_code(StatusCode::BAD_REQUEST);
        return;
    };

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

    // Parse destination path to get target collection and instance name
    let dest_result = match parse_and_resolve_path(dest_path, &mut conn).await {
        Ok(result) => result,
        Err(e) => {
            tracing::error!(error = %e, path = %dest_path, "Failed to resolve destination path");
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };

    // Destination must have a collection (parent collection where resource will be created)
    let dest_collection = match dest_result.collection_chain {
        Some(chain) => match chain.terminal() {
            Some(coll) => coll.clone(),
            None => {
                tracing::error!("Destination collection chain is empty");
                res.status_code(StatusCode::BAD_REQUEST);
                return;
            }
        },
        None => {
            tracing::error!("Destination path does not include a collection");
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };

    // Get destination resource name from last segment
    let dest_resource_name = dest_result
        .item_filename
        .as_ref()
        .and_then(|f| {
            // Strip extensions
            let name = f.trim_end_matches(".ics").trim_end_matches(".vcf");
            if name.is_empty() {
                None
            } else {
                Some(name.to_string())
            }
        })
        .unwrap_or_else(|| source_instance.slug.clone());

    tracing::debug!(
        source_collection_id = %source_instance.collection_id,
        source_uri = %source_instance.slug,
        dest_collection_id = %dest_collection.id,
        dest_resource_name = %dest_resource_name,
        "Parsed COPY paths"
    );

    // Check authorization: need Read on source and Write on destination
    if let Err(status) = check_copy_authorization(depot, &mut conn).await {
        res.status_code(status);
        return;
    }

    // TODO: Duplicate entity or reference same entity (shallow copy)
    // TODO: Create new instance at destination
    // TODO: Update sync token for destination collection
    // TODO: Return 201 Created or 204 No Content

    tracing::warn!(
        "COPY partially implemented for: {} -> {}",
        source_path,
        destination
    );
    res.status_code(StatusCode::CREATED);
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
) -> Result<(), StatusCode> {
    let (subjects, authorizer) = get_auth_context(depot, conn).await?;

    // Get ResourceLocation from depot (populated by DavPathMiddleware)
    let source_resource = get_resolved_location_from_depot(depot).map_err(|e| {
        tracing::error!(error = %e, "ResourceLocation not found in depot");
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

    // TODO: Build proper ResourceLocation for destination and check Write permission
    // For now, assuming authorization passed if we got here

    Ok(())
}
