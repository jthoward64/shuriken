//! Query functions for DAV collections (calendars and addressbooks).

use diesel::prelude::*;
use diesel_async::RunQueryDsl;

use crate::component::db::schema::dav_collection;
use crate::component::model::dav::collection::{DavCollection, NewDavCollection};

type BoxedQuery<'a, T> = dav_collection::BoxedQuery<'a, diesel::pg::Pg, T>;

/// ## Summary
/// Returns a query to select all collections.
#[diesel::dsl::auto_type]
#[must_use]
pub fn all() -> BoxedQuery<'static, DavCollection> {
    dav_collection::table
        .select(DavCollection::as_select())
        .into_boxed()
}

/// ## Summary
/// Returns a query to find a collection by ID.
#[diesel::dsl::auto_type]
#[must_use]
pub fn by_id(id: uuid::Uuid) -> BoxedQuery<'static, DavCollection> {
    all().filter(dav_collection::id.eq(id)).into_boxed()
}

/// ## Summary
/// Returns a query to find collections for a principal.
#[diesel::dsl::auto_type]
#[must_use]
pub fn by_principal(principal_id: uuid::Uuid) -> BoxedQuery<'static, DavCollection> {
    all()
        .filter(dav_collection::owner_principal_id.eq(principal_id))
        .into_boxed()
}

/// ## Summary
/// Returns a query to find non-deleted collections for a principal.
#[diesel::dsl::auto_type]
#[must_use]
pub fn by_principal_not_deleted(principal_id: uuid::Uuid) -> BoxedQuery<'static, DavCollection> {
    by_principal(principal_id)
        .filter(dav_collection::deleted_at.is_null())
        .into_boxed()
}

/// ## Summary
/// Returns a query to find a collection by URI and principal.
#[must_use]
pub fn by_uri_and_principal(
    uri: &str,
    principal_id: uuid::Uuid,
) -> dav_collection::BoxedQuery<'_, diesel::pg::Pg, DavCollection> {
    all()
        .filter(dav_collection::uri.eq(uri))
        .filter(dav_collection::owner_principal_id.eq(principal_id))
        .into_boxed()
}

/// ## Summary
/// Returns a query to find non-deleted collections.
#[diesel::dsl::auto_type]
#[must_use]
pub fn not_deleted() -> BoxedQuery<'static, DavCollection> {
    all()
        .filter(dav_collection::deleted_at.is_null())
        .into_boxed()
}

/// ## Summary
/// Inserts a new collection and returns the inserted record.
///
/// ## Errors
/// Returns a database error if the insert fails.
pub async fn create_collection(
    conn: &mut crate::component::db::connection::DbConnection<'_>,
    new_collection: &NewDavCollection<'_>,
) -> diesel::QueryResult<DavCollection> {
    diesel::insert_into(dav_collection::table)
        .values(new_collection)
        .returning(DavCollection::as_returning())
        .get_result(conn)
        .await
}

/// ## Summary
/// Retrieves a collection by ID.
///
/// ## Errors
/// Returns a database error if the query fails.
pub async fn get_collection(
    conn: &mut crate::component::db::connection::DbConnection<'_>,
    id: uuid::Uuid,
) -> diesel::QueryResult<Option<DavCollection>> {
    use diesel_async::scoped_futures::ScopedFutureExt;
    
    by_id(id)
        .get_result::<DavCollection>(conn)
        .await
        .optional()
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
    by_principal_not_deleted(principal_id)
        .get_results::<DavCollection>(conn)
        .await
}

/// ## Summary
/// Updates the sync token for a collection (increments it).
///
/// ## Errors
/// Returns a database error if the update fails.
pub async fn update_synctoken(
    conn: &mut crate::component::db::connection::DbConnection<'_>,
    collection_id: uuid::Uuid,
) -> diesel::QueryResult<i64> {
    diesel::update(dav_collection::table)
        .filter(dav_collection::id.eq(collection_id))
        .set(dav_collection::synctoken.eq(dav_collection::synctoken + 1))
        .returning(dav_collection::synctoken)
        .get_result(conn)
        .await
}
