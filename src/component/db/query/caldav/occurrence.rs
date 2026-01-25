//! Query composition for `cal_occurrence` table operations.

use crate::component::db::schema::cal_occurrence;
use crate::component::model::dav::occurrence::NewCalOccurrence;
use chrono::{DateTime, Utc};
use diesel::prelude::*;
use diesel_async::RunQueryDsl;
use uuid::Uuid;

/// Returns a query for all occurrences (unfiltered).
#[must_use]
pub fn all() -> cal_occurrence::BoxedQuery<'static, diesel::pg::Pg> {
    cal_occurrence::table
        .filter(cal_occurrence::deleted_at.is_null())
        .into_boxed()
}

/// Returns a query for occurrences by entity ID.
#[must_use]
pub fn by_entity_id(entity_id: Uuid) -> cal_occurrence::BoxedQuery<'static, diesel::pg::Pg> {
    all().filter(cal_occurrence::entity_id.eq(entity_id))
}

/// Returns a query for occurrences by component ID.
#[must_use]
pub fn by_component_id(component_id: Uuid) -> cal_occurrence::BoxedQuery<'static, diesel::pg::Pg> {
    all().filter(cal_occurrence::component_id.eq(component_id))
}

/// Returns a query for occurrences within a time range.
///
/// Matches occurrences that overlap with the given time range:
/// - Occurrence starts before range_end
/// - Occurrence ends after range_start
#[must_use]
pub fn by_time_range(
    range_start: DateTime<Utc>,
    range_end: DateTime<Utc>,
) -> cal_occurrence::BoxedQuery<'static, diesel::pg::Pg> {
    all()
        .filter(cal_occurrence::start_utc.lt(range_end))
        .filter(cal_occurrence::end_utc.gt(range_start))
}

/// Returns a query for occurrences by entity ID within a time range.
#[must_use]
pub fn by_entity_and_time_range(
    entity_id: Uuid,
    range_start: DateTime<Utc>,
    range_end: DateTime<Utc>,
) -> cal_occurrence::BoxedQuery<'static, diesel::pg::Pg> {
    by_entity_id(entity_id)
        .filter(cal_occurrence::start_utc.lt(range_end))
        .filter(cal_occurrence::end_utc.gt(range_start))
}

/// Batch insert occurrences into the database.
///
/// ## Summary
/// Inserts multiple occurrence records in a single query.
///
/// ## Errors
/// Returns a database error if the insert fails.
pub async fn insert_occurrences(
    conn: &mut crate::component::db::connection::DbConnection<'_>,
    occurrences: &[NewCalOccurrence],
) -> Result<usize, diesel::result::Error> {
    if occurrences.is_empty() {
        return Ok(0);
    }

    diesel::insert_into(cal_occurrence::table)
        .values(occurrences)
        .execute(conn)
        .await
}

/// Deletes all occurrences for a given entity ID.
///
/// ## Summary
/// Hard deletes occurrence records for an entity.
///
/// ## Errors
/// Returns a database error if the delete fails.
pub async fn delete_by_entity_id(
    conn: &mut crate::component::db::connection::DbConnection<'_>,
    entity_id: Uuid,
) -> Result<usize, diesel::result::Error> {
    diesel::delete(cal_occurrence::table.filter(cal_occurrence::entity_id.eq(entity_id)))
        .execute(conn)
        .await
}

/// Deletes all occurrences for a given component ID.
///
/// ## Summary
/// Hard deletes occurrence records for a component.
///
/// ## Errors
/// Returns a database error if the delete fails.
pub async fn delete_by_component_id(
    conn: &mut crate::component::db::connection::DbConnection<'_>,
    component_id: Uuid,
) -> Result<usize, diesel::result::Error> {
    diesel::delete(cal_occurrence::table.filter(cal_occurrence::component_id.eq(component_id)))
        .execute(conn)
        .await
}

/// Soft deletes all occurrences for a given entity ID.
///
/// ## Summary
/// Sets `deleted_at` timestamp for all occurrences of an entity.
///
/// ## Errors
/// Returns a database error if the update fails.
pub async fn soft_delete_by_entity_id(
    conn: &mut crate::component::db::connection::DbConnection<'_>,
    entity_id: Uuid,
    deleted_at: DateTime<Utc>,
) -> Result<usize, diesel::result::Error> {
    diesel::update(cal_occurrence::table.filter(cal_occurrence::entity_id.eq(entity_id)))
        .set(cal_occurrence::deleted_at.eq(Some(deleted_at)))
        .execute(conn)
        .await
}
