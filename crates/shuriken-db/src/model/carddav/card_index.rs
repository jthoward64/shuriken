//! Models for card index table.

use diesel::prelude::*;
use serde_json::Value as JsonValue;
use uuid::Uuid;

use crate::db::schema::card_index;

/// Card index entry.
///
/// Denormalized index for efficient addressbook-query operations.
#[derive(Debug, Clone, Queryable, Selectable, Identifiable)]
#[diesel(table_name = card_index)]
#[diesel(primary_key(entity_id))]
#[diesel(check_for_backend(diesel::pg::Pg))]
pub struct CardIndex {
    /// Reference to the canonical entity.
    pub entity_id: Uuid,
    /// UID of the vCard.
    pub uid: Option<String>,
    /// Formatted name (FN property).
    #[diesel(column_name = fn_)]
    pub fn_: Option<String>,
    /// Flexible vCard data (`n_family`, `n_given`, org, title, emails, phones, etc.).
    pub data: Option<JsonValue>,
    /// Last update timestamp.
    pub updated_at: chrono::DateTime<chrono::Utc>,
    /// Soft delete timestamp.
    pub deleted_at: Option<chrono::DateTime<chrono::Utc>>,
    /// ASCII case-folded FN for i;ascii-casemap collation.
    pub fn_ascii_fold: Option<String>,
    /// Unicode case-folded FN for i;unicode-casemap collation.
    pub fn_unicode_fold: Option<String>,
    /// ASCII case-folded data for i;ascii-casemap collation.
    pub data_ascii_fold: Option<JsonValue>,
    /// Unicode case-folded data for i;unicode-casemap collation.
    pub data_unicode_fold: Option<JsonValue>,
}

/// New card index entry for insertion.
#[derive(Debug, Clone, Insertable)]
#[diesel(table_name = card_index)]
pub struct NewCardIndex {
    /// Reference to the canonical entity.
    pub entity_id: Uuid,
    /// UID of the vCard.
    pub uid: Option<String>,
    /// Formatted name (FN property).
    #[diesel(column_name = fn_)]
    pub fn_: Option<String>,
    /// Flexible vCard data (`n_family`, `n_given`, org, title, emails, phones, etc.).
    pub data: Option<JsonValue>,
}
