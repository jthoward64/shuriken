//! Models for card index table.

use chrono::{DateTime, Utc};
use diesel::prelude::*;
use uuid::Uuid;

use crate::component::db::schema::card_index;

/// Card index entry.
///
/// Denormalized index for efficient addressbook-query operations.
/// 
/// Note: The `search_tsv` field is managed by database triggers and not included in the Rust model.
#[derive(Debug, Clone, Identifiable)]
#[diesel(table_name = card_index)]
#[diesel(primary_key(entity_id))]
#[diesel(check_for_backend(diesel::pg::Pg))]
pub struct CardIndex {
    /// Reference to the canonical entity.
    pub entity_id: Uuid,
}

/// New card index entry for insertion.
#[derive(Debug, Clone, Insertable)]
#[diesel(table_name = card_index)]
pub struct NewCardIndex<'a> {
    /// Reference to the canonical entity.
    pub entity_id: Uuid,
    /// UID of the vCard.
    pub uid: Option<&'a str>,
    /// Formatted name (FN property).
    pub fn_: Option<&'a str>,
    /// Family name from N property.
    pub n_family: Option<&'a str>,
    /// Given name from N property.
    pub n_given: Option<&'a str>,
    /// Organization (ORG property).
    pub org: Option<&'a str>,
    /// Job title (TITLE property).
    pub title: Option<&'a str>,
}
