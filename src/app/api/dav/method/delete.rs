//! DELETE method handler for `WebDAV` resources.

use salvo::http::StatusCode;
use salvo::{Depot, Request, Response, handler};

use diesel_async::AsyncConnection;
use diesel_async::scoped_futures::ScopedFutureExt;

use crate::app::api::dav::extract::auth::{check_authorization, get_auth_context};
use crate::component::auth::{
    Action, get_instance_from_depot, get_resolved_location_from_depot,
    get_terminal_collection_from_depot,
};
use crate::component::db::connection;
use crate::component::db::query::caldav::{event_index, occurrence};
use crate::component::db::query::carddav::card_index;
use crate::component::db::query::dav::{collection, instance};
use crate::component::model::dav::instance::DavInstance;


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

    // Prefer middleware-resolved values from depot; fallback to error
    let (collection_id, slug) = match (
        get_terminal_collection_from_depot(depot),
        get_instance_from_depot(depot),
    ) {
        (Ok(coll), Ok(inst)) => (coll.id, inst.slug.clone()),
        _ => {
            tracing::debug!(path = %path, "Collection or instance not found in depot");
            res.status_code(StatusCode::NOT_FOUND);
            return;
        }
    };

    // Check early if collection_id is nil before attempting database connection
    if collection_id.is_nil() {
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

    let mut conn = match provider.get_connection().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::error!(error = %e, "Failed to get database connection");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

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
    if let Err(status) = check_delete_authorization(depot, &mut conn, collection_id, &slug).await {
        res.status_code(status);
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
    conn: &mut connection::DbConnection<'_>,
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
                occurrence::delete_by_entity_id(tx, inst.entity_id).await?;
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
/// Returns `StatusCode::NOT_FOUND` if the instance doesn't exist.
/// Returns `StatusCode::FORBIDDEN` if authorization is denied.
/// Returns `StatusCode::INTERNAL_SERVER_ERROR` for database or auth errors.
async fn check_delete_authorization(
    depot: &Depot,
    conn: &mut connection::DbConnection<'_>,
    _collection_id: uuid::Uuid,
    _slug: &str,
) -> Result<(), StatusCode> {
    let (subjects, authorizer) = get_auth_context(depot, conn).await?;

    // Get ResourceLocation from depot (populated by slug_resolver middleware)
    let resource = get_resolved_location_from_depot(depot).map_err(|e| {
        tracing::error!(error = %e, "ResourceLocation not found in depot; slug_resolver middleware may not have run");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    check_authorization(&authorizer, &subjects, resource, Action::Delete, "DELETE")
}
