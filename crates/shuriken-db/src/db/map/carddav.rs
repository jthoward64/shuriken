//! DB <-> CardDAV mapping helpers.

use uuid::Uuid;

use crate::model::carddav::card_index::NewCardIndex;
use shuriken_rfc::rfc::vcard::VCard;

/// ## Summary
/// Builds a `NewCardIndex` from a parsed vCard and its entity ID.
///
/// Extracts indexable properties (UID, FN) and all other data into JSONB
/// for efficient addressbook-query operations.
#[must_use]
pub fn build_card_index(entity_id: Uuid, vcard: &VCard) -> NewCardIndex {
    let uid = vcard.uid().map(String::from);
    let fn_ = vcard.formatted_name().map(String::from);

    // Build data JSONB object with all structured data
    let mut data = serde_json::json!({});

    // Extract N (structured name) components
    if let Some(name) = vcard.name() {
        if let Some(family) = name.family.first() {
            data["n_family"] = serde_json::Value::String(family.clone());
        }
        if let Some(given) = name.given.first() {
            data["n_given"] = serde_json::Value::String(given.clone());
        }
    }

    // Extract ORG (organization)
    if let Some(org) = vcard.organization() {
        data["org"] = serde_json::Value::String(org.name.clone());
    }

    // Extract TITLE
    if let Some(title) = vcard.title() {
        data["title"] = serde_json::Value::String(title.to_string());
    }

    // Extract all EMAIL properties as array
    let emails: Vec<String> = vcard
        .emails()
        .into_iter()
        .map(std::string::ToString::to_string)
        .collect();
    if !emails.is_empty() {
        data["emails"] =
            serde_json::Value::Array(emails.into_iter().map(serde_json::Value::String).collect());
    }

    // Extract all TEL properties as array
    let phones: Vec<String> = vcard
        .telephones()
        .into_iter()
        .map(std::string::ToString::to_string)
        .collect();
    if !phones.is_empty() {
        data["phones"] =
            serde_json::Value::Array(phones.into_iter().map(serde_json::Value::String).collect());
    }

    NewCardIndex {
        entity_id,
        uid,
        fn_,
        data: Some(data),
    }
}
