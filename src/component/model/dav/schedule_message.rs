//! Models for scheduling messages (iTIP).

use chrono::{DateTime, Utc};
use diesel::prelude::*;
use uuid::Uuid;

use crate::component::db::enums::{ItipMethod, ItipStatus};
use crate::component::db::schema::dav_schedule_message;

/// Scheduling message for iTIP (RFC 6638).
///
/// Stores iTIP messages (REQUEST, REPLY, CANCEL, etc.) for calendar scheduling.
#[derive(Debug, Clone, Queryable, Selectable, Identifiable)]
#[diesel(table_name = dav_schedule_message)]
#[diesel(check_for_backend(diesel::pg::Pg))]
pub struct ScheduleMessage {
    /// UUID v7 primary key.
    pub id: Uuid,
    /// Schedule inbox or outbox collection.
    pub collection_id: Uuid,
    /// Calendar user address of sender (mailto: URI).
    pub sender: String,
    /// Calendar user address of recipient (mailto: URI).
    pub recipient: String,
    /// iTIP method (REQUEST, REPLY, CANCEL, etc.).
    pub method: ItipMethod,
    /// Delivery status (pending, delivered, failed).
    pub status: ItipStatus,
    /// iCalendar data with METHOD property.
    pub ical_data: String,
    /// Delivery diagnostics or error information.
    pub diagnostics: Option<serde_json::Value>,
    /// When the message was created.
    pub created_at: DateTime<Utc>,
    /// When the message was successfully delivered.
    pub delivered_at: Option<DateTime<Utc>>,
    /// Last update timestamp.
    pub updated_at: DateTime<Utc>,
    /// Soft delete timestamp (message processed/archived).
    pub deleted_at: Option<DateTime<Utc>>,
}

/// New scheduling message for insertion.
#[derive(Debug, Clone, Insertable)]
#[diesel(table_name = dav_schedule_message)]
pub struct NewScheduleMessage<'a> {
    /// Schedule inbox or outbox collection.
    pub collection_id: Uuid,
    /// Calendar user address of sender (mailto: URI).
    pub sender: &'a str,
    /// Calendar user address of recipient (mailto: URI).
    pub recipient: &'a str,
    /// iTIP method (REQUEST, REPLY, CANCEL, etc.).
    pub method: ItipMethod,
    /// iCalendar data with METHOD property.
    pub ical_data: &'a str,
}

impl<'a> NewScheduleMessage<'a> {
    /// Creates a new scheduling message.
    #[must_use]
    pub fn new(
        collection_id: Uuid,
        sender: &'a str,
        recipient: &'a str,
        method: ItipMethod,
        ical_data: &'a str,
    ) -> Self {
        Self {
            collection_id,
            sender,
            recipient,
            method,
            ical_data,
        }
    }
}
