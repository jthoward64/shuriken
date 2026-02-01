//! Shared JSONB key helpers for CardDAV index data.

use serde_json::Value;

/// JSONB key for N family name.
pub const KEY_N_FAMILY: &str = "n_family";
/// JSONB key for N given name.
pub const KEY_N_GIVEN: &str = "n_given";
/// JSONB key for ORG.
pub const KEY_ORG: &str = "org";
/// JSONB key for TITLE.
pub const KEY_TITLE: &str = "title";
/// JSONB key for emails array.
pub const KEY_EMAILS: &str = "emails";
/// JSONB key for phones array.
pub const KEY_PHONES: &str = "phones";

/// CardDAV JSONB key type.
pub enum CardDavJsonKey<'a> {
    /// Single scalar JSON string value.
    Scalar(&'a str),
    /// Array of string values.
    Array(&'a str),
    /// Multiple scalar keys (e.g., N family/given).
    Multi(&'a [&'a str]),
}

/// Resolves a CardDAV property name to JSONB key(s).
#[must_use]
pub fn json_key_for_property(prop_name: &str) -> Option<CardDavJsonKey<'static>> {
    match prop_name.to_uppercase().as_str() {
        "N" => Some(CardDavJsonKey::Multi(&[KEY_N_FAMILY, KEY_N_GIVEN])),
        "ORG" => Some(CardDavJsonKey::Scalar(KEY_ORG)),
        "TITLE" => Some(CardDavJsonKey::Scalar(KEY_TITLE)),
        "EMAIL" => Some(CardDavJsonKey::Array(KEY_EMAILS)),
        "TEL" => Some(CardDavJsonKey::Array(KEY_PHONES)),
        _ => None,
    }
}

/// Inserts a string value into a JSONB object.
pub fn insert_string(data: &mut Value, key: &str, value: impl Into<String>) {
    data[key] = Value::String(value.into());
}

/// Inserts a string array into a JSONB object (if not empty).
pub fn insert_string_array<I>(data: &mut Value, key: &str, values: I)
where
    I: IntoIterator<Item = String>,
{
    let array: Vec<Value> = values.into_iter().map(Value::String).collect();
    if !array.is_empty() {
        data[key] = Value::Array(array);
    }
}
