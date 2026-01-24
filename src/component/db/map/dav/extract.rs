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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::component::rfc::ical::core::{Date, DateTime, DateTimeForm};
    use chrono::{Datelike, Timelike};

    #[test]
    fn extract_ical_text_value() {
        let value = Value::Text("Hello World".to_string());
        let (vtype, vtext, vint, vfloat, vbool, vdate, vtstz) =
            extract_ical_value(&value, "Hello World").unwrap();
        
        assert_eq!(vtype, "text");
        assert_eq!(vtext, Some("Hello World"));
        assert_eq!(vint, None);
        assert_eq!(vfloat, None);
        assert_eq!(vbool, None);
        assert_eq!(vdate, None);
        assert_eq!(vtstz, None);
    }

    #[test]
    fn extract_ical_integer_value() {
        let value = Value::Integer(42);
        let (vtype, vtext, vint, _, _, _, _) =
            extract_ical_value(&value, "42").unwrap();
        
        assert_eq!(vtype, "integer");
        assert_eq!(vtext, None);
        assert_eq!(vint, Some(42));
    }

    #[test]
    fn extract_ical_float_value() {
        let value = Value::Float(42.5);
        let (vtype, vtext, vint, vfloat, _, _, _) =
            extract_ical_value(&value, "42.5").unwrap();
        
        assert_eq!(vtype, "float");
        assert_eq!(vtext, None);
        assert_eq!(vint, None);
        assert_eq!(vfloat, Some(42.5));
    }

    #[test]
    fn extract_ical_boolean_true() {
        let value = Value::Boolean(true);
        let (vtype, _, _, _, vbool, _, _) =
            extract_ical_value(&value, "TRUE").unwrap();
        
        assert_eq!(vtype, "boolean");
        assert_eq!(vbool, Some(true));
    }

    #[test]
    fn extract_ical_boolean_false() {
        let value = Value::Boolean(false);
        let (vtype, _, _, _, vbool, _, _) =
            extract_ical_value(&value, "FALSE").unwrap();
        
        assert_eq!(vtype, "boolean");
        assert_eq!(vbool, Some(false));
    }

    #[test]
    fn extract_ical_date_value() {
        let value = Value::Date(Date {
            year: 2026,
            month: 1,
            day: 24,
        });
        let (vtype, _, _, _, _, vdate, _) =
            extract_ical_value(&value, "20260124").unwrap();
        
        assert_eq!(vtype, "date");
        assert_eq!(vdate, chrono::NaiveDate::from_ymd_opt(2026, 1, 24));
    }

    #[test]
    fn extract_ical_datetime_utc() {
        let value = Value::DateTime(DateTime {
            year: 2026,
            month: 1,
            day: 24,
            hour: 12,
            minute: 30,
            second: 45,
            form: DateTimeForm::Utc,
        });
        let (vtype, _, _, _, _, _, vtstz) =
            extract_ical_value(&value, "20260124T123045Z").unwrap();
        
        assert_eq!(vtype, "datetime");
        assert!(vtstz.is_some());
        let dt = vtstz.unwrap();
        // Check date components using the date() method
        let date = dt.date_naive();
        assert_eq!(date.year(), 2026);
        assert_eq!(date.month(), 1);
        assert_eq!(date.day(), 24);
        // Check time components using the time() method
        let time = dt.time();
        assert_eq!(time.hour(), 12);
        assert_eq!(time.minute(), 30);
        assert_eq!(time.second(), 45);
    }

    #[test]
    fn extract_ical_duration_as_text() {
        let value = Value::Duration(crate::component::rfc::ical::core::Duration {
            negative: false,
            weeks: 0,
            days: 1,
            hours: 2,
            minutes: 30,
            seconds: 0,
        });
        let (vtype, vtext, _, _, _, _, _) =
            extract_ical_value(&value, "P1DT2H30M").unwrap();
        
        assert_eq!(vtype, "text");
        assert_eq!(vtext, Some("P1DT2H30M"));
    }

    #[test]
    fn extract_vcard_text_value() {
        let value = VCardValue::Text("John Doe".to_string());
        let (vtype, vtext, vint, vfloat, vbool, vjson) =
            extract_vcard_value(&value, "John Doe");
        
        assert_eq!(vtype, "text");
        assert_eq!(vtext, Some("John Doe"));
        assert_eq!(vint, None);
        assert_eq!(vfloat, None);
        assert_eq!(vbool, None);
        assert_eq!(vjson, None);
    }

    #[test]
    fn extract_vcard_integer_value() {
        let value = VCardValue::Integer(100);
        let (vtype, vtext, vint, _, _, _) =
            extract_vcard_value(&value, "100");
        
        assert_eq!(vtype, "integer");
        assert_eq!(vtext, None);
        assert_eq!(vint, Some(100));
    }

    #[test]
    fn extract_vcard_float_value() {
        let value = VCardValue::Float(12.34);
        let (vtype, vtext, vint, vfloat, _, _) =
            extract_vcard_value(&value, "12.34");
        
        assert_eq!(vtype, "float");
        assert_eq!(vtext, None);
        assert_eq!(vint, None);
        assert_eq!(vfloat, Some(12.34));
    }

    #[test]
    fn extract_vcard_boolean_value() {
        let value = VCardValue::Boolean(true);
        let (vtype, _, _, _, vbool, _) =
            extract_vcard_value(&value, "true");
        
        assert_eq!(vtype, "boolean");
        assert_eq!(vbool, Some(true));
    }

    #[test]
    fn extract_ical_uid_present() {
        use crate::component::rfc::ical::core::{Component, ComponentKind, Property};
        
        let component = Component {
            kind: Some(ComponentKind::Event),
            name: "VEVENT".to_string(),
            properties: vec![
                Property {
                    name: "SUMMARY".to_string(),
                    params: vec![],
                    value: Value::Text("Test Event".to_string()),
                    raw_value: "Test Event".to_string(),
                },
                Property {
                    name: "UID".to_string(),
                    params: vec![],
                    value: Value::Text("unique-id-123".to_string()),
                    raw_value: "unique-id-123".to_string(),
                },
            ],
            children: vec![],
        };
        
        assert_eq!(extract_ical_uid(&component), Some("unique-id-123".to_string()));
    }

    #[test]
    fn extract_ical_uid_missing() {
        use crate::component::rfc::ical::core::{Component, ComponentKind, Property};
        
        let component = Component {
            kind: Some(ComponentKind::Event),
            name: "VEVENT".to_string(),
            properties: vec![
                Property {
                    name: "SUMMARY".to_string(),
                    params: vec![],
                    value: Value::Text("Test Event".to_string()),
                    raw_value: "Test Event".to_string(),
                },
            ],
            children: vec![],
        };
        
        assert_eq!(extract_ical_uid(&component), None);
    }
}
