//! Query functions for calendar attendees.

use diesel::prelude::*;

use crate::component::db::schema::cal_attendee;

/// ## Summary
/// Returns a query to select all attendees.
#[must_use]
pub fn all() -> cal_attendee::BoxedQuery<'static, diesel::pg::Pg> {
    cal_attendee::table.into_boxed()
}

/// ## Summary
/// Returns a query to find an attendee by ID.
#[must_use]
pub fn by_id(id: uuid::Uuid) -> cal_attendee::BoxedQuery<'static, diesel::pg::Pg> {
    all().filter(cal_attendee::id.eq(id))
}

/// ## Summary
/// Returns a query to find attendees by entity.
#[must_use]
pub fn by_entity(entity_id: uuid::Uuid) -> cal_attendee::BoxedQuery<'static, diesel::pg::Pg> {
    all().filter(cal_attendee::entity_id.eq(entity_id))
}

/// ## Summary
/// Returns a query to find non-deleted attendees by entity.
#[must_use]
pub fn by_entity_not_deleted(
    entity_id: uuid::Uuid,
) -> cal_attendee::BoxedQuery<'static, diesel::pg::Pg> {
    by_entity(entity_id).filter(cal_attendee::deleted_at.is_null())
}

/// ## Summary
/// Returns a query to find attendees by component.
#[must_use]
pub fn by_component(component_id: uuid::Uuid) -> cal_attendee::BoxedQuery<'static, diesel::pg::Pg> {
    all().filter(cal_attendee::component_id.eq(component_id))
}

/// ## Summary
/// Returns a query to find non-deleted attendees by component.
#[must_use]
pub fn by_component_not_deleted(
    component_id: uuid::Uuid,
) -> cal_attendee::BoxedQuery<'static, diesel::pg::Pg> {
    by_component(component_id).filter(cal_attendee::deleted_at.is_null())
}

/// ## Summary
/// Returns a query to find attendees by calendar user address.
#[must_use]
pub fn by_address(address: &str) -> cal_attendee::BoxedQuery<'_, diesel::pg::Pg> {
    all().filter(cal_attendee::calendar_user_address.eq(address))
}

/// ## Summary
/// Returns a query to find non-deleted attendees by calendar user address.
#[must_use]
pub fn by_address_not_deleted(address: &str) -> cal_attendee::BoxedQuery<'_, diesel::pg::Pg> {
    by_address(address).filter(cal_attendee::deleted_at.is_null())
}

/// ## Summary
/// Returns a query to find attendees by participation status.
#[must_use]
pub fn by_partstat(partstat: &str) -> cal_attendee::BoxedQuery<'_, diesel::pg::Pg> {
    all().filter(cal_attendee::partstat.eq(partstat))
}

/// ## Summary
/// Returns a query to find non-deleted attendees by address and participation status.
#[must_use]
pub fn by_address_and_partstat<'a>(
    address: &'a str,
    partstat: &'a str,
) -> cal_attendee::BoxedQuery<'a, diesel::pg::Pg> {
    by_address_not_deleted(address).filter(cal_attendee::partstat.eq(partstat))
}

/// ## Summary
/// Returns a query to find non-deleted attendees.
#[must_use]
pub fn not_deleted() -> cal_attendee::BoxedQuery<'static, diesel::pg::Pg> {
    all().filter(cal_attendee::deleted_at.is_null())
}
