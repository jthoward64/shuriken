//! UID conflict detection for entities.

use diesel::prelude::*;
use diesel_async::RunQueryDsl;

use crate::component::db::schema::{dav_entity, dav_instance};
use crate::component::model::dav::instance::DavInstance;

use super::query_builders::by_logical_uid;

/// ## Summary
/// Checks if a UID conflict exists for the given logical UID in a collection.
///
/// A conflict exists if there's another instance in the same collection with the same
/// logical UID but a different URI (i.e., the UID is already used by a different resource).
///
/// ## Returns
/// - `Ok(Some(uri))` if a conflict exists, returning the conflicting instance's URI
/// - `Ok(None)` if no conflict exists (UID is free or being reused for the same URI)
///
/// ## Errors
/// Returns a database error if the query fails.
pub async fn check_uid_conflict(
    conn: &mut crate::component::db::connection::DbConnection<'_>,
    collection_id: uuid::Uuid,
    logical_uid: &str,
    current_uri: &str,
) -> diesel::QueryResult<Option<String>> {
    // Query for entities with this logical UID
    let instances: Vec<DavInstance> = by_logical_uid(logical_uid)
        .inner_join(dav_instance::table.on(dav_instance::entity_id.eq(dav_entity::id)))
        .filter(dav_instance::collection_id.eq(collection_id))
        .filter(dav_instance::deleted_at.is_null())
        .select(DavInstance::as_select())
        .load(conn)
        .await?;

    // Check if any instance has a different URI
    for instance in instances {
        if instance.uri != current_uri {
            return Ok(Some(instance.uri));
        }
    }

    Ok(None)
}

#[cfg(test)]
mod tests {
    #[expect(unused_imports)]
    use super::*;

    #[test]
    fn test_check_uid_conflict_compiles() {
        // This test just verifies the function signature compiles
        // Integration tests with database would go in the tests module
    }
}
