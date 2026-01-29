//! Models for timezone caching.

use chrono::{DateTime, Utc};
use diesel::prelude::*;
use uuid::Uuid;

use crate::db::schema::cal_timezone;

/// Cached VTIMEZONE component.
///
/// Stores VTIMEZONE components for efficient timezone resolution.
#[derive(Debug, Clone, Queryable, Selectable, Identifiable)]
#[diesel(table_name = cal_timezone)]
#[diesel(check_for_backend(diesel::pg::Pg))]
pub struct CalTimezone {
    /// UUID v7 primary key.
    pub id: Uuid,
    /// Timezone identifier (e.g., `America/New_York`).
    pub tzid: String,
    /// Full VTIMEZONE component data.
    pub vtimezone_data: String,
    /// IANA timezone name if mappable.
    pub iana_name: Option<String>,
    /// When this timezone was first cached.
    pub created_at: DateTime<Utc>,
    /// Last update timestamp.
    pub updated_at: DateTime<Utc>,
}

/// New timezone for insertion.
#[derive(Debug, Clone, Insertable)]
#[diesel(table_name = cal_timezone)]
pub struct NewCalTimezone<'a> {
    /// Timezone identifier (e.g., `America/New_York`).
    pub tzid: &'a str,
    /// Full VTIMEZONE component data.
    pub vtimezone_data: &'a str,
    /// IANA timezone name if mappable.
    pub iana_name: Option<&'a str>,
}

impl<'a> NewCalTimezone<'a> {
    /// Creates a new timezone cache entry.
    #[must_use]
    pub fn new(tzid: &'a str, vtimezone_data: &'a str) -> Self {
        Self {
            tzid,
            vtimezone_data,
            iana_name: None,
        }
    }

    /// Sets the IANA timezone name.
    #[must_use]
    pub fn with_iana_name(mut self, iana_name: &'a str) -> Self {
        self.iana_name = Some(iana_name);
        self
    }
}
