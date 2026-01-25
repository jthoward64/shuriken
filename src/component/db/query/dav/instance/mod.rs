//! Query functions for DAV instances with `ETag` generation and tombstone support.

mod etag;

use diesel::prelude::*;
use diesel_async::RunQueryDsl;

use crate::component::db::schema::{dav_instance, dav_tombstone};
use crate::component::model::dav::instance::{DavInstance, NewDavInstance};
use crate::component::model::dav::tombstone::NewDavTombstone;

pub use etag::generate_etag;

/// ## Summary
/// Returns a query to select all instances.
#[must_use]
pub fn all() -> dav_instance::BoxedQuery<'static, diesel::pg::Pg> {
    dav_instance::table.into_boxed()
}

/// ## Summary
/// Returns a query to find an instance by ID.
#[must_use]
pub fn by_id(id: uuid::Uuid) -> dav_instance::BoxedQuery<'static, diesel::pg::Pg> {
    all().filter(dav_instance::id.eq(id))
}

/// ## Summary
/// Returns a query to find instances in a collection.
#[must_use]
pub fn by_collection(collection_id: uuid::Uuid) -> dav_instance::BoxedQuery<'static, diesel::pg::Pg> {
    all()
        .filter(dav_instance::collection_id.eq(collection_id))
}

/// ## Summary
/// Returns a query to find a non-deleted instance by collection and URI.
#[must_use]
pub fn by_collection_and_uri(
    collection_id: uuid::Uuid,
    uri: &str,
) -> dav_instance::BoxedQuery<'_, diesel::pg::Pg> {
    by_collection(collection_id)
        .filter(dav_instance::uri.eq(uri))
        .filter(dav_instance::deleted_at.is_null())
}

/// ## Summary
/// Returns a query to find non-deleted instances in a collection.
#[must_use]
pub fn by_collection_not_deleted(collection_id: uuid::Uuid) -> dav_instance::BoxedQuery<'static, diesel::pg::Pg> {
    by_collection(collection_id)
        .filter(dav_instance::deleted_at.is_null())
}

/// ## Summary
/// Returns a query to find instances by entity ID.
#[must_use]
pub fn by_entity(entity_id: uuid::Uuid) -> dav_instance::BoxedQuery<'static, diesel::pg::Pg> {
    all()
        .filter(dav_instance::entity_id.eq(entity_id))
}

/// ## Summary
/// Inserts a new instance and returns the inserted record.
///
/// ## Errors
/// Returns a database error if the insert fails.
#[tracing::instrument(skip(conn, new_instance), fields(
    collection_id = %new_instance.collection_id,
    entity_id = %new_instance.entity_id,
    uri = new_instance.uri,
    etag = new_instance.etag
))]
pub async fn create_instance(
    conn: &mut crate::component::db::connection::DbConnection<'_>,
    new_instance: &NewDavInstance<'_>,
) -> diesel::QueryResult<DavInstance> {
    tracing::debug!("Creating new DAV instance");
    
    let result = diesel::insert_into(dav_instance::table)
        .values(new_instance)
        .returning(DavInstance::as_returning())
        .get_result(conn)
        .await;
    
    if result.is_ok() {
        tracing::debug!("DAV instance created successfully");
    } else {
        tracing::error!("Failed to create DAV instance");
    }
    
    result
}

/// ## Summary
/// Updates an instance's `ETag`, sync revision, and last modified time.
///
/// ## Errors
/// Returns a database error if the update fails.
#[tracing::instrument(skip(conn, etag))]
pub async fn update_instance(
    conn: &mut crate::component::db::connection::DbConnection<'_>,
    instance_id: uuid::Uuid,
    etag: &str,
    sync_revision: i64,
    last_modified: chrono::DateTime<chrono::Utc>,
) -> diesel::QueryResult<DavInstance> {
    tracing::debug!(sync_revision, "Updating DAV instance");
    
    let result = diesel::update(dav_instance::table)
        .filter(dav_instance::id.eq(instance_id))
        .set((
            dav_instance::etag.eq(etag),
            dav_instance::sync_revision.eq(sync_revision),
            dav_instance::last_modified.eq(last_modified),
        ))
        .returning(DavInstance::as_returning())
        .get_result(conn)
        .await;
    
    if result.is_ok() {
        tracing::debug!("DAV instance updated successfully");
    }
    
    result
}

/// ## Summary
/// Soft-deletes an instance (sets `deleted_at` to now).
///
/// ## Errors
/// Returns a database error if the update fails.
#[tracing::instrument(skip(conn))]
pub async fn soft_delete_instance(
    conn: &mut crate::component::db::connection::DbConnection<'_>,
    instance_id: uuid::Uuid,
) -> diesel::QueryResult<DavInstance> {
    tracing::debug!("Soft-deleting DAV instance");
    
    let result = diesel::update(dav_instance::table)
        .filter(dav_instance::id.eq(instance_id))
        .set(dav_instance::deleted_at.eq(diesel::dsl::now))
        .returning(DavInstance::as_returning())
        .get_result(conn)
        .await;
    
    if result.is_ok() {
        tracing::debug!("DAV instance soft-deleted successfully");
    }
    
    result
}

/// ## Summary
/// Creates a tombstone record for a deleted instance.
///
/// Tombstones enable sync clients to detect deletions even after purge.
///
/// ## Errors
/// Returns a database error if the insert fails.
pub async fn create_tombstone(
    conn: &mut crate::component::db::connection::DbConnection<'_>,
    tombstone: &NewDavTombstone<'_>,
) -> diesel::QueryResult<uuid::Uuid> {
    diesel::insert_into(dav_tombstone::table)
        .values(tombstone)
        .returning(dav_tombstone::id)
        .get_result(conn)
        .await
}

/// ## Summary
/// Soft-deletes an instance and creates a corresponding tombstone.
///
/// This is the recommended way to delete instances to maintain sync correctness.
///
/// ## Errors
/// Returns a database error if any operation fails.
pub async fn delete_instance_with_tombstone(
    conn: &mut crate::component::db::connection::DbConnection<'_>,
    instance_id: uuid::Uuid,
    synctoken: i64,
) -> diesel::QueryResult<uuid::Uuid> {
    // Get the instance first
    let instance: DavInstance = by_id(instance_id)
        .select(DavInstance::as_select())
        .first(conn)
        .await?;

    // Soft-delete the instance
    soft_delete_instance(conn, instance_id).await?;

    // Create tombstone
    let tombstone = NewDavTombstone {
        collection_id: instance.collection_id,
        uri: &instance.uri,
        entity_id: Some(instance.entity_id),
        synctoken,
        sync_revision: instance.sync_revision,
        deleted_at: chrono::Utc::now(),
        last_etag: Some(&instance.etag),
        logical_uid: None,
    };

    create_tombstone(conn, &tombstone).await
}
