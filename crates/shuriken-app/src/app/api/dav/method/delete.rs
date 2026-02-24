//! DELETE method handler for `WebDAV` resources.

use salvo::http::StatusCode;
use salvo::{Depot, Request, Response, handler};

use diesel_async::AsyncConnection;
use diesel_async::scoped_futures::ScopedFutureExt;

use crate::app::api::dav::extract::auth::{check_authorization, get_auth_context};
use crate::app::api::dav::response::need_privileges::send_need_privileges_error;
use shuriken_db::db::query::caldav::event_index;
use shuriken_db::db::query::carddav::card_index;
use shuriken_db::db::query::dav::{collection, instance};
use shuriken_db::model::dav::instance::DavInstance;
use shuriken_service::auth::{
    Action, get_instance_from_depot, get_resolved_location_from_depot,
    get_terminal_collection_from_depot,
};

/// ## Summary
/// Handles DELETE requests for `WebDAV` resources.
///
/// Soft-deletes the resource instance by setting `deleted_at`,
/// creates a tombstone for sync tracking, and bumps the collection sync token.
///
/// ## Side Effects
/// - Soft-deletes the instance in the database
/// - Creates a tombstone entry
/// - Increments the collection sync token
///
/// ## Errors
/// Returns 404 if the resource is not found, 500 for database errors.
#[handler]
#[tracing::instrument(skip_all, fields(
    method = "DELETE",
    path = %req.uri().path()
))]
pub async fn delete(req: &mut Request, res: &mut Response, depot: &Depot) {
    tracing::info!("Handling DELETE request");

    // Get path before borrowing req mutably
    let path = req.uri().path().to_string();

    // Get database connection early
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

    // Prefer middleware-resolved values from depot
    let terminal_collection = get_terminal_collection_from_depot(depot);
    let instance_opt = get_instance_from_depot(depot);

    let (collection_id, slug) = match (terminal_collection, instance_opt) {
        (Ok(coll), Ok(inst)) => {
            // Instance exists - perform instance deletion
            (coll.id, inst.slug.clone())
        }
        (Ok(coll), Err(_)) => {
            // Collection exists but no instance
            if path.ends_with('/') {
                // Collection DELETE — soft-delete all instances then the collection itself
                let (subjects, authorizer) = match get_auth_context(depot, &mut conn).await {
                    Ok(ctx) => ctx,
                    Err(status) => {
                        res.status_code(status);
                        return;
                    }
                };

                let auth_resource = match get_resolved_location_from_depot(depot) {
                    Ok(r) => r.clone(),
                    Err(e) => {
                        tracing::error!(error = %e, "ResourceLocation not found for collection DELETE");
                        res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
                        return;
                    }
                };

                if let Err(e) = authorizer.require(&subjects, &auth_resource, Action::Delete) {
                    tracing::debug!(error = %e, "Authorization denied for collection DELETE");
                    send_need_privileges_error(res, Action::Delete, req.uri().path());
                    return;
                }

                match delete_collection(&mut conn, coll.id).await {
                    Ok(()) => {
                        tracing::info!(collection_id = %coll.id, "Collection deleted");
                        res.status_code(StatusCode::NO_CONTENT);
                    }
                    Err(e) => {
                        tracing::error!(error = %e, "Failed to delete collection");
                        res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
                    }
                }
                return;
            }
            // Non-trailing-slash path with no instance = 404
            tracing::debug!(path = %path, "Instance not found");
            res.status_code(StatusCode::NOT_FOUND);
            return;
        }
        _ => {
            tracing::debug!(path = %path, "Collection or instance not found in depot");
            res.status_code(StatusCode::NOT_FOUND);
            return;
        }
    };

    // Check early if collection_id is nil before attempting database operations
    if collection_id.is_nil() {
        res.status_code(StatusCode::NOT_FOUND);
        return;
    }

    tracing::debug!(
        collection_id = %collection_id,
        slug = %slug,
        "Parsed request path"
    );

    let if_match = req
        .headers()
        .get("If-Match")
        .and_then(|h| h.to_str().ok())
        .map(String::from);

    // Check authorization: need write permission on the resource
    if let Err((status, action)) =
        check_delete_authorization(depot, &mut conn, collection_id, &slug).await
    {
        if status == StatusCode::FORBIDDEN {
            let path_href = req.uri().path();
            send_need_privileges_error(res, action, path_href);
        } else {
            res.status_code(status);
        }
        return;
    }

    // Perform the deletion
    match perform_delete(&mut conn, collection_id, &slug, if_match.as_deref()).await {
        Ok(DeleteOutcome::Deleted) => {
            // Successfully deleted
            tracing::info!("Resource deleted successfully");
            res.status_code(StatusCode::NO_CONTENT);
        }
        Ok(DeleteOutcome::NotFound) => {
            // Resource not found
            tracing::warn!("Resource not found");
            res.status_code(StatusCode::NOT_FOUND);
        }
        Ok(DeleteOutcome::PreconditionFailed) => {
            tracing::warn!("Precondition failed: ETag mismatch");
            res.status_code(StatusCode::PRECONDITION_FAILED);
        }
        Err(e) => {
            tracing::error!(error = %e, "Failed to delete resource");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
        }
    }
}

/// Result of a DELETE operation.
enum DeleteOutcome {
    /// Resource was deleted successfully.
    Deleted,
    /// Resource was not found.
    NotFound,
    /// Preconditions failed (ETag mismatch).
    PreconditionFailed,
}

/// ## Summary
/// Performs the deletion of a resource.
///
/// Soft-deletes the instance, creates a tombstone, and bumps the sync token.
/// Returns `Ok(true)` if deleted, `Ok(false)` if not found.
///
/// ## Errors
/// Returns database errors if the operation fails.
#[tracing::instrument(skip(conn))]
async fn perform_delete(
    conn: &mut shuriken_db::db::connection::DbConnection<'_>,
    collection_id: uuid::Uuid,
    slug: &str,
    if_match: Option<&str>,
) -> anyhow::Result<DeleteOutcome> {
    tracing::debug!("Performing resource deletion");

    let slug = slug.to_string();
    let if_match = if_match.map(str::to_string);

    conn.transaction::<_, anyhow::Error, _>(move |tx| {
        let slug = slug.clone();
        let if_match = if_match.clone();

        async move {
            use diesel::prelude::*;
            use diesel_async::RunQueryDsl;

            let instance_row: Option<DavInstance> =
                instance::by_slug_and_collection(collection_id, &slug)
                    .select(DavInstance::as_select())
                    .first::<DavInstance>(tx)
                    .await
                    .optional()?;

            let Some(inst) = instance_row else {
                return Ok(DeleteOutcome::NotFound);
            };

            if let Some(ref expected) = if_match
                && inst.etag != *expected
            {
                return Ok(DeleteOutcome::PreconditionFailed);
            }

            let new_synctoken = collection::update_synctoken(tx, collection_id).await?;

            if inst.content_type.starts_with("text/calendar") {
                event_index::delete_by_entity_id(tx, inst.entity_id).await?;
            } else if inst.content_type.starts_with("text/vcard") {
                card_index::delete_by_entity_id(tx, inst.entity_id).await?;
            } else {
                tracing::debug!(
                    content_type = %inst.content_type,
                    "No index cleanup for content type"
                );
            }

            instance::delete_instance_with_tombstone(tx, inst.id, new_synctoken).await?;

            Ok(DeleteOutcome::Deleted)
        }
        .scope_boxed()
    })
    .await
}

/// ## Summary
/// Checks if the current user has write permission for the DELETE operation.
///
/// Loads the instance to determine resource type and `entity_id`, then checks
/// authorization for the Write action.
///
/// ## Errors
/// Returns error tuple (status, action) if authorization is denied.
/// Returns `StatusCode::INTERNAL_SERVER_ERROR` for database or auth errors.
async fn check_delete_authorization(
    depot: &Depot,
    conn: &mut shuriken_db::db::connection::DbConnection<'_>,
    _collection_id: uuid::Uuid,
    _slug: &str,
) -> Result<(), (StatusCode, shuriken_service::auth::Action)> {
    let (subjects, authorizer) = get_auth_context(depot, conn)
        .await
        .map_err(|e| (e, shuriken_service::auth::Action::Delete))?;

    // Get ResourceLocation from depot (use resolved UUID-based location for authorization)
    let resource = get_resolved_location_from_depot(depot).map_err(|e| {
        tracing::error!(error = %e, "ResourceLocation not found in depot; DavPathMiddleware may not have run");
        (StatusCode::INTERNAL_SERVER_ERROR, shuriken_service::auth::Action::Delete)
    })?;

    check_authorization(&authorizer, &subjects, resource, Action::Delete, "DELETE")
        .map_err(|(status, _resource, action)| (status, action))
}

/// Soft-deletes a collection and all its non-deleted instances.
///
/// Sets `deleted_at` on all instances in the collection and then on the collection itself.
/// This frees the `(owner_principal_id, slug)` unique slot for reuse.
///
/// ## Errors
/// Returns a database error if any operation fails.
async fn delete_collection(
    conn: &mut shuriken_db::db::connection::DbConnection<'_>,
    collection_id: uuid::Uuid,
) -> anyhow::Result<()> {
    use diesel::prelude::*;
    use diesel_async::RunQueryDsl;
    use shuriken_db::db::schema::{dav_collection, dav_instance};

    let now = chrono::Utc::now();

    // Soft-delete all non-deleted instances in the collection
    diesel::update(dav_instance::table)
        .filter(dav_instance::collection_id.eq(collection_id))
        .filter(dav_instance::deleted_at.is_null())
        .set(dav_instance::deleted_at.eq(now))
        .execute(conn)
        .await?;

    // Soft-delete the collection itself
    diesel::update(dav_collection::table)
        .filter(dav_collection::id.eq(collection_id))
        .set(dav_collection::deleted_at.eq(now))
        .execute(conn)
        .await?;

    Ok(())
}
