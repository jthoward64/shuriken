//! Timezone resolution and conversion utilities.
//!
//! This module provides timezone handling for iCalendar events, including:
//! - VTIMEZONE component parsing
//! - Timezone database integration with chrono-tz
//! - UTC conversion with DST handling
//! - Offset calculation at specific instants

use chrono::{DateTime as ChronoDateTime, Datelike, NaiveDateTime, Offset, TimeZone, Timelike, Utc};
use chrono_tz::Tz;
use std::collections::HashMap;
use std::str::FromStr;

use crate::component::rfc::ical::core::{Component, DateTime, DateTimeForm};

/// ## Summary
/// Result type for timezone operations.
pub type Result<T> = std::result::Result<T, TimezoneError>;

/// ## Summary
/// Errors that can occur during timezone operations.
#[derive(Debug, thiserror::Error)]
pub enum TimezoneError {
    /// Unknown or invalid timezone identifier.
    #[error("Unknown timezone: {0}")]
    UnknownTimezone(String),

    /// Invalid datetime value.
    #[error("Invalid datetime: {0}")]
    InvalidDateTime(String),

    /// DST ambiguity (time occurs twice during fall-back).
    #[error("Ambiguous time due to DST fold: {0}")]
    AmbiguousTime(String),

    /// DST gap (time doesn't exist during spring-forward).
    #[error("Non-existent time due to DST gap: {0}")]
    NonExistentTime(String),
}

/// ## Summary
/// Interface for timezone resolution.
///
/// Allows for different implementations (chrono-tz, VTIMEZONE parsing, etc.)
pub trait TimezoneResolver {
    /// Converts a local datetime in the given timezone to UTC.
    ///
    /// ## Errors
    /// Returns an error if the timezone is unknown or the datetime is invalid.
    fn to_utc(&self, local: &DateTime) -> Result<ChronoDateTime<Utc>>;

    /// Converts a UTC datetime to local time in the given timezone.
    ///
    /// The name `from_utc` refers to converting FROM the UTC timezone
    /// (i.e., taking a UTC datetime as input).
    ///
    /// ## Errors
    /// Returns an error if the timezone is unknown.
    fn from_utc(&self, utc: &ChronoDateTime<Utc>, tzid: &str) -> Result<DateTime>;

    /// Gets the UTC offset for a timezone at a specific instant.
    ///
    /// ## Errors
    /// Returns an error if the timezone is unknown.
    fn get_offset(&self, tzid: &str, at: &ChronoDateTime<Utc>) -> Result<i32>;
}

/// ## Summary
/// Timezone database using chrono-tz for IANA timezone resolution.
///
/// This implementation uses the chrono-tz crate which includes the IANA timezone
/// database. It handles DST transitions and historic offset changes.
#[derive(Debug, Clone, Default)]
pub struct TimezoneDatabase {
    /// Custom VTIMEZONE definitions parsed from calendar data.
    /// Maps TZID to parsed timezone rules.
    custom_zones: HashMap<String, VTimezone>,
}

/// ## Summary
/// Parsed VTIMEZONE component (simplified).
///
/// For now, this is a placeholder. Full VTIMEZONE parsing would include
/// STANDARD and DAYLIGHT subcomponents with RRULE-based transitions.
#[derive(Debug, Clone)]
pub struct VTimezone {
    /// The timezone identifier.
    pub tzid: String,
    // TODO: Add STANDARD and DAYLIGHT component data
}

impl TimezoneDatabase {
    /// Creates a new empty timezone database.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds a custom VTIMEZONE definition.
    pub fn add_vtimezone(&mut self, tz: VTimezone) {
        self.custom_zones.insert(tz.tzid.clone(), tz);
    }

    /// Parses a VTIMEZONE component and adds it to the database.
    ///
    /// ## Errors
    /// Returns an error if the component is not a VTIMEZONE or is malformed.
    pub fn parse_vtimezone(&mut self, component: &Component) -> Result<()> {
        // TODO: Implement VTIMEZONE parsing
        // For now, just extract TZID
        if let Some(tzid_prop) = component.properties.iter().find(|p| p.name == "TZID") {
            let tzid = tzid_prop.raw_value.clone();
            let vtz = VTimezone { tzid };
            self.add_vtimezone(vtz);
            Ok(())
        } else {
            Err(TimezoneError::InvalidDateTime(
                "VTIMEZONE missing TZID".to_string(),
            ))
        }
    }

    /// Resolves a timezone identifier to a chrono-tz Tz.
    ///
    /// Tries chrono-tz first, then falls back to custom VTIMEZONE definitions.
    fn resolve_tz(&self, tzid: &str) -> Result<Tz> {
        // Try chrono-tz first
        if let Ok(tz) = Tz::from_str(tzid) {
            return Ok(tz);
        }

        // Check for custom VTIMEZONE
        if self.custom_zones.contains_key(tzid) {
            // TODO: Convert custom VTIMEZONE to chrono-tz compatible representation
            // For now, return error
            return Err(TimezoneError::UnknownTimezone(format!(
                "Custom VTIMEZONE not yet supported: {tzid}"
            )));
        }

        Err(TimezoneError::UnknownTimezone(tzid.to_string()))
    }
}

/// Helper to convert `DateTime` components to `NaiveDateTime`.
///
/// ## Errors
/// Returns an error if the date or time components are invalid.
fn datetime_to_naive(dt: &DateTime) -> Result<NaiveDateTime> {
    Ok(NaiveDateTime::new(
        chrono::NaiveDate::from_ymd_opt(
            i32::from(dt.year),
            u32::from(dt.month),
            u32::from(dt.day),
        )
        .ok_or_else(|| {
            TimezoneError::InvalidDateTime(format!("Invalid date: {dt}"))
        })?,
        chrono::NaiveTime::from_hms_opt(
            u32::from(dt.hour),
            u32::from(dt.minute),
            u32::from(dt.second),
        )
        .ok_or_else(|| {
            TimezoneError::InvalidDateTime(format!("Invalid time: {dt}"))
        })?,
    ))
}

impl TimezoneResolver for TimezoneDatabase {
    fn to_utc(&self, local: &DateTime) -> Result<ChronoDateTime<Utc>> {
        match &local.form {
            DateTimeForm::Utc | DateTimeForm::Floating => {
                // Both UTC and floating times are already in UTC representation.
                // Floating times (with no timezone) are interpreted as UTC for consistency,
                // which is a common practice in calendar applications. This matches RFC 5545
                // behavior where floating times are treated as independent of any timezone.
                let naive = datetime_to_naive(local)?;
                Ok(ChronoDateTime::<Utc>::from_naive_utc_and_offset(
                    naive, Utc,
                ))
            }
            DateTimeForm::Zoned { tzid } => {
                let tz = self.resolve_tz(tzid)?;
                let naive = datetime_to_naive(local)?;

                // Handle DST ambiguity by choosing the earlier occurrence
                // (This matches RFC 5545 recommendations for fall-back)
                match tz.from_local_datetime(&naive) {
                    chrono::LocalResult::Single(dt) => Ok(dt.with_timezone(&Utc)),
                    chrono::LocalResult::Ambiguous(earlier, _later) => {
                        // Use earlier occurrence (before DST transition)
                        Ok(earlier.with_timezone(&Utc))
                    }
                    chrono::LocalResult::None => {
                        // DST gap - time doesn't exist
                        // RFC 5545 recommends using the offset before the gap
                        Err(TimezoneError::NonExistentTime(format!(
                            "{local} in {tzid}"
                        )))
                    }
                }
            }
        }
    }

    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    fn from_utc(&self, utc: &ChronoDateTime<Utc>, tzid: &str) -> Result<DateTime> {
        let tz = self.resolve_tz(tzid)?;
        let local = utc.with_timezone(&tz);

        Ok(DateTime::zoned(
            local.year() as u16,
            local.month() as u8,
            local.day() as u8,
            local.hour() as u8,
            local.minute() as u8,
            local.second() as u8,
            tzid,
        ))
    }

    fn get_offset(&self, tzid: &str, at: &ChronoDateTime<Utc>) -> Result<i32> {
        let tz = self.resolve_tz(tzid)?;
        let local = at.with_timezone(&tz);
        Ok(local.offset().fix().local_minus_utc())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn test_utc_to_utc() {
        let db = TimezoneDatabase::new();
        let dt = DateTime::utc(2024, 1, 15, 12, 30, 0);
        let utc = db.to_utc(&dt).unwrap();
        assert_eq!(utc.year(), 2024);
        assert_eq!(utc.month(), 1);
        assert_eq!(utc.day(), 15);
        assert_eq!(utc.hour(), 12);
        assert_eq!(utc.minute(), 30);
    }

    #[test]
    fn test_zoned_to_utc() {
        let db = TimezoneDatabase::new();
        // New York is UTC-5 in winter
        let dt = DateTime::zoned(2024, 1, 15, 12, 30, 0, "America/New_York");
        let utc = db.to_utc(&dt).unwrap();
        // 12:30 EST = 17:30 UTC
        assert_eq!(utc.hour(), 17);
        assert_eq!(utc.minute(), 30);
    }

    #[test]
    fn test_from_utc() {
        let db = TimezoneDatabase::new();
        let utc = Utc.with_ymd_and_hms(2024, 1, 15, 17, 30, 0).unwrap();
        let local = db.from_utc(&utc, "America/New_York").unwrap();
        assert_eq!(local.hour, 12);
        assert_eq!(local.minute, 30);
    }

    #[test]
    fn test_dst_fold() {
        let db = TimezoneDatabase::new();
        // During DST fall-back, 1:30 AM occurs twice
        // We should use the earlier occurrence (before transition)
        let dt = DateTime::zoned(2024, 11, 3, 1, 30, 0, "America/New_York");
        let result = db.to_utc(&dt);
        // Should not error, should pick one consistently
        assert!(result.is_ok());
    }

    #[test]
    fn test_unknown_timezone() {
        let db = TimezoneDatabase::new();
        let dt = DateTime::zoned(2024, 1, 15, 12, 30, 0, "Invalid/Timezone");
        let result = db.to_utc(&dt);
        assert!(result.is_err());
    }
}
