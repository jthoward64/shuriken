//! Helper functions for extracting and processing recurrence data from iCalendar components.

use crate::component::rfc::ical::core::{Component, DateTime as IcalDateTime};
use chrono::{DateTime, NaiveDateTime, Utc};

/// Extracted recurrence data from a VEVENT component.
#[derive(Debug, Clone)]
pub struct RecurrenceData {
    /// RRULE text (without "RRULE:" prefix).
    pub rrule: String,
    /// DTSTART in UTC.
    pub dtstart_utc: DateTime<Utc>,
    /// Event duration (DTEND - DTSTART or DURATION).
    pub duration: chrono::TimeDelta,
    /// EXDATE values in UTC.
    pub exdates: Vec<DateTime<Utc>>,
    /// RDATE values in UTC.
    pub rdates: Vec<DateTime<Utc>>,
    /// TZID parameter from DTSTART (if present).
    pub tzid: Option<String>,
}

/// ## Summary
/// Extracts recurrence data from a VEVENT component.
///
/// Parses RRULE, DTSTART, DTEND/DURATION, EXDATE, and RDATE properties.
/// Converts all date-times to UTC if TZID is present.
///
/// ## Errors
///
/// Returns `None` if:
/// - Component has no RRULE property
/// - DTSTART is missing or invalid
/// - DTEND/DURATION is missing or invalid
#[must_use]
pub fn extract_recurrence_data(component: &Component) -> Option<RecurrenceData> {
    // Check for RRULE property
    let rrule_prop = component.get_property("RRULE")?;
    let rrule_text = rrule_prop.as_text()?.to_string();

    // Extract DTSTART
    let dtstart_prop = component.get_property("DTSTART")?;
    let tzid = dtstart_prop.get_param_value("TZID").map(String::from);
    let dtstart_ical = dtstart_prop.as_datetime()?;
    let dtstart_utc = ical_datetime_to_utc(dtstart_ical, tzid.as_deref())?;

    // Calculate duration from DTEND or DURATION
    let duration = if let Some(dtend_prop) = component.get_property("DTEND") {
        let dtend_ical = dtend_prop.as_datetime()?;
        let dtend_tzid = dtend_prop.get_param_value("TZID");
        let dtend_utc = ical_datetime_to_utc(dtend_ical, dtend_tzid)?;
        dtend_utc.signed_duration_since(dtstart_utc)
    } else if let Some(duration_prop) = component.get_property("DURATION") {
        let duration_ical = duration_prop.as_duration()?;
        ical_duration_to_chrono(duration_ical)
    } else {
        // RFC 5545: If neither DTEND nor DURATION is present, the event has zero duration
        chrono::TimeDelta::zero()
    };

    // Extract EXDATE values
    let exdates = component
        .get_properties("EXDATE")
        .iter()
        .filter_map(|prop| {
            let tzid = prop.get_param_value("TZID");
            let dt = prop.as_datetime()?;
            ical_datetime_to_utc(dt, tzid)
        })
        .collect();

    // Extract RDATE values
    let rdates = component
        .get_properties("RDATE")
        .iter()
        .filter_map(|prop| {
            let tzid = prop.get_param_value("TZID");
            let dt = prop.as_datetime()?;
            ical_datetime_to_utc(dt, tzid)
        })
        .collect();

    Some(RecurrenceData {
        rrule: rrule_text,
        dtstart_utc,
        duration,
        exdates,
        rdates,
        tzid,
    })
}

/// ## Summary
/// Converts an iCalendar `DateTime` to `chrono::DateTime<Utc>`.
///
/// Handles both UTC and local time with TZID parameter.
///
/// ## Errors
///
/// Returns `None` if:
/// - The datetime format is invalid
/// - The timezone cannot be resolved
#[must_use]
fn ical_datetime_to_utc(dt: &IcalDateTime, tzid: Option<&str>) -> Option<DateTime<Utc>> {
    let naive = NaiveDateTime::new(
        chrono::NaiveDate::from_ymd_opt(i32::from(dt.year), u32::from(dt.month), u32::from(dt.day))?,
        chrono::NaiveTime::from_hms_opt(u32::from(dt.hour), u32::from(dt.minute), u32::from(dt.second))?,
    );

    match &dt.form {
        crate::component::rfc::ical::core::DateTimeForm::Utc => {
            Some(DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc))
        }
        crate::component::rfc::ical::core::DateTimeForm::Floating => {
            if let Some(tzid_str) = tzid {
                // Convert using timezone
                let mut resolver = crate::component::rfc::ical::expand::TimeZoneResolver::new();
                crate::component::rfc::ical::expand::convert_to_utc(
                    naive,
                    tzid_str,
                    &mut resolver,
                )
                .ok()
            } else {
                // Treat as floating time (interpret as UTC)
                Some(DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc))
            }
        }
        crate::component::rfc::ical::core::DateTimeForm::Zoned { tzid: dt_tzid } => {
            // Use the TZID from the datetime form
            let mut resolver = crate::component::rfc::ical::expand::TimeZoneResolver::new();
            crate::component::rfc::ical::expand::convert_to_utc(
                naive,
                dt_tzid,
                &mut resolver,
            )
            .ok()
        }
    }
}

/// ## Summary
/// Converts an iCalendar `Duration` to `chrono::Duration`.
#[must_use]
fn ical_duration_to_chrono(duration: &crate::component::rfc::ical::core::Duration) -> chrono::TimeDelta {
    let mut total = chrono::TimeDelta::zero();

    if duration.weeks > 0 {
        total += chrono::TimeDelta::weeks(i64::from(duration.weeks));
    }
    if duration.days > 0 {
        total += chrono::TimeDelta::days(i64::from(duration.days));
    }
    if duration.hours > 0 {
        total += chrono::TimeDelta::hours(i64::from(duration.hours));
    }
    if duration.minutes > 0 {
        total += chrono::TimeDelta::minutes(i64::from(duration.minutes));
    }
    if duration.seconds > 0 {
        total += chrono::TimeDelta::seconds(i64::from(duration.seconds));
    }

    if duration.negative {
        -total
    } else {
        total
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::component::rfc::ical::core::{Component, ComponentKind, DateTimeForm, Property, Value};

    #[test]
    fn test_extract_recurrence_data_with_dtend() {
        let mut component = Component::new(ComponentKind::Event);
        
        // Add RRULE
        component.add_property(Property::text("RRULE", "FREQ=DAILY;COUNT=5"));
        
        // Add DTSTART (20260101T100000Z)
        component.add_property(Property {
            name: "DTSTART".to_string(),
            params: vec![],
            value: Value::DateTime(IcalDateTime {
                year: 2026,
                month: 1,
                day: 1,
                hour: 10,
                minute: 0,
                second: 0,
                form: DateTimeForm::Utc,
            }),
            raw_value: "20260101T100000Z".to_string(),
        });
        
        // Add DTEND (20260101T110000Z)
        component.add_property(Property {
            name: "DTEND".to_string(),
            params: vec![],
            value: Value::DateTime(IcalDateTime {
                year: 2026,
                month: 1,
                day: 1,
                hour: 11,
                minute: 0,
                second: 0,
                form: DateTimeForm::Utc,
            }),
            raw_value: "20260101T110000Z".to_string(),
        });

        let data = extract_recurrence_data(&component).expect("should extract data");
        
        assert_eq!(data.rrule, "FREQ=DAILY;COUNT=5");
        assert_eq!(data.duration, chrono::TimeDelta::hours(1));
        assert_eq!(data.exdates.len(), 0);
        assert_eq!(data.rdates.len(), 0);
    }

    #[test]
    fn test_extract_recurrence_data_no_rrule() {
        let component = Component::new(ComponentKind::Event);
        assert!(extract_recurrence_data(&component).is_none());
    }
}
