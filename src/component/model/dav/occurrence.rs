//! Models for calendar occurrence expansion cache.

use chrono::{DateTime, Utc};
use diesel::prelude::*;
use uuid::Uuid;

use crate::component::db::schema::cal_occurrence;

/// Calendar occurrence cache entry.
///
/// Represents an expanded occurrence of a recurring event.
#[derive(Debug, Clone, Queryable, Selectable, Identifiable)]
#[diesel(table_name = cal_occurrence)]
#[diesel(check_for_backend(diesel::pg::Pg))]
pub struct CalOccurrence {
    /// UUID v7 primary key.
    pub id: Uuid,
    /// Reference to the canonical entity.
    pub entity_id: Uuid,
    /// Reference to the component (VEVENT, etc.).
    pub component_id: Uuid,
    /// Occurrence start time in UTC.
    pub start_utc: DateTime<Utc>,
    /// Occurrence end time in UTC.
    pub end_utc: DateTime<Utc>,
    /// RECURRENCE-ID for exception instances.
    pub recurrence_id_utc: Option<DateTime<Utc>>,
    /// Last update timestamp.
    pub updated_at: DateTime<Utc>,
    /// Soft delete timestamp.
    pub deleted_at: Option<DateTime<Utc>>,
}

/// New calendar occurrence for insertion.
#[derive(Debug, Clone, Insertable)]
#[diesel(table_name = cal_occurrence)]
pub struct NewCalOccurrence {
    /// Reference to the canonical entity.
    pub entity_id: Uuid,
    /// Reference to the component (VEVENT, etc.).
    pub component_id: Uuid,
    /// Occurrence start time in UTC.
    pub start_utc: DateTime<Utc>,
    /// Occurrence end time in UTC.
    pub end_utc: DateTime<Utc>,
    /// RECURRENCE-ID for exception instances.
    pub recurrence_id_utc: Option<DateTime<Utc>>,
}

impl NewCalOccurrence {
    /// Creates a new calendar occurrence.
    #[must_use]
    pub fn new(
        entity_id: Uuid,
        component_id: Uuid,
        start_utc: DateTime<Utc>,
        end_utc: DateTime<Utc>,
    ) -> Self {
        Self {
            entity_id,
            component_id,
            start_utc,
            end_utc,
            recurrence_id_utc: None,
        }
    }

    /// Sets the RECURRENCE-ID for exception instances.
    #[must_use]
    pub fn with_recurrence_id(mut self, recurrence_id: DateTime<Utc>) -> Self {
        self.recurrence_id_utc = Some(recurrence_id);
        self
    }
}
