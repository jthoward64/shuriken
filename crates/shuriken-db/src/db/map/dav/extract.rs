//! Value extraction utilities for iCalendar and vCard.

use crate::db::enums::ValueType;
use shuriken_rfc::rfc::ical::core::{Component, Value};
use shuriken_rfc::rfc::ical::expand::TimeZoneResolver;
use shuriken_rfc::rfc::vcard::core::{VCard, VCardValue};

/// ## Summary
/// Extracts typed value fields from an iCalendar Value.
///
/// Returns a tuple of (`value_type`, `value_text`, `value_int`, `value_float`, `value_bool`, `value_date`, `value_tstz`).
#[expect(
    clippy::type_complexity,
    reason = "Return tuple mirrors database column types for direct mapping"
)]
pub(super) fn extract_ical_value<'a>(
    value: &Value,
    raw: &'a str,
    resolver: &mut TimeZoneResolver,
) -> anyhow::Result<(
    ValueType,
    Option<&'a str>,
    Option<i64>,
    Option<f64>,
    Option<bool>,
    Option<chrono::NaiveDate>,
    Option<chrono::DateTime<chrono::Utc>>,
)> {
    match value {
        Value::Text(_) | Value::TextList(_) | Value::CalAddress(_) | Value::Uri(_) => {
            Ok((ValueType::Text, Some(raw), None, None, None, None, None))
        }
        Value::Integer(i) => Ok((
            ValueType::Integer,
            None,
            Some(i64::from(*i)),
            None,
            None,
            None,
            None,
        )),
        Value::Float(f) => Ok((ValueType::Float, None, None, Some(*f), None, None, None)),
        Value::Boolean(b) => Ok((ValueType::Boolean, None, None, None, Some(*b), None, None)),
        Value::Date(d) => {
            let naive = chrono::NaiveDate::from_ymd_opt(
                i32::from(d.year),
                u32::from(d.month),
                u32::from(d.day),
            )
            .ok_or_else(|| anyhow::anyhow!("Invalid date"))?;
            Ok((ValueType::Date, None, None, None, None, Some(naive), None))
        }
        Value::DateTime(dt) => {
            // Convert to UTC if possible
            let tstz = datetime_to_utc(dt, resolver)?;
            Ok((
                ValueType::DateTime,
                None,
                None,
                None,
                None,
                None,
                Some(tstz),
            ))
        }
        Value::Duration(_)
        | Value::Period(_)
        | Value::PeriodList(_)
        | Value::Recur(_)
        | Value::Time(_)
        | Value::UtcOffset(_)
        | Value::Binary(_)
        | Value::Unknown(_) => {
            // Store complex types as text (raw value)
            Ok((ValueType::Text, Some(raw), None, None, None, None, None))
        }
        Value::DateList(_) | Value::DateTimeList(_) => {
            // Store list types as text (raw value) for now
            // TODO: Consider storing first element or handling lists specially
            Ok((ValueType::Text, Some(raw), None, None, None, None, None))
        }
    }
}

/// ## Summary
/// Extracts typed value fields from a vCard Value.
///
/// Returns a tuple of (`value_type`, `value_text`, `value_int`, `value_float`, `value_bool`, `value_date`, `value_tstz`).
#[expect(
    clippy::type_complexity,
    reason = "Return tuple mirrors database column types for direct mapping"
)]
pub(super) fn extract_vcard_value<'a>(
    value: &VCardValue,
    raw: &'a str,
) -> (
    ValueType,
    Option<&'a str>,
    Option<i64>,
    Option<f64>,
    Option<bool>,
    Option<chrono::NaiveDate>,
    Option<chrono::DateTime<chrono::Utc>>,
) {
    match value {
        VCardValue::Text(_)
        | VCardValue::TextList(_)
        | VCardValue::Uri(_)
        | VCardValue::LanguageTag(_)
        | VCardValue::DateAndOrTime(_)
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
            (ValueType::Text, Some(raw), None, None, None, None, None)
        }
        VCardValue::Timestamp(ts) => {
            // Store timestamp in value_tstz column
            (
                ValueType::DateTime,
                None,
                None,
                None,
                None,
                None,
                Some(ts.datetime),
            )
        }
        VCardValue::Integer(i) => (ValueType::Integer, None, Some(*i), None, None, None, None),
        VCardValue::Float(f) => (ValueType::Float, None, None, Some(*f), None, None, None),
        VCardValue::Boolean(b) => (ValueType::Boolean, None, None, None, Some(*b), None, None),
    }
}

/// ## Summary
/// Converts an iCalendar `DateTime` to UTC.
fn datetime_to_utc(
    dt: &shuriken_rfc::rfc::ical::core::DateTime,
    resolver: &mut TimeZoneResolver,
) -> anyhow::Result<chrono::DateTime<chrono::Utc>> {
    use shuriken_rfc::rfc::ical::core::DateTimeForm;
    use shuriken_rfc::rfc::ical::expand::convert_to_utc;

    let naive = chrono::NaiveDateTime::new(
        chrono::NaiveDate::from_ymd_opt(i32::from(dt.year), u32::from(dt.month), u32::from(dt.day))
            .ok_or_else(|| anyhow::anyhow!("Invalid date"))?,
        chrono::NaiveTime::from_hms_opt(
            u32::from(dt.hour),
            u32::from(dt.minute),
            u32::from(dt.second),
        )
        .ok_or_else(|| anyhow::anyhow!("Invalid time"))?,
    );

    if matches!(dt.form, DateTimeForm::Utc | DateTimeForm::Floating) {
        return Ok(chrono::DateTime::from_naive_utc_and_offset(
            naive,
            chrono::Utc,
        ));
    }

    if let DateTimeForm::Zoned { tzid } = &dt.form {
        return convert_to_utc(naive, tzid, resolver)
            .map_err(|err| anyhow::anyhow!("TZID conversion failed: {err}"));
    }

    Err(anyhow::anyhow!("Unsupported datetime form"))
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
    use shuriken_rfc::rfc::ical::core::{
        Component, ComponentKind, Date, DateTime, DateTimeForm, Property,
    };
    use chrono::{Datelike, TimeZone, Timelike};

    type IcalValueTuple<'a> = (
        ValueType,
        Option<&'a str>,
        Option<i64>,
        Option<f64>,
        Option<bool>,
        Option<chrono::NaiveDate>,
        Option<chrono::DateTime<chrono::Utc>>,
    );

    fn extract_ical_value_for_test<'a>(value: &Value, raw: &'a str) -> IcalValueTuple<'a> {
        let mut resolver = TimeZoneResolver::new();
        extract_ical_value(value, raw, &mut resolver).unwrap()
    }

    #[test]
    fn extract_ical_text_value() {
        let value = Value::Text("Hello World".to_string());
        let (vtype, vtext, vint, vfloat, vbool, vdate, vtstz) =
            extract_ical_value_for_test(&value, "Hello World");

        assert_eq!(vtype, ValueType::Text);
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
        let (vtype, vtext, vint, _, _, _, _) = extract_ical_value_for_test(&value, "42");

        assert_eq!(vtype, ValueType::Integer);
        assert_eq!(vtext, None);
        assert_eq!(vint, Some(42));
    }

    #[test]
    fn extract_ical_float_value() {
        let value = Value::Float(42.5);
        let (vtype, vtext, vint, vfloat, _, _, _) = extract_ical_value_for_test(&value, "42.5");

        assert_eq!(vtype, ValueType::Float);
        assert_eq!(vtext, None);
        assert_eq!(vint, None);
        assert_eq!(vfloat, Some(42.5));
    }

    #[test]
    fn extract_ical_boolean_true() {
        let value = Value::Boolean(true);
        let (vtype, _, _, _, vbool, _, _) = extract_ical_value_for_test(&value, "TRUE");

        assert_eq!(vtype, ValueType::Boolean);
        assert_eq!(vbool, Some(true));
    }

    #[test]
    fn extract_ical_boolean_false() {
        let value = Value::Boolean(false);
        let (vtype, _, _, _, vbool, _, _) = extract_ical_value_for_test(&value, "FALSE");

        assert_eq!(vtype, ValueType::Boolean);
        assert_eq!(vbool, Some(false));
    }

    #[test]
    fn extract_ical_date_value() {
        let value = Value::Date(Date {
            year: 2026,
            month: 1,
            day: 24,
        });
        let (vtype, _, _, _, _, vdate, _) = extract_ical_value_for_test(&value, "20260124");

        assert_eq!(vtype, ValueType::Date);
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
        let (vtype, _, _, _, _, _, vtstz) = extract_ical_value_for_test(&value, "20260124T123045Z");

        assert_eq!(vtype, ValueType::DateTime);
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
        let value = Value::Duration(shuriken_rfc::rfc::ical::core::Duration {
            negative: false,
            weeks: 0,
            days: 1,
            hours: 2,
            minutes: 30,
            seconds: 0,
        });
        let (vtype, vtext, _, _, _, _, _) = extract_ical_value_for_test(&value, "P1DT2H30M");

        assert_eq!(vtype, ValueType::Text);
        assert_eq!(vtext, Some("P1DT2H30M"));
    }

    #[test]
    fn extract_ical_datetime_zoned_uses_vtimezone() {
        let mut timezone = Component::new(ComponentKind::Timezone);
        timezone.add_property(Property::text("TZID", "Test/Fixed"));

        let mut standard = Component::new(ComponentKind::Standard);
        standard.add_property(Property::datetime(
            "DTSTART",
            DateTime::floating(2026, 1, 1, 0, 0, 0),
        ));
        standard.add_property(Property::text("TZOFFSETFROM", "+0200"));
        standard.add_property(Property::text("TZOFFSETTO", "+0200"));
        timezone.add_child(standard);

        let vtimezone = shuriken_rfc::rfc::ical::expand::VTimezone::parse(&timezone)
            .expect("valid VTIMEZONE");

        let mut resolver = TimeZoneResolver::new();
        resolver.register_vtimezone(vtimezone);

        let value = Value::DateTime(DateTime {
            year: 2026,
            month: 1,
            day: 15,
            hour: 10,
            minute: 0,
            second: 0,
            form: DateTimeForm::Zoned {
                tzid: "Test/Fixed".to_string(),
            },
        });

        let (vtype, _, _, _, _, _, vtstz) =
            extract_ical_value(&value, "20260115T100000", &mut resolver).unwrap();

        assert_eq!(vtype, crate::db::enums::ValueType::DateTime);
        let expected = chrono::Utc.with_ymd_and_hms(2026, 1, 15, 8, 0, 0).unwrap();
        assert_eq!(vtstz, Some(expected));
    }

    #[test]
    fn extract_vcard_text_value() {
        let value = VCardValue::Text("John Doe".to_string());
        let (vtype, vtext, vint, vfloat, vbool, vdate, vtstz) =
            extract_vcard_value(&value, "John Doe");

        assert_eq!(vtype, crate::db::enums::ValueType::Text);
        assert_eq!(vtext, Some("John Doe"));
        assert_eq!(vint, None);
        assert_eq!(vfloat, None);
        assert_eq!(vbool, None);
        assert_eq!(vdate, None);
        assert_eq!(vtstz, None);
    }

    #[test]
    fn extract_vcard_integer_value() {
        let value = VCardValue::Integer(100);
        let (vtype, vtext, vint, _, _, _, _) = extract_vcard_value(&value, "100");

        assert_eq!(vtype, crate::db::enums::ValueType::Integer);
        assert_eq!(vtext, None);
        assert_eq!(vint, Some(100));
    }

    #[test]
    fn extract_vcard_float_value() {
        let value = VCardValue::Float(12.34);
        let (vtype, vtext, vint, vfloat, _, _, _) = extract_vcard_value(&value, "12.34");

        assert_eq!(vtype, crate::db::enums::ValueType::Float);
        assert_eq!(vtext, None);
        assert_eq!(vint, None);
        assert_eq!(vfloat, Some(12.34));
    }

    #[test]
    fn extract_vcard_boolean_value() {
        let value = VCardValue::Boolean(true);
        let (vtype, _, _, _, vbool, _, _) = extract_vcard_value(&value, "true");

        assert_eq!(vtype, crate::db::enums::ValueType::Boolean);
        assert_eq!(vbool, Some(true));
    }

    #[test]
    fn extract_vcard_timestamp_value() {
        use shuriken_rfc::rfc::vcard::core::Timestamp;
        use chrono::{TimeZone, Utc};

        let dt = Utc.with_ymd_and_hms(2024, 1, 15, 12, 30, 0).unwrap();
        let value = VCardValue::Timestamp(Timestamp { datetime: dt });
        let (vtype, vtext, vint, vfloat, vbool, vdate, vtstz) =
            extract_vcard_value(&value, "20240115T123000Z");

        assert_eq!(vtype, crate::db::enums::ValueType::DateTime);
        assert_eq!(vtext, None);
        assert_eq!(vint, None);
        assert_eq!(vfloat, None);
        assert_eq!(vbool, None);
        assert_eq!(vdate, None);
        assert_eq!(vtstz, Some(dt));
    }

    #[test]
    fn extract_ical_uid_present() {
        use shuriken_rfc::rfc::ical::core::{Component, ComponentKind, Property};

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

        assert_eq!(
            extract_ical_uid(&component),
            Some("unique-id-123".to_string())
        );
    }

    #[test]
    fn extract_ical_uid_missing() {
        use shuriken_rfc::rfc::ical::core::{Component, ComponentKind, Property};

        let component = Component {
            kind: Some(ComponentKind::Event),
            name: "VEVENT".to_string(),
            properties: vec![Property {
                name: "SUMMARY".to_string(),
                params: vec![],
                value: Value::Text("Test Event".to_string()),
                raw_value: "Test Event".to_string(),
            }],
            children: vec![],
        };

        assert_eq!(extract_ical_uid(&component), None);
    }
}
