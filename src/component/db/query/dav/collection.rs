//! Query functions for DAV collections (calendars and addressbooks).

use diesel::prelude::*;
use diesel_async::RunQueryDsl;

use crate::component::db::schema::dav_collection;
use crate::component::model::dav::collection::{DavCollection, NewDavCollection};

/// ## Summary
/// Returns a query to select all collections.
#[must_use]
pub fn all() -> dav_collection::BoxedQuery<'static, diesel::pg::Pg> {
    dav_collection::table.into_boxed()
}

/// ## Summary
/// Returns a query to find a collection by ID.
#[must_use]
pub fn by_id(id: uuid::Uuid) -> dav_collection::BoxedQuery<'static, diesel::pg::Pg> {
    all().filter(dav_collection::id.eq(id))
}

/// ## Summary
/// Returns a query to find collections for a principal.
#[must_use]
pub fn by_principal(
    principal_id: uuid::Uuid,
) -> dav_collection::BoxedQuery<'static, diesel::pg::Pg> {
    all().filter(dav_collection::owner_principal_id.eq(principal_id))
}

/// ## Summary
/// Returns a query to find non-deleted collections for a principal.
#[must_use]
pub fn by_principal_not_deleted(
    principal_id: uuid::Uuid,
) -> dav_collection::BoxedQuery<'static, diesel::pg::Pg> {
    by_principal(principal_id).filter(dav_collection::deleted_at.is_null())
}

/// ## Summary
/// Returns a query to find a collection by slug and principal.
#[must_use]
pub fn by_slug_and_principal(
    slug: &str,
    principal_id: uuid::Uuid,
) -> dav_collection::BoxedQuery<'_, diesel::pg::Pg> {
    all()
        .filter(dav_collection::slug.eq(slug))
        .filter(dav_collection::owner_principal_id.eq(principal_id))
}

/// ## Summary
/// Legacy: Returns a query to find a collection by URI and principal (now uses slug extraction).
///
/// For compatibility during migration, extracts the slug from the URI path.
#[must_use]
pub fn by_uri_and_principal(
    uri: &str,
    principal_id: uuid::Uuid,
) -> dav_collection::BoxedQuery<'static, diesel::pg::Pg> {
    // Extract slug from URI: remove trailing slashes and use the last path segment
    let slug = uri
        .trim_end_matches('/')
        .split('/')
        .last()
        .unwrap_or(uri)
        .to_string();
    all()
        .filter(dav_collection::slug.eq(slug))
        .filter(dav_collection::owner_principal_id.eq(principal_id))
}

/// ## Summary
/// Returns a query to find non-deleted collections.
#[must_use]
pub fn not_deleted() -> dav_collection::BoxedQuery<'static, diesel::pg::Pg> {
    all().filter(dav_collection::deleted_at.is_null())
}

/// ## Summary
/// Inserts a new collection and returns the inserted record.
///
/// ## Errors
/// Returns a database error if the insert fails.
#[tracing::instrument(skip(conn, new_collection), fields(
    slug = new_collection.slug,
    collection_type = new_collection.collection_type
))]
pub async fn create_collection(
    conn: &mut crate::component::db::connection::DbConnection<'_>,
    new_collection: &NewDavCollection<'_>,
) -> diesel::QueryResult<DavCollection> {
    tracing::debug!("Creating new DAV collection");

    let result = diesel::insert_into(dav_collection::table)
        .values(new_collection)
        .returning(DavCollection::as_returning())
        .get_result(conn)
        .await;

    if result.is_ok() {
        tracing::debug!("DAV collection created successfully");
    } else {
        tracing::error!("Failed to create DAV collection");
    }

    result
}

/// ## Summary
/// Retrieves a collection by ID.
///
/// ## Errors
/// Returns a database error if the query fails.
#[tracing::instrument(skip(conn))]
pub async fn get_collection(
    conn: &mut crate::component::db::connection::DbConnection<'_>,
    id: uuid::Uuid,
) -> diesel::QueryResult<Option<DavCollection>> {
    tracing::trace!("Fetching DAV collection by ID");

    by_id(id).first(conn).await.optional()
}

/// ## Summary
/// Lists non-deleted collections for a principal.
///
/// ## Errors
/// Returns a database error if the query fails.
pub async fn list_collections(
    conn: &mut crate::component::db::connection::DbConnection<'_>,
    principal_id: uuid::Uuid,
) -> diesel::QueryResult<Vec<DavCollection>> {
    by_principal_not_deleted(principal_id).load(conn).await
}

/// ## Summary
/// Updates the sync token for a collection (increments it).
///
/// ## Errors
/// Returns a database error if the update fails.
#[tracing::instrument(skip(conn))]
pub async fn update_synctoken(
    conn: &mut crate::component::db::connection::DbConnection<'_>,
    collection_id: uuid::Uuid,
) -> diesel::QueryResult<i64> {
    tracing::debug!("Updating collection sync token");

    diesel::update(dav_collection::table)
        .filter(dav_collection::id.eq(collection_id))
        .set(dav_collection::synctoken.eq(dav_collection::synctoken + 1))
        .returning(dav_collection::synctoken)
        .get_result(conn)
        .await
}

/// ## Summary
/// Updates writable properties of a collection.
///
/// ## Errors
/// Returns a database error if the update fails.
pub async fn update_collection_properties(
    conn: &mut crate::component::db::connection::DbConnection<'_>,
    collection_id: uuid::Uuid,
    display_name: Option<&str>,
    description: Option<&str>,
) -> diesel::QueryResult<DavCollection> {
    diesel::update(dav_collection::table)
        .filter(dav_collection::id.eq(collection_id))
        .set((
            dav_collection::display_name.eq(display_name),
            dav_collection::description.eq(description),
        ))
        .returning(DavCollection::as_returning())
        .get_result(conn)
        .await
}
