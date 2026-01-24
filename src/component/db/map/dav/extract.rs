//! Value extraction utilities for iCalendar and vCard.

use crate::component::rfc::ical::core::{Component, Value};
use crate::component::rfc::vcard::core::{VCard, VCardValue};

/// ## Summary
/// Extracts typed value fields from an iCalendar Value.
///
/// Returns a tuple of (`value_type`, `value_text`, `value_int`, `value_float`, `value_bool`, `value_date`, `value_tstz`).
#[expect(clippy::type_complexity)]
pub(super) fn extract_ical_value<'a>(
    value: &Value,
    raw: &'a str,
) -> anyhow::Result<(
    &'static str,
    Option<&'a str>,
    Option<i64>,
    Option<f64>,
    Option<bool>,
    Option<chrono::NaiveDate>,
    Option<chrono::DateTime<chrono::Utc>>,
)> {
    match value {
        Value::Text(_) | Value::TextList(_) | Value::CalAddress(_) | Value::Uri(_) => {
            Ok(("text", Some(raw), None, None, None, None, None))
        }
        Value::Integer(i) => Ok(("integer", None, Some(i64::from(*i)), None, None, None, None)),
        Value::Float(f) => Ok(("float", None, None, Some(*f), None, None, None)),
        Value::Boolean(b) => Ok(("boolean", None, None, None, Some(*b), None, None)),
        Value::Date(d) => {
            let naive = chrono::NaiveDate::from_ymd_opt(
                i32::from(d.year),
                u32::from(d.month),
                u32::from(d.day),
            )
            .ok_or_else(|| anyhow::anyhow!("Invalid date"))?;
            Ok(("date", None, None, None, None, Some(naive), None))
        }
        Value::DateTime(dt) => {
            // Convert to UTC if possible
            let tstz = datetime_to_utc(dt)?;
            Ok(("datetime", None, None, None, None, None, Some(tstz)))
        }
        Value::Duration(_) | Value::Period(_) | Value::Recur(_) | Value::Time(_)
        | Value::UtcOffset(_) | Value::Binary(_) | Value::Unknown(_) => {
            // Store complex types as text (raw value)
            Ok(("text", Some(raw), None, None, None, None, None))
        }
    }
}

/// ## Summary
/// Extracts typed value fields from a vCard Value.
#[expect(clippy::type_complexity)]
pub(super) fn extract_vcard_value<'a>(
    value: &VCardValue,
    raw: &'a str,
) -> (
    &'static str,
    Option<&'a str>,
    Option<i64>,
    Option<f64>,
    Option<bool>,
    Option<&'a serde_json::Value>,
) {
    match value {
        VCardValue::Text(_)
        | VCardValue::TextList(_)
        | VCardValue::Uri(_)
        | VCardValue::LanguageTag(_)
        | VCardValue::DateAndOrTime(_)
        | VCardValue::Timestamp(_)
        | VCardValue::StructuredName(_)
        | VCardValue::Address(_)
        | VCardValue::Organization(_)
        | VCardValue::Gender(_)
        | VCardValue::ClientPidMap(_)
        | VCardValue::Related(_)
        | VCardValue::UtcOffset(_)
        | VCardValue::Binary(_)
        | VCardValue::Unknown(_) => {
            // Store text and structured types as text (raw)
            ("text", Some(raw), None, None, None, None)
        }
        VCardValue::Integer(i) => ("integer", None, Some(*i), None, None, None),
        VCardValue::Float(f) => ("float", None, None, Some(*f), None, None),
        VCardValue::Boolean(b) => ("boolean", None, None, None, Some(*b), None),
    }
}

/// ## Summary
/// Converts an iCalendar `DateTime` to UTC.
fn datetime_to_utc(
    dt: &crate::component::rfc::ical::core::DateTime,
) -> anyhow::Result<chrono::DateTime<chrono::Utc>> {
    use crate::component::rfc::ical::core::DateTimeForm;

    let naive = chrono::NaiveDateTime::new(
        chrono::NaiveDate::from_ymd_opt(i32::from(dt.year), u32::from(dt.month), u32::from(dt.day))
            .ok_or_else(|| anyhow::anyhow!("Invalid date"))?,
        chrono::NaiveTime::from_hms_opt(u32::from(dt.hour), u32::from(dt.minute), u32::from(dt.second))
            .ok_or_else(|| anyhow::anyhow!("Invalid time"))?,
    );

    match &dt.form {
        DateTimeForm::Utc => {
            Ok(chrono::DateTime::from_naive_utc_and_offset(naive, chrono::Utc))
        }
        DateTimeForm::Floating | DateTimeForm::Zoned { .. } => {
            // Treat as UTC (without timezone info for now)
            // TODO: Handle TZID resolution in the future
            Ok(chrono::DateTime::from_naive_utc_and_offset(naive, chrono::Utc))
        }
    }
}

/// ## Summary
/// Extracts the UID property from an iCalendar component.
pub(super) fn extract_ical_uid(component: &Component) -> Option<String> {
    component
        .properties
        .iter()
        .find(|p| p.name == "UID")
        .and_then(|p| p.value.as_text())
        .map(String::from)
}

/// ## Summary
/// Extracts the UID property from a vCard.
pub(super) fn extract_vcard_uid(vcard: &VCard) -> Option<String> {
    vcard
        .get_property("UID")
        .and_then(|p| p.as_text())
        .map(String::from)
}
