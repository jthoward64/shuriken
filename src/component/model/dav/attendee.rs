//! Models for calendar event attendees.

use chrono::{DateTime, Utc};
use diesel::prelude::*;
use uuid::Uuid;

use crate::component::db::schema::cal_attendee;

/// Calendar event attendee.
///
/// Derived index of calendar event attendees for efficient PARTSTAT queries.
#[derive(Debug, Clone, Queryable, Selectable, Identifiable)]
#[diesel(table_name = cal_attendee)]
#[diesel(check_for_backend(diesel::pg::Pg))]
pub struct CalAttendee {
    /// UUID v7 primary key.
    pub id: Uuid,
    /// Reference to the canonical entity.
    pub entity_id: Uuid,
    /// Reference to the component (VEVENT/VTODO).
    pub component_id: Uuid,
    /// Attendee calendar user address (mailto: URI).
    pub calendar_user_address: String,
    /// Participation status (NEEDS-ACTION, ACCEPTED, DECLINED, etc.).
    pub partstat: String,
    /// Attendee role (CHAIR, REQ-PARTICIPANT, etc.).
    pub role: Option<String>,
    /// RSVP requested flag.
    pub rsvp: Option<bool>,
    /// Common name of attendee.
    pub cn: Option<String>,
    /// Delegated from calendar user address.
    pub delegated_from: Option<String>,
    /// Delegated to calendar user address.
    pub delegated_to: Option<String>,
    /// Ordering within the attendee list.
    pub ordinal: i32,
    /// Last update timestamp.
    pub updated_at: DateTime<Utc>,
    /// Soft delete timestamp.
    pub deleted_at: Option<DateTime<Utc>>,
}

/// New calendar attendee for insertion.
#[derive(Debug, Clone, Insertable)]
#[diesel(table_name = cal_attendee)]
pub struct NewCalAttendee<'a> {
    /// Reference to the canonical entity.
    pub entity_id: Uuid,
    /// Reference to the component (VEVENT/VTODO).
    pub component_id: Uuid,
    /// Attendee calendar user address (mailto: URI).
    pub calendar_user_address: &'a str,
    /// Participation status (NEEDS-ACTION, ACCEPTED, DECLINED, etc.).
    pub partstat: &'a str,
    /// Attendee role (CHAIR, REQ-PARTICIPANT, etc.).
    pub role: Option<&'a str>,
    /// RSVP requested flag.
    pub rsvp: Option<bool>,
    /// Common name of attendee.
    pub cn: Option<&'a str>,
    /// Ordering within the attendee list.
    pub ordinal: i32,
}

impl<'a> NewCalAttendee<'a> {
    /// Creates a new calendar attendee.
    #[must_use]
    pub fn new(
        entity_id: Uuid,
        component_id: Uuid,
        calendar_user_address: &'a str,
        ordinal: i32,
    ) -> Self {
        Self {
            entity_id,
            component_id,
            calendar_user_address,
            partstat: "NEEDS-ACTION",
            role: None,
            rsvp: None,
            cn: None,
            ordinal,
        }
    }

    /// Sets the participation status.
    #[must_use]
    pub fn with_partstat(mut self, partstat: &'a str) -> Self {
        self.partstat = partstat;
        self
    }

    /// Sets the role.
    #[must_use]
    pub fn with_role(mut self, role: &'a str) -> Self {
        self.role = Some(role);
        self
    }

    /// Sets the RSVP flag.
    #[must_use]
    pub fn with_rsvp(mut self, rsvp: bool) -> Self {
        self.rsvp = Some(rsvp);
        self
    }

    /// Sets the common name.
    #[must_use]
    pub fn with_cn(mut self, cn: &'a str) -> Self {
        self.cn = Some(cn);
        self
    }
}
