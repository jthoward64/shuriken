//! COPY method handler for `WebDAV` resource copying.

#![expect(clippy::single_match_else)]

use salvo::http::StatusCode;
use salvo::{Depot, Request, Response, handler};

use crate::app::api::{
    DAV_ROUTE_PREFIX,
    dav::extract::auth::{check_authorization, get_auth_context},
};
use crate::app::api::dav::response::need_privileges::send_need_privileges_error;
use crate::middleware::path_parser::parse_and_resolve_path;
use shuriken_service::auth::{Action, get_instance_from_depot, get_resolved_location_from_depot};

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
    let overwrite = match req.headers().get("Overwrite") {
        Some(header) => header.to_str().unwrap_or("T") == "T",
        None => true,
    };

    // Parse source path to extract collection ID and URI (prefer middleware)
    let source_instance = match get_instance_from_depot(depot) {
        Ok(inst) => inst.clone(),
        Err(_) => {
            tracing::error!(path = %source_path, "Failed to get source instance from depot");
            res.status_code(StatusCode::NOT_FOUND);
            return;
        }
    };

    // Extract destination path from URL (Destination header contains full URL)
    let dest_path = if let Some(path_start) = destination.find("/api/dav/") {
        let full_path = &destination[path_start..];
        // Strip /api/dav prefix for parsing
        full_path
            .strip_prefix(DAV_ROUTE_PREFIX)
            .unwrap_or(full_path)
    } else if let Some(path_start) = destination.find("/dav/") {
        // Handle legacy paths without /api prefix
        &destination[path_start..]
    } else {
        tracing::error!(destination = %destination, "Destination header does not contain /api/dav/ or /dav/ path");
        res.status_code(StatusCode::BAD_REQUEST);
        return;
    };

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
    if let Err((status, resource, action, href)) = check_copy_authorization(depot, &mut conn, &dest_collection, &destination, &dest_resource_name).await {
        if status == StatusCode::FORBIDDEN {
            send_need_privileges_error(res, &resource, action, &href);
        } else {
            res.status_code(status);
        }
        return;
    }

    // Check if destination already exists
    let existing_dest = {
        use diesel::OptionalExtension;
        use diesel_async::RunQueryDsl;
        use shuriken_db::db::query::dav::instance;

        instance::by_slug_and_collection(dest_collection.id, &dest_resource_name)
            .first::<shuriken_db::model::dav::instance::DavInstance>(&mut conn)
            .await
            .optional()
    };

    let existing_dest = match existing_dest {
        Ok(opt) => opt,
        Err(e) => {
            tracing::error!(error = %e, "Failed to check destination existence");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    let is_overwrite = existing_dest.is_some();

    // If destination exists and Overwrite is false, return 412
    if is_overwrite && !overwrite {
        tracing::debug!(
            dest_slug = %dest_resource_name,
            "Destination exists and Overwrite is false"
        );
        res.status_code(StatusCode::PRECONDITION_FAILED);
        return;
    }

    // If overwriting, delete the existing destination first
    if let Some(existing) = existing_dest {
        use shuriken_db::db::query::dav::instance;

        if let Err(e) = instance::delete_instance_with_tombstone(
            &mut conn,
            existing.id,
            dest_collection.synctoken + 1,
        )
        .await
        {
            tracing::error!(error = %e, "Failed to delete existing destination");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    }

    // Create new instance at destination (shallow copy - reuse same entity)
    let new_instance = {
        use shuriken_db::db::query::dav::instance;
        use shuriken_db::model::dav::instance::NewDavInstance;

        let new_inst = NewDavInstance {
            collection_id: dest_collection.id,
            entity_id: source_instance.entity_id,
            content_type: source_instance.content_type,
            etag: &source_instance.etag,
            sync_revision: dest_collection.synctoken + 1,
            last_modified: chrono::Utc::now(),
            slug: &dest_resource_name,
        };

        instance::create_instance(&mut conn, &new_inst).await
    };

    let _new_instance = match new_instance {
        Ok(inst) => inst,
        Err(e) => {
            tracing::error!(error = %e, "Failed to create destination instance");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    // Update destination collection sync token
    {
        use shuriken_db::db::query::dav::collection;

        if let Err(e) = collection::update_synctoken(&mut conn, dest_collection.id).await {
            tracing::error!(error = %e, "Failed to update destination collection synctoken");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    }

    tracing::info!(
        source = %source_path,
        destination = %destination,
        overwrite = is_overwrite,
        "COPY completed successfully"
    );

    // Return 201 if created new resource, 204 if overwrote existing
    res.status_code(if is_overwrite {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::CREATED
    });
}

/// ## Summary
/// Checks if the current user has permission for the COPY operation.
///
/// COPY requires Read permission on the source resource and Write permission
/// on the destination collection (to bind a new resource).
///
/// ## Errors
/// Returns error tuple (status, resource, action) if authorization is denied.
async fn check_copy_authorization(
    depot: &Depot,
    conn: &mut shuriken_db::db::connection::DbConnection<'_>,
    dest_collection: &shuriken_db::model::dav::collection::DavCollection,
    destination: &str,
    resource_name: &str,
) -> Result<(), (StatusCode, shuriken_service::auth::ResourceLocation, shuriken_service::auth::Action, String)> {
    let (subjects, authorizer) = get_auth_context(depot, conn).await.map_err(|e| {
        (e, shuriken_service::auth::ResourceLocation::from_segments(vec![]), shuriken_service::auth::Action::Read, String::new())
    })?;

    // Get ResourceLocation from depot (populated by DavPathMiddleware)
    let source_resource = get_resolved_location_from_depot(depot).map_err(|e| {
        tracing::error!(error = %e, "ResourceLocation not found in depot");
        (StatusCode::INTERNAL_SERVER_ERROR, shuriken_service::auth::ResourceLocation::from_segments(vec![]), shuriken_service::auth::Action::Read, String::new())
    })?;

    // Check Read on source
    if let Err((status, resource, action)) = check_authorization(
        &authorizer,
        &subjects,
        source_resource,
        Action::Read,
        "COPY source",
    ) {
        let href = depot.get::<String>("PATH_LOCATION").map(|s| s.to_string()).unwrap_or_default();
        return Err((status, resource, action, href));
    }

    // Check Write permission on destination collection
    let dest_resource = {
        use shuriken_service::auth::{PathSegment, ResourceLocation, ResourceType};

        let segments = vec![
            PathSegment::ResourceType(
                source_resource
                    .resource_type()
                    .unwrap_or(ResourceType::Calendar),
            ),
            PathSegment::Owner(dest_collection.owner_principal_id.to_string()),
            PathSegment::Collection(dest_collection.id.to_string()),
        ];
        ResourceLocation::from_segments(segments)
    };

    // Check Write permission on destination
    if let Err((status, resource, action)) = check_authorization(
        &authorizer,
        &subjects,
        &dest_resource,
        Action::Edit,
        "COPY destination",
    ) {
        let dest_path = format!("{}{}", destination, resource_name);
        return Err((status, resource, action, dest_path));
    }

    Ok(())
}
