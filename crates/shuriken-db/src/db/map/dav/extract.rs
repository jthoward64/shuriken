//! Value extraction utilities for iCalendar and vCard.

use crate::db::enums::ValueType;
use crate::db::pg_types::{PgInterval, PgTstzRange};
use shuriken_rfc::rfc::ical::core::{Component, Value};
use shuriken_rfc::rfc::ical::expand::TimeZoneResolver;
use shuriken_rfc::rfc::vcard::core::{VCard, VCardValue};

/// ## Summary
/// Extracts typed value fields from an iCalendar Value.
#[expect(clippy::too_many_lines)]
pub(super) fn extract_ical_value<'a>(
    value: &Value,
    raw: &'a str,
    resolver: &mut TimeZoneResolver,
) -> anyhow::Result<ExtractedValue<'a>> {
    match value {
        Value::Text(_) => Ok(ExtractedValue::with_text(ValueType::Text, Some(raw))),
        Value::TextList(list) => Ok(ExtractedValue {
            value_type: ValueType::TextList,
            value_text_array: Some(list.iter().map(|s| Some(s.clone())).collect()),
            ..ExtractedValue::empty()
        }),
        Value::CalAddress(_) | Value::Uri(_) => {
            Ok(ExtractedValue::with_text(ValueType::Uri, Some(raw)))
        }
        Value::Integer(i) => Ok(ExtractedValue {
            value_type: ValueType::Integer,
            value_int: Some(i64::from(*i)),
            ..ExtractedValue::empty()
        }),
        Value::Float(f) => Ok(ExtractedValue {
            value_type: ValueType::Float,
            value_float: Some(*f),
            ..ExtractedValue::empty()
        }),
        Value::Boolean(b) => Ok(ExtractedValue {
            value_type: ValueType::Boolean,
            value_bool: Some(*b),
            ..ExtractedValue::empty()
        }),
        Value::Date(d) => {
            let naive = chrono::NaiveDate::from_ymd_opt(
                i32::from(d.year),
                u32::from(d.month),
                u32::from(d.day),
            )
            .ok_or_else(|| anyhow::anyhow!("Invalid date"))?;
            Ok(ExtractedValue {
                value_type: ValueType::Date,
                value_date: Some(naive),
                ..ExtractedValue::empty()
            })
        }
        Value::DateTime(dt) => {
            // Convert to UTC if possible
            let tstz = datetime_to_utc(dt, resolver)?;
            Ok(ExtractedValue {
                value_type: ValueType::DateTime,
                value_tstz: Some(tstz),
                ..ExtractedValue::empty()
            })
        }
        Value::DateList(list) => {
            let mut dates = Vec::with_capacity(list.len());
            for d in list {
                let naive = chrono::NaiveDate::from_ymd_opt(
                    i32::from(d.year),
                    u32::from(d.month),
                    u32::from(d.day),
                )
                .ok_or_else(|| anyhow::anyhow!("Invalid date"))?;
                dates.push(Some(naive));
            }
            Ok(ExtractedValue {
                value_type: ValueType::DateList,
                value_date_array: Some(dates),
                ..ExtractedValue::empty()
            })
        }
        Value::DateTimeList(list) => {
            let mut values = Vec::with_capacity(list.len());
            for dt in list {
                let tstz = datetime_to_utc(dt, resolver)?;
                values.push(Some(tstz));
            }
            Ok(ExtractedValue {
                value_type: ValueType::DateTimeList,
                value_tstz_array: Some(values),
                ..ExtractedValue::empty()
            })
        }
        Value::Time(t) => {
            let time = chrono::NaiveTime::from_hms_opt(
                u32::from(t.hour),
                u32::from(t.minute),
                u32::from(t.second),
            )
            .ok_or_else(|| anyhow::anyhow!("Invalid time"))?;
            Ok(ExtractedValue {
                value_type: ValueType::Time,
                value_time: Some(time),
                ..ExtractedValue::empty()
            })
        }
        Value::Duration(duration) => Ok(ExtractedValue {
            value_type: ValueType::DurationInterval,
            value_interval: Some(duration_to_interval(duration)),
            ..ExtractedValue::empty()
        }),
        Value::UtcOffset(offset) => Ok(ExtractedValue {
            value_type: ValueType::UtcOffsetInterval,
            value_interval: Some(PgInterval::from_seconds(i64::from(offset.as_seconds()))),
            ..ExtractedValue::empty()
        }),
        Value::Period(period) => Ok(ExtractedValue {
            value_type: ValueType::Period,
            value_tstzrange: Some(period_to_range(period, resolver)?),
            ..ExtractedValue::empty()
        }),
        Value::PeriodList(list) => Ok(ExtractedValue {
            value_type: ValueType::PeriodList,
            value_tstzrange: period_list_to_range(list, resolver)?,
            ..ExtractedValue::empty()
        }),
        Value::Recur(_) | Value::Binary(_) | Value::Unknown(_) => {
            Ok(ExtractedValue::with_text(ValueType::Text, Some(raw)))
        }
    }
}

/// ## Summary
/// Extracts typed value fields from a vCard Value.
pub(super) fn extract_vcard_value<'a>(value: &VCardValue, raw: &'a str) -> ExtractedValue<'a> {
    match value {
        VCardValue::Text(_)
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
            ExtractedValue::with_text(ValueType::Text, Some(raw))
        }
        VCardValue::TextList(list) => ExtractedValue {
            value_type: ValueType::TextList,
            value_text_array: Some(list.iter().map(|s| Some(s.clone())).collect()),
            ..ExtractedValue::empty()
        },
        VCardValue::Timestamp(ts) => {
            // Store timestamp in value_tstz column
            ExtractedValue {
                value_type: ValueType::DateTime,
                value_tstz: Some(ts.datetime),
                ..ExtractedValue::empty()
            }
        }
        VCardValue::Integer(i) => ExtractedValue {
            value_type: ValueType::Integer,
            value_int: Some(*i),
            ..ExtractedValue::empty()
        },
        VCardValue::Float(f) => ExtractedValue {
            value_type: ValueType::Float,
            value_float: Some(*f),
            ..ExtractedValue::empty()
        },
        VCardValue::Boolean(b) => ExtractedValue {
            value_type: ValueType::Boolean,
            value_bool: Some(*b),
            ..ExtractedValue::empty()
        },
    }
}

#[derive(Debug, Clone, PartialEq)]
#[expect(clippy::struct_field_names)]
pub(super) struct ExtractedValue<'a> {
    pub value_type: ValueType,
    pub value_text: Option<&'a str>,
    pub value_int: Option<i64>,
    pub value_float: Option<f64>,
    pub value_bool: Option<bool>,
    pub value_date: Option<chrono::NaiveDate>,
    pub value_tstz: Option<chrono::DateTime<chrono::Utc>>,
    pub value_text_array: Option<Vec<Option<String>>>,
    pub value_date_array: Option<Vec<Option<chrono::NaiveDate>>>,
    pub value_tstz_array: Option<Vec<Option<chrono::DateTime<chrono::Utc>>>>,
    pub value_time: Option<chrono::NaiveTime>,
    pub value_interval: Option<PgInterval>,
    pub value_tstzrange: Option<PgTstzRange>,
}

impl<'a> ExtractedValue<'a> {
    #[must_use]
    pub fn empty() -> Self {
        Self {
            value_type: ValueType::Text,
            value_text: None,
            value_int: None,
            value_float: None,
            value_bool: None,
            value_date: None,
            value_tstz: None,
            value_text_array: None,
            value_date_array: None,
            value_tstz_array: None,
            value_time: None,
            value_interval: None,
            value_tstzrange: None,
        }
    }

    #[must_use]
    pub fn with_text(value_type: ValueType, value_text: Option<&'a str>) -> Self {
        Self {
            value_type,
            value_text,
            ..Self::empty()
        }
    }
}

fn duration_to_interval(duration: &shuriken_rfc::rfc::ical::core::Duration) -> PgInterval {
    let weeks_days = duration
        .weeks
        .saturating_mul(7)
        .saturating_add(duration.days);
    let days = i32::try_from(weeks_days).unwrap_or(i32::MAX);
    let seconds = i64::from(duration.hours) * 3600
        + i64::from(duration.minutes) * 60
        + i64::from(duration.seconds);

    let mut interval = PgInterval::new(0, days, seconds * 1_000_000);
    if duration.negative {
        interval = PgInterval::new(0, -interval.days, -interval.microseconds);
    }

    interval
}

fn duration_to_chrono(duration: &shuriken_rfc::rfc::ical::core::Duration) -> chrono::Duration {
    let weeks_days = i64::from(duration.weeks) * 7 + i64::from(duration.days);
    let seconds = i64::from(duration.hours) * 3600
        + i64::from(duration.minutes) * 60
        + i64::from(duration.seconds);
    let mut total = chrono::Duration::days(weeks_days) + chrono::Duration::seconds(seconds);
    if duration.negative {
        total = -total;
    }
    total
}

fn period_to_range(
    period: &shuriken_rfc::rfc::ical::core::Period,
    resolver: &mut TimeZoneResolver,
) -> anyhow::Result<PgTstzRange> {
    let (start, end) = match period {
        shuriken_rfc::rfc::ical::core::Period::Explicit { start, end } => {
            let start = datetime_to_utc(start, resolver)?;
            let end = datetime_to_utc(end, resolver)?;
            (start, end)
        }
        shuriken_rfc::rfc::ical::core::Period::Duration { start, duration } => {
            let start = datetime_to_utc(start, resolver)?;
            let end = start + duration_to_chrono(duration);
            (start, end)
        }
    };

    Ok(PgTstzRange::inclusive(start, end))
}

fn period_list_to_range(
    list: &[shuriken_rfc::rfc::ical::core::Period],
    resolver: &mut TimeZoneResolver,
) -> anyhow::Result<Option<PgTstzRange>> {
    let mut min_start: Option<chrono::DateTime<chrono::Utc>> = None;
    let mut max_end: Option<chrono::DateTime<chrono::Utc>> = None;

    for period in list {
        let range = period_to_range(period, resolver)?;
        let Some(start) = range.lower else {
            continue;
        };
        let Some(end) = range.upper else {
            continue;
        };

        min_start = Some(min_start.map_or(start, |current| current.min(start)));
        max_end = Some(max_end.map_or(end, |current| current.max(end)));
    }

    Ok(match (min_start, max_end) {
        (Some(start), Some(end)) => Some(PgTstzRange::inclusive(start, end)),
        _ => None,
    })
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
    use chrono::{Datelike, TimeZone, Timelike};
    use shuriken_rfc::rfc::ical::core::{
        Component, ComponentKind, Date, DateTime, DateTimeForm, Property,
    };

    fn extract_ical_value_for_test<'a>(value: &Value, raw: &'a str) -> ExtractedValue<'a> {
        let mut resolver = TimeZoneResolver::new();
        extract_ical_value(value, raw, &mut resolver).unwrap()
    }

    #[test]
    fn extract_ical_text_value() {
        let value = Value::Text("Hello World".to_string());
        let extracted = extract_ical_value_for_test(&value, "Hello World");

        assert_eq!(extracted.value_type, ValueType::Text);
        assert_eq!(extracted.value_text, Some("Hello World"));
        assert_eq!(extracted.value_int, None);
        assert_eq!(extracted.value_float, None);
        assert_eq!(extracted.value_bool, None);
        assert_eq!(extracted.value_date, None);
        assert_eq!(extracted.value_tstz, None);
    }

    #[test]
    fn extract_ical_integer_value() {
        let value = Value::Integer(42);
        let extracted = extract_ical_value_for_test(&value, "42");

        assert_eq!(extracted.value_type, ValueType::Integer);
        assert_eq!(extracted.value_text, None);
        assert_eq!(extracted.value_int, Some(42));
    }

    #[test]
    fn extract_ical_float_value() {
        let value = Value::Float(42.5);
        let extracted = extract_ical_value_for_test(&value, "42.5");

        assert_eq!(extracted.value_type, ValueType::Float);
        assert_eq!(extracted.value_text, None);
        assert_eq!(extracted.value_int, None);
        assert_eq!(extracted.value_float, Some(42.5));
    }

    #[test]
    fn extract_ical_boolean_true() {
        let value = Value::Boolean(true);
        let extracted = extract_ical_value_for_test(&value, "TRUE");

        assert_eq!(extracted.value_type, ValueType::Boolean);
        assert_eq!(extracted.value_bool, Some(true));
    }

    #[test]
    fn extract_ical_boolean_false() {
        let value = Value::Boolean(false);
        let extracted = extract_ical_value_for_test(&value, "FALSE");

        assert_eq!(extracted.value_type, ValueType::Boolean);
        assert_eq!(extracted.value_bool, Some(false));
    }

    #[test]
    fn extract_ical_date_value() {
        let value = Value::Date(Date {
            year: 2026,
            month: 1,
            day: 24,
        });
        let extracted = extract_ical_value_for_test(&value, "20260124");

        assert_eq!(extracted.value_type, ValueType::Date);
        assert_eq!(
            extracted.value_date,
            chrono::NaiveDate::from_ymd_opt(2026, 1, 24)
        );
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
        let extracted = extract_ical_value_for_test(&value, "20260124T123045Z");

        assert_eq!(extracted.value_type, ValueType::DateTime);
        assert!(extracted.value_tstz.is_some());
        let dt = extracted.value_tstz.unwrap();
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
    fn extract_ical_duration_interval() {
        let value = Value::Duration(shuriken_rfc::rfc::ical::core::Duration {
            negative: false,
            weeks: 0,
            days: 1,
            hours: 2,
            minutes: 30,
            seconds: 0,
        });
        let extracted = extract_ical_value_for_test(&value, "P1DT2H30M");

        assert_eq!(extracted.value_type, ValueType::DurationInterval);
        assert!(extracted.value_interval.is_some());
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

        let vtimezone =
            shuriken_rfc::rfc::ical::expand::VTimezone::parse(&timezone).expect("valid VTIMEZONE");

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

        let extracted = extract_ical_value(&value, "20260115T100000", &mut resolver).unwrap();

        assert_eq!(extracted.value_type, crate::db::enums::ValueType::DateTime);
        let expected = chrono::Utc.with_ymd_and_hms(2026, 1, 15, 8, 0, 0).unwrap();
        assert_eq!(extracted.value_tstz, Some(expected));
    }

    #[test]
    fn extract_vcard_text_value() {
        let value = VCardValue::Text("John Doe".to_string());
        let extracted = extract_vcard_value(&value, "John Doe");

        assert_eq!(extracted.value_type, crate::db::enums::ValueType::Text);
        assert_eq!(extracted.value_text, Some("John Doe"));
        assert_eq!(extracted.value_int, None);
        assert_eq!(extracted.value_float, None);
        assert_eq!(extracted.value_bool, None);
        assert_eq!(extracted.value_date, None);
        assert_eq!(extracted.value_tstz, None);
    }

    #[test]
    fn extract_vcard_integer_value() {
        let value = VCardValue::Integer(100);
        let extracted = extract_vcard_value(&value, "100");

        assert_eq!(extracted.value_type, crate::db::enums::ValueType::Integer);
        assert_eq!(extracted.value_text, None);
        assert_eq!(extracted.value_int, Some(100));
    }

    #[test]
    fn extract_vcard_float_value() {
        let value = VCardValue::Float(12.34);
        let extracted = extract_vcard_value(&value, "12.34");

        assert_eq!(extracted.value_type, crate::db::enums::ValueType::Float);
        assert_eq!(extracted.value_text, None);
        assert_eq!(extracted.value_int, None);
        assert_eq!(extracted.value_float, Some(12.34));
    }

    #[test]
    fn extract_vcard_boolean_value() {
        let value = VCardValue::Boolean(true);
        let extracted = extract_vcard_value(&value, "true");

        assert_eq!(extracted.value_type, crate::db::enums::ValueType::Boolean);
        assert_eq!(extracted.value_bool, Some(true));
    }

    #[test]
    fn extract_vcard_timestamp_value() {
        use chrono::{TimeZone, Utc};
        use shuriken_rfc::rfc::vcard::core::Timestamp;

        let dt = Utc.with_ymd_and_hms(2024, 1, 15, 12, 30, 0).unwrap();
        let value = VCardValue::Timestamp(Timestamp { datetime: dt });
        let extracted = extract_vcard_value(&value, "20240115T123000Z");

        assert_eq!(extracted.value_type, crate::db::enums::ValueType::DateTime);
        assert_eq!(extracted.value_text, None);
        assert_eq!(extracted.value_int, None);
        assert_eq!(extracted.value_float, None);
        assert_eq!(extracted.value_bool, None);
        assert_eq!(extracted.value_date, None);
        assert_eq!(extracted.value_tstz, Some(dt));
    }

    #[test]
    fn extract_ical_text_list_value() {
        let value = Value::TextList(vec!["One".to_string(), "Two".to_string()]);
        let extracted = extract_ical_value_for_test(&value, "One,Two");

        assert_eq!(extracted.value_type, ValueType::TextList);
        let list = extracted.value_text_array.expect("text array");
        assert_eq!(list.len(), 2);
    }

    #[test]
    fn extract_ical_date_list_value() {
        let value = Value::DateList(vec![
            Date {
                year: 2026,
                month: 1,
                day: 24,
            },
            Date {
                year: 2026,
                month: 1,
                day: 25,
            },
        ]);
        let extracted = extract_ical_value_for_test(&value, "20260124,20260125");

        assert_eq!(extracted.value_type, ValueType::DateList);
        let list = extracted.value_date_array.expect("date array");
        assert_eq!(list.len(), 2);
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
