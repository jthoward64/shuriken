//! Query functions for scheduling messages.

use diesel::prelude::*;

use crate::component::db::schema::dav_schedule_message;

/// ## Summary
/// Returns a query to select all scheduling messages.
#[must_use]
pub fn all() -> dav_schedule_message::BoxedQuery<'static, diesel::pg::Pg> {
    dav_schedule_message::table.into_boxed()
}

/// ## Summary
/// Returns a query to find a scheduling message by ID.
#[must_use]
pub fn by_id(id: uuid::Uuid) -> dav_schedule_message::BoxedQuery<'static, diesel::pg::Pg> {
    all().filter(dav_schedule_message::id.eq(id))
}

/// ## Summary
/// Returns a query to find scheduling messages by collection.
#[must_use]
pub fn by_collection(
    collection_id: uuid::Uuid,
) -> dav_schedule_message::BoxedQuery<'static, diesel::pg::Pg> {
    all().filter(dav_schedule_message::collection_id.eq(collection_id))
}

/// ## Summary
/// Returns a query to find scheduling messages by recipient.
#[must_use]
pub fn by_recipient(
    recipient: &str,
) -> dav_schedule_message::BoxedQuery<'_, diesel::pg::Pg> {
    all().filter(dav_schedule_message::recipient.eq(recipient))
}

/// ## Summary
/// Returns a query to find non-deleted scheduling messages by recipient.
#[must_use]
pub fn by_recipient_not_deleted(
    recipient: &str,
) -> dav_schedule_message::BoxedQuery<'_, diesel::pg::Pg> {
    by_recipient(recipient).filter(dav_schedule_message::deleted_at.is_null())
}

/// ## Summary
/// Returns a query to find scheduling messages by status.
#[must_use]
pub fn by_status(
    status: &str,
) -> dav_schedule_message::BoxedQuery<'_, diesel::pg::Pg> {
    all().filter(dav_schedule_message::status.eq(status))
}

/// ## Summary
/// Returns a query to find non-deleted scheduling messages by status.
#[must_use]
pub fn by_status_not_deleted(
    status: &str,
) -> dav_schedule_message::BoxedQuery<'_, diesel::pg::Pg> {
    by_status(status).filter(dav_schedule_message::deleted_at.is_null())
}

/// ## Summary
/// Returns a query to find non-deleted scheduling messages.
#[must_use]
pub fn not_deleted() -> dav_schedule_message::BoxedQuery<'static, diesel::pg::Pg> {
    all().filter(dav_schedule_message::deleted_at.is_null())
}
