//! Shared JSONB key helpers for CalDAV index metadata.

use serde_json::Value;

/// JSONB key for SUMMARY.
pub const KEY_SUMMARY: &str = "summary";
/// JSONB key for LOCATION.
pub const KEY_LOCATION: &str = "location";
/// JSONB key for DESCRIPTION.
pub const KEY_DESCRIPTION: &str = "description";
/// JSONB key for ORGANIZER.
pub const KEY_ORGANIZER: &str = "organizer";
/// JSONB key for organizer CN.
pub const KEY_ORGANIZER_CN: &str = "organizer_cn";
/// JSONB key for SEQUENCE.
pub const KEY_SEQUENCE: &str = "sequence";
/// JSONB key for TRANSP.
pub const KEY_TRANSP: &str = "transp";
/// JSONB key for STATUS.
pub const KEY_STATUS: &str = "status";
/// JSONB key for attendees array.
pub const KEY_ATTENDEES: &str = "attendees";

/// Inserts a string value into metadata.
pub fn insert_string(metadata: &mut Value, key: &str, value: impl Into<String>) {
    metadata[key] = Value::String(value.into());
}

/// Inserts a numeric value into metadata.
pub fn insert_number(metadata: &mut Value, key: &str, value: impl Into<serde_json::Number>) {
    metadata[key] = Value::Number(value.into());
}

/// Inserts an array value into metadata (if not empty).
pub fn insert_array(metadata: &mut Value, key: &str, values: Vec<Value>) {
    if !values.is_empty() {
        metadata[key] = Value::Array(values);
    }
}
