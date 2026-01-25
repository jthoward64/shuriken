//! Query functions for timezone cache.

use diesel::prelude::*;

use crate::component::db::schema::cal_timezone;

/// ## Summary
/// Returns a query to select all timezones.
#[must_use]
pub fn all() -> cal_timezone::BoxedQuery<'static, diesel::pg::Pg> {
    cal_timezone::table.into_boxed()
}

/// ## Summary
/// Returns a query to find a timezone by ID.
#[must_use]
pub fn by_id(id: uuid::Uuid) -> cal_timezone::BoxedQuery<'static, diesel::pg::Pg> {
    all().filter(cal_timezone::id.eq(id))
}

/// ## Summary
/// Returns a query to find a timezone by TZID.
#[must_use]
pub fn by_tzid(
    tzid: &str,
) -> cal_timezone::BoxedQuery<'_, diesel::pg::Pg> {
    all().filter(cal_timezone::tzid.eq(tzid))
}

/// ## Summary
/// Returns a query to find a timezone by IANA name.
#[must_use]
pub fn by_iana_name(
    iana_name: &str,
) -> cal_timezone::BoxedQuery<'_, diesel::pg::Pg> {
    all().filter(cal_timezone::iana_name.eq(iana_name))
}
