//! Query composition for `cal_index`.

use diesel::prelude::*;
use diesel_async::RunQueryDsl;
use uuid::Uuid;

use crate::db::connection::DbConnection;
use crate::db::schema::cal_index;
use crate::model::caldav::cal_index::NewCalIndex;

/// ## Summary
/// Inserts a calendar index entry.
///
/// ## Errors
/// Returns an error if the database operation fails.
pub async fn insert(conn: &mut DbConnection<'_>, index: &NewCalIndex) -> QueryResult<()> {
    diesel::insert_into(cal_index::table)
        .values(index)
        .execute(conn)
        .await?;
    Ok(())
}

/// ## Summary
/// Inserts multiple calendar index entries in a batch.
///
/// ## Errors
/// Returns an error if the database operation fails.
pub async fn insert_batch(conn: &mut DbConnection<'_>, indexes: &[NewCalIndex]) -> QueryResult<()> {
    if indexes.is_empty() {
        return Ok(());
    }

    diesel::insert_into(cal_index::table)
        .values(indexes)
        .execute(conn)
        .await?;
    Ok(())
}

/// ## Summary
/// Deletes all calendar index entries for an entity.
///
/// ## Errors
/// Returns an error if the database operation fails.
pub async fn delete_by_entity_id(conn: &mut DbConnection<'_>, entity_id: Uuid) -> QueryResult<()> {
    diesel::delete(cal_index::table.filter(cal_index::entity_id.eq(entity_id)))
        .execute(conn)
        .await?;
    Ok(())
}
