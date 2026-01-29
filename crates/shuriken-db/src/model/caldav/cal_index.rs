//! Models for calendar index table.

use chrono::{DateTime, Utc};
use diesel::prelude::*;
use serde_json::Value as JsonValue;
use uuid::Uuid;

use crate::db::enums::ComponentType;
use crate::db::schema::cal_index;

/// Calendar index entry.
///
/// Denormalized index for efficient calendar-query operations.
#[derive(Debug, Clone, Queryable, Selectable, Identifiable)]
#[diesel(table_name = cal_index)]
#[diesel(primary_key(entity_id, component_id))]
#[diesel(check_for_backend(diesel::pg::Pg))]
pub struct CalIndex {
    /// Reference to the canonical entity.
    pub entity_id: Uuid,
    /// Reference to the indexed component (VEVENT, VTODO, etc.).
    pub component_id: Uuid,
    /// Component type (e.g., "VEVENT", "VTODO").
    pub component_type: ComponentType,
    /// UID of the component.
    pub uid: Option<String>,
    /// RECURRENCE-ID in UTC (for exception instances).
    pub recurrence_id_utc: Option<DateTime<Utc>>,
    /// Start time in UTC.
    pub dtstart_utc: Option<DateTime<Utc>>,
    /// End time in UTC.
    pub dtend_utc: Option<DateTime<Utc>>,
    /// Whether this is an all-day event.
    pub all_day: Option<bool>,
    /// RRULE text for recurring events.
    pub rrule_text: Option<String>,
    /// Flexible metadata (summary, location, organizer, attendees, etc.).
    pub metadata: Option<JsonValue>,
    /// Last update timestamp.
    pub updated_at: DateTime<Utc>,
    /// Soft delete timestamp.
    pub deleted_at: Option<DateTime<Utc>>,
}

/// New calendar index entry for insertion.
#[derive(Debug, Clone, Insertable)]
#[diesel(table_name = cal_index)]
pub struct NewCalIndex {
    /// Reference to the canonical entity.
    pub entity_id: Uuid,
    /// Reference to the indexed component (VEVENT, VTODO, etc.).
    pub component_id: Uuid,
    /// Component type (e.g., "VEVENT", "VTODO").
    pub component_type: ComponentType,
    /// UID of the component.
    pub uid: Option<String>,
    /// RECURRENCE-ID in UTC (for exception instances).
    pub recurrence_id_utc: Option<DateTime<Utc>>,
    /// Start time in UTC.
    pub dtstart_utc: Option<DateTime<Utc>>,
    /// End time in UTC.
    pub dtend_utc: Option<DateTime<Utc>>,
    /// Whether this is an all-day event.
    pub all_day: Option<bool>,
    /// RRULE text for recurring events.
    pub rrule_text: Option<String>,
    /// Flexible metadata (summary, location, organizer, attendees, etc.).
    pub metadata: Option<JsonValue>,
}
