//! Query composition for `dav_tombstone`.

use diesel::prelude::*;

use crate::component::db::schema::dav_tombstone;

/// ## Summary
/// Returns a query to select all tombstones.
#[must_use]
pub fn all() -> dav_tombstone::BoxedQuery<'static, diesel::pg::Pg> {
    dav_tombstone::table.into_boxed()
}

/// ## Summary
/// Returns a query to find tombstones in a collection.
#[must_use]
pub fn by_collection(
    collection_id: uuid::Uuid,
) -> dav_tombstone::BoxedQuery<'static, diesel::pg::Pg> {
    all().filter(dav_tombstone::collection_id.eq(collection_id))
}
