//! Helper functions for extracting and processing recurrence data from iCalendar components.

use crate::error::{ServiceError, ServiceResult};
use chrono::{DateTime, NaiveDateTime, Utc};
use rrule::{RRule, RRuleSet, Tz, Unvalidated};
use shuriken_rfc::rfc::ical::core::{Component, DateTime as IcalDateTime};
use shuriken_rfc::rfc::ical::expand::TimeZoneResolver;

/// Extracted recurrence data from a VEVENT component.
#[derive(Debug, Clone)]
pub struct RecurrenceData {
    /// Validated recurrence rule set.
    pub rrule_set: RRuleSet,
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
/// Returns `Ok(None)` if:
/// - Component has no RRULE property
/// - DTSTART is missing or invalid
/// - DTEND/DURATION is missing or invalid
#[must_use]
pub fn extract_recurrence_data(component: &Component) -> ServiceResult<Option<RecurrenceData>> {
    let mut resolver = TimeZoneResolver::new();
    extract_recurrence_data_with_resolver(component, &mut resolver)
}

/// ## Summary
/// Extracts recurrence data from a VEVENT component with a timezone resolver.
///
/// Parses RRULE, DTSTART, DTEND/DURATION, EXDATE, and RDATE properties.
/// Converts all date-times to UTC if TZID is present.
///
/// ## Errors
///
/// Returns `Ok(None)` if:
/// - Component has no RRULE property
/// - DTSTART is missing or invalid
/// - DTEND/DURATION is missing or invalid
#[must_use]
pub fn extract_recurrence_data_with_resolver(
    component: &Component,
    resolver: &mut TimeZoneResolver,
) -> ServiceResult<Option<RecurrenceData>> {
    tracing::trace!(
        component_name = %component.name,
        property_count = component.properties.len(),
        "Extracting recurrence data from component"
    );

    // Check for RRULE property
    let rrule_prop = match component.get_property("RRULE") {
        Some(prop) => prop,
        None => {
            tracing::trace!("RRULE property not found");
            return Ok(None);
        }
    };

    // RRULE can be either Value::Recur or Value::Text
    let rrule_text = match &rrule_prop.value {
        shuriken_rfc::rfc::ical::core::Value::Recur(rrule) => rrule.to_string(),
        shuriken_rfc::rfc::ical::core::Value::Text(text) => text.clone(),
        _ => {
            tracing::trace!("RRULE property has unexpected value type");
            return Ok(None);
        }
    };
    tracing::trace!(rrule = %rrule_text, "Found RRULE");

    // Extract DTSTART
    let dtstart_prop = match component.get_property("DTSTART") {
        Some(prop) => prop,
        None => return Ok(None),
    };
    let tzid = dtstart_prop.get_param_value("TZID").map(String::from);
    let dtstart_ical = match dtstart_prop.as_datetime() {
        Some(dt) => dt,
        None => return Ok(None),
    };
    let dtstart_utc =
        match ical_datetime_to_utc_with_resolver(dtstart_ical, tzid.as_deref(), resolver) {
            Some(dt) => dt,
            None => return Ok(None),
        };
    tracing::trace!(dtstart = %dtstart_utc, "Extracted DTSTART");

    // Calculate duration from DTEND or DURATION
    let duration = if let Some(dtend_prop) = component.get_property("DTEND") {
        let dtend_ical = match dtend_prop.as_datetime() {
            Some(dt) => dt,
            None => return Ok(None),
        };
        let dtend_tzid = dtend_prop.get_param_value("TZID");
        let dtend_utc = match ical_datetime_to_utc_with_resolver(dtend_ical, dtend_tzid, resolver) {
            Some(dt) => dt,
            None => return Ok(None),
        };
        let dur = dtend_utc.signed_duration_since(dtstart_utc);
        tracing::trace!(
            duration_seconds = dur.num_seconds(),
            "Calculated duration from DTEND"
        );
        dur
    } else if let Some(duration_prop) = component.get_property("DURATION") {
        let duration_ical = match duration_prop.as_duration() {
            Some(dur) => dur,
            None => return Ok(None),
        };
        let dur = ical_duration_to_chrono(duration_ical);
        tracing::trace!(duration_seconds = dur.num_seconds(), "Extracted DURATION");
        dur
    } else {
        // RFC 5545: If neither DTEND nor DURATION is present, the event has zero duration
        tracing::trace!("No DTEND or DURATION found, using zero duration");
        chrono::TimeDelta::zero()
    };

    // Extract EXDATE values
    let exdates: Vec<DateTime<Utc>> = component
        .get_properties("EXDATE")
        .iter()
        .filter_map(|prop| {
            let tzid = prop.get_param_value("TZID");
            let dt = prop.as_datetime()?;
            ical_datetime_to_utc_with_resolver(dt, tzid, resolver)
        })
        .collect();

    // Extract RDATE values
    let rdates: Vec<DateTime<Utc>> = component
        .get_properties("RDATE")
        .iter()
        .filter_map(|prop| {
            let tzid = prop.get_param_value("TZID");
            let dt = prop.as_datetime()?;
            ical_datetime_to_utc_with_resolver(dt, tzid, resolver)
        })
        .collect();

    let rrule = rrule_text
        .parse::<RRule<Unvalidated>>()
        .map_err(|err| ServiceError::ValidationError(err.to_string()))?;
    let dt_start = dtstart_utc.with_timezone(&Tz::UTC);
    let mut rrule_set = rrule
        .build(dt_start)
        .map_err(|err| ServiceError::ValidationError(err.to_string()))?;

    if !rdates.is_empty() {
        let rdates_tz: Vec<chrono::DateTime<Tz>> =
            rdates.iter().map(|dt| dt.with_timezone(&Tz::UTC)).collect();
        rrule_set = rrule_set.set_rdates(rdates_tz);
    }

    if !exdates.is_empty() {
        let exdates_tz: Vec<chrono::DateTime<Tz>> = exdates
            .iter()
            .map(|dt| dt.with_timezone(&Tz::UTC))
            .collect();
        rrule_set = rrule_set.set_exdates(exdates_tz);
    }

    Ok(Some(RecurrenceData {
        rrule_set,
        dtstart_utc,
        duration,
        exdates,
        rdates,
        tzid,
    }))
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
pub fn ical_datetime_to_utc(dt: &IcalDateTime, tzid: Option<&str>) -> Option<DateTime<Utc>> {
    let mut resolver = TimeZoneResolver::new();
    ical_datetime_to_utc_with_resolver(dt, tzid, &mut resolver)
}

/// ## Summary
/// Converts an iCalendar `DateTime` to `chrono::DateTime<Utc>` using a resolver.
///
/// Handles both UTC and local time with TZID parameter.
///
/// ## Errors
///
/// Returns `None` if:
/// - The datetime format is invalid
/// - The timezone cannot be resolved
#[must_use]
pub fn ical_datetime_to_utc_with_resolver(
    dt: &IcalDateTime,
    tzid: Option<&str>,
    resolver: &mut TimeZoneResolver,
) -> Option<DateTime<Utc>> {
    let naive = NaiveDateTime::new(
        chrono::NaiveDate::from_ymd_opt(
            i32::from(dt.year),
            u32::from(dt.month),
            u32::from(dt.day),
        )?,
        chrono::NaiveTime::from_hms_opt(
            u32::from(dt.hour),
            u32::from(dt.minute),
            u32::from(dt.second),
        )?,
    );

    match &dt.form {
        shuriken_rfc::rfc::ical::core::DateTimeForm::Utc => {
            Some(DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc))
        }
        shuriken_rfc::rfc::ical::core::DateTimeForm::Floating => {
            if let Some(tzid_str) = tzid {
                // Convert using timezone
                shuriken_rfc::rfc::ical::expand::convert_to_utc(naive, tzid_str, resolver).ok()
            } else {
                // Treat as floating time (interpret as UTC)
                Some(DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc))
            }
        }
        shuriken_rfc::rfc::ical::core::DateTimeForm::Zoned { tzid: dt_tzid } => {
            // Use the TZID from the datetime form
            shuriken_rfc::rfc::ical::expand::convert_to_utc(naive, dt_tzid, resolver).ok()
        }
    }
}

/// ## Summary
/// Converts an iCalendar `Duration` to `chrono::Duration`.
#[must_use]
pub fn ical_duration_to_chrono(
    duration: &shuriken_rfc::rfc::ical::core::Duration,
) -> chrono::TimeDelta {
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

    if duration.negative { -total } else { total }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use shuriken_rfc::rfc::ical::core::{
        Component, ComponentKind, DateTime, DateTimeForm, Parameter, Property, Value,
    };

    fn register_fixed_timezone(resolver: &mut TimeZoneResolver) {
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
        resolver.register_vtimezone(vtimezone);
    }

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

        let data = extract_recurrence_data(&component)
            .expect("should extract data")
            .expect("should have recurrence data");

        // The rrule crate normalizes RRULE by inferring BYHOUR/BYMINUTE/BYSECOND from DTSTART
        assert_eq!(
            data.rrule_set.to_string(),
            "DTSTART:20260101T100000Z\nRRULE:FREQ=DAILY;COUNT=5;BYHOUR=10;BYMINUTE=0;BYSECOND=0"
        );
        assert_eq!(data.duration, chrono::TimeDelta::hours(1));
        assert_eq!(data.exdates.len(), 0);
        assert_eq!(data.rdates.len(), 0);
    }

    #[test]
    fn test_extract_recurrence_data_no_rrule() {
        let component = Component::new(ComponentKind::Event);
        let result = extract_recurrence_data(&component).expect("no error");
        assert!(result.is_none());
    }

    #[test]
    fn test_extract_recurrence_data_with_timezone_resolver() {
        let mut component = Component::new(ComponentKind::Event);

        component.add_property(Property::text("RRULE", "FREQ=DAILY;COUNT=2"));

        component.add_property(Property {
            name: "DTSTART".to_string(),
            params: vec![Parameter::tzid("Test/Fixed")],
            value: Value::DateTime(IcalDateTime {
                year: 2026,
                month: 1,
                day: 15,
                hour: 10,
                minute: 0,
                second: 0,
                form: DateTimeForm::Floating,
            }),
            raw_value: "20260115T100000".to_string(),
        });

        component.add_property(Property {
            name: "DTEND".to_string(),
            params: vec![Parameter::tzid("Test/Fixed")],
            value: Value::DateTime(IcalDateTime {
                year: 2026,
                month: 1,
                day: 15,
                hour: 11,
                minute: 0,
                second: 0,
                form: DateTimeForm::Floating,
            }),
            raw_value: "20260115T110000".to_string(),
        });

        let mut resolver = TimeZoneResolver::new();
        register_fixed_timezone(&mut resolver);

        let data = extract_recurrence_data_with_resolver(&component, &mut resolver)
            .expect("should extract data")
            .expect("should have recurrence data");

        let expected = Utc.with_ymd_and_hms(2026, 1, 15, 8, 0, 0).unwrap();
        assert_eq!(data.dtstart_utc, expected);
        assert_eq!(data.duration, chrono::TimeDelta::hours(1));
    }
}

#[cfg(test)]
mod rrule_cases {
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/rrule_cases_data/mod.rs"
    ));

    #[test]
    fn rrule_cases_unit() {
        for case in rrule_cases() {
            assert_case(&case);
        }
    }
}
