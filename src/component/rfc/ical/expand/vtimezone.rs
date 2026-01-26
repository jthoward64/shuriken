//! VTIMEZONE component parsing and offset calculation.
//!
//! Implements parsing of VTIMEZONE components per RFC 5545 §3.6.5
//! to extract timezone offset rules for custom/proprietary timezones.

use crate::component::rfc::ical::core::{Component, ComponentKind, DateTime as ICalDateTime};
use chrono::{Datelike, Duration, NaiveDateTime, NaiveTime};

/// Error during VTIMEZONE parsing or offset calculation.
#[derive(Debug, thiserror::Error)]
pub enum VTimezoneError {
    /// Missing required TZID property.
    #[error("Missing required TZID property")]
    MissingTzid,

    /// Missing STANDARD or DAYLIGHT sub-component.
    #[error("VTIMEZONE must have at least one STANDARD or DAYLIGHT component")]
    NoObservances,

    /// Missing required property in observance.
    #[error("Missing required property {0} in {1} component")]
    MissingProperty(&'static str, &'static str),

    /// Invalid property value.
    #[error("Invalid {0} value: {1}")]
    InvalidValue(&'static str, String),
}

/// UTC offset in seconds.
///
/// Positive values are east of UTC, negative values are west.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct UtcOffset {
    /// Total seconds from UTC (positive = east, negative = west).
    pub seconds: i32,
}

impl UtcOffset {
    /// Creates a new UTC offset from hours, minutes, and seconds.
    #[must_use]
    pub const fn new(hours: i32, minutes: i32, seconds: i32) -> Self {
        let total = hours * 3600 + minutes * 60 + seconds;
        Self { seconds: total }
    }

    /// Creates a new UTC offset from total seconds.
    #[must_use]
    pub const fn from_seconds(seconds: i32) -> Self {
        Self { seconds }
    }

    /// Returns the offset as a chrono Duration.
    #[must_use]
    pub fn as_duration(self) -> Duration {
        Duration::seconds(i64::from(self.seconds))
    }

    /// Parses a UTC offset from `iCalendar` format (e.g., "+0500", "-0800", "+053000").
    ///
    /// Format: `(+/-)HHMM` or `(+/-)HHMMSS`
    ///
    /// ## Errors
    /// Returns [`VTimezoneError::InvalidValue`] if the offset string is malformed.
    pub fn parse(s: &str) -> Result<Self, VTimezoneError> {
        let s = s.trim();
        if s.len() < 5 {
            return Err(VTimezoneError::InvalidValue("UTC offset", s.to_string()));
        }

        let (sign, rest) = match s.chars().next() {
            Some('+') => (1, &s[1..]),
            Some('-') => (-1, &s[1..]),
            _ => return Err(VTimezoneError::InvalidValue("UTC offset", s.to_string())),
        };

        let hours: i32 = rest
            .get(0..2)
            .and_then(|h| h.parse().ok())
            .ok_or_else(|| VTimezoneError::InvalidValue("UTC offset hours", s.to_string()))?;

        let minutes: i32 = rest
            .get(2..4)
            .and_then(|m| m.parse().ok())
            .ok_or_else(|| VTimezoneError::InvalidValue("UTC offset minutes", s.to_string()))?;

        let seconds: i32 = if rest.len() >= 6 {
            rest.get(4..6).and_then(|s| s.parse().ok()).unwrap_or(0)
        } else {
            0
        };

        Ok(Self::new(sign * hours, sign * minutes, sign * seconds))
    }
}

/// Converts an `iCalendar` `DateTime` to chrono `NaiveDateTime`.
fn ical_to_naive(dt: &ICalDateTime) -> Option<NaiveDateTime> {
    use chrono::NaiveDate;
    let date = NaiveDate::from_ymd_opt(i32::from(dt.year), u32::from(dt.month), u32::from(dt.day))?;
    let time = NaiveTime::from_hms_opt(
        u32::from(dt.hour),
        u32::from(dt.minute),
        u32::from(dt.second),
    )?;
    Some(NaiveDateTime::new(date, time))
}

impl std::fmt::Display for UtcOffset {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let sign = if self.seconds >= 0 { '+' } else { '-' };
        let total = self.seconds.abs();
        let hours = total / 3600;
        let minutes = (total % 3600) / 60;
        let seconds = total % 60;
        if seconds == 0 {
            write!(f, "{sign}{hours:02}{minutes:02}")
        } else {
            write!(f, "{sign}{hours:02}{minutes:02}{seconds:02}")
        }
    }
}

/// A timezone observance rule (STANDARD or DAYLIGHT).
///
/// Represents when a particular offset takes effect.
#[derive(Debug, Clone, PartialEq)]
pub struct Observance {
    /// Type of observance (Standard or Daylight).
    pub kind: ObservanceKind,
    /// The offset from UTC when this observance is in effect.
    pub offset_to: UtcOffset,
    /// The offset from UTC before this observance takes effect.
    pub offset_from: UtcOffset,
    /// Start date-time of this observance (local time).
    pub dtstart: NaiveDateTime,
    /// Recurrence rule for annual transitions (if any).
    pub rrule: Option<String>,
    /// Recurrence dates (if any).
    pub rdates: Vec<NaiveDateTime>,
    /// Timezone name abbreviation (e.g., "EST", "EDT").
    pub tzname: Option<String>,
}

/// Kind of timezone observance.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ObservanceKind {
    /// Standard time (e.g., EST, GMT).
    Standard,
    /// Daylight saving time (e.g., EDT, BST).
    Daylight,
}

impl ObservanceKind {
    /// Returns the string name for this observance kind.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Standard => "STANDARD",
            Self::Daylight => "DAYLIGHT",
        }
    }
}

impl std::fmt::Display for ObservanceKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// A parsed VTIMEZONE component.
///
/// Contains all the information needed to calculate UTC offsets
/// for datetimes in this timezone.
#[derive(Debug, Clone, PartialEq)]
pub struct VTimezone {
    /// Timezone identifier (TZID property).
    pub tzid: String,
    /// Observance rules (STANDARD and/or DAYLIGHT components).
    pub observances: Vec<Observance>,
    /// Last modified time (if present).
    pub last_modified: Option<NaiveDateTime>,
    /// URL for timezone definition (if present).
    pub tzurl: Option<String>,
}

impl VTimezone {
    /// ## Summary
    /// Parses a VTIMEZONE component into a `VTimezone` struct.
    ///
    /// ## Errors
    /// Returns an error if required properties are missing or invalid.
    pub fn parse(component: &Component) -> Result<Self, VTimezoneError> {
        // Verify this is a VTIMEZONE component
        if component.kind != Some(ComponentKind::Timezone) {
            return Err(VTimezoneError::MissingTzid);
        }

        // Extract TZID (required)
        let tzid = component
            .get_property("TZID")
            .and_then(|p| p.as_text())
            .ok_or(VTimezoneError::MissingTzid)?
            .to_string();

        // Parse observances (STANDARD and DAYLIGHT sub-components)
        let mut observances = Vec::new();

        for child in &component.children {
            let kind = match child.kind {
                Some(ComponentKind::Standard) => ObservanceKind::Standard,
                Some(ComponentKind::Daylight) => ObservanceKind::Daylight,
                _ => continue, // Skip unknown children
            };

            let observance = Self::parse_observance(child, kind)?;
            observances.push(observance);
        }

        if observances.is_empty() {
            return Err(VTimezoneError::NoObservances);
        }

        // Extract optional properties
        let last_modified = component
            .get_property("LAST-MODIFIED")
            .and_then(|p| p.as_datetime())
            .and_then(|dt| ical_to_naive(dt));

        let tzurl = component
            .get_property("TZURL")
            .and_then(|p| p.as_text())
            .map(String::from);

        Ok(Self {
            tzid,
            observances,
            last_modified,
            tzurl,
        })
    }

    /// Parses a STANDARD or DAYLIGHT sub-component.
    fn parse_observance(
        component: &Component,
        kind: ObservanceKind,
    ) -> Result<Observance, VTimezoneError> {
        let kind_str = kind.as_str();

        // DTSTART (required)
        let dtstart_ical = component
            .get_property("DTSTART")
            .and_then(|p| p.as_datetime())
            .ok_or(VTimezoneError::MissingProperty("DTSTART", kind_str))?;
        let dtstart = ical_to_naive(dtstart_ical)
            .ok_or_else(|| VTimezoneError::InvalidValue("DTSTART", dtstart_ical.to_string()))?;

        // TZOFFSETTO (required)
        let offset_to_str = component
            .get_property("TZOFFSETTO")
            .and_then(|p| p.as_text())
            .ok_or(VTimezoneError::MissingProperty("TZOFFSETTO", kind_str))?;
        let offset_to = UtcOffset::parse(offset_to_str)?;

        // TZOFFSETFROM (required)
        let offset_from_str = component
            .get_property("TZOFFSETFROM")
            .and_then(|p| p.as_text())
            .ok_or(VTimezoneError::MissingProperty("TZOFFSETFROM", kind_str))?;
        let offset_from = UtcOffset::parse(offset_from_str)?;

        // RRULE (optional)
        let rrule = component
            .get_property("RRULE")
            .and_then(|p| p.as_text())
            .map(String::from);

        // RDATE (optional, can be multiple)
        let rdates = component
            .get_properties("RDATE")
            .into_iter()
            .filter_map(|p| p.as_datetime())
            .filter_map(ical_to_naive)
            .collect();

        // TZNAME (optional)
        let tzname = component
            .get_property("TZNAME")
            .and_then(|p| p.as_text())
            .map(String::from);

        Ok(Observance {
            kind,
            offset_to,
            offset_from,
            dtstart,
            rrule,
            rdates,
            tzname,
        })
    }

    /// ## Summary
    /// Returns the UTC offset in effect at the given local datetime.
    ///
    /// This uses the observance rules to determine which offset applies.
    /// For datetimes before all observances, returns the first observance's
    /// `offset_from` (the offset before any transitions).
    #[must_use]
    pub fn offset_at(&self, local_dt: NaiveDateTime) -> UtcOffset {
        // Find the most recent observance transition before this datetime
        let mut best_observance: Option<(&Observance, NaiveDateTime)> = None;

        for obs in &self.observances {
            // Get the effective date for this observance at or before local_dt
            if let Some(effective_dt) = self.effective_date(obs, local_dt) {
                match &best_observance {
                    None => best_observance = Some((obs, effective_dt)),
                    Some((_, best_dt)) if effective_dt > *best_dt => {
                        best_observance = Some((obs, effective_dt));
                    }
                    _ => {}
                }
            }
        }

        match best_observance {
            Some((obs, _)) => obs.offset_to,
            None => {
                // No observance applies yet - use the earliest observance's offset_from
                self.observances
                    .iter()
                    .min_by_key(|o| o.dtstart)
                    .map_or(UtcOffset::from_seconds(0), |o| o.offset_from)
            }
        }
    }

    /// ## Summary
    /// Calculates the effective date of an observance at or before a given datetime.
    ///
    /// For non-recurring observances, returns dtstart if it's <= dt.
    /// For recurring observances, calculates the most recent occurrence.
    fn effective_date(&self, obs: &Observance, dt: NaiveDateTime) -> Option<NaiveDateTime> {
        // If datetime is before the observance starts, it doesn't apply
        if dt < obs.dtstart {
            return None;
        }

        // If no RRULE, just check dtstart and rdates
        if obs.rrule.is_none() && obs.rdates.is_empty() {
            return Some(obs.dtstart);
        }

        // Check explicit RDATEs first
        let mut best: Option<NaiveDateTime> = Some(obs.dtstart);
        for rdate in &obs.rdates {
            if *rdate <= dt && best.map_or(true, |b| *rdate > b) {
                best = Some(*rdate);
            }
        }

        // Handle RRULE
        if let Some(rrule) = &obs.rrule {
            if let Some(occurrence) = self.calculate_rrule_occurrence(obs, rrule, dt) {
                if best.map_or(true, |b| occurrence > b) {
                    best = Some(occurrence);
                }
            }
        }

        best
    }

    /// ## Summary
    /// Calculates the most recent `RRULE` occurrence at or before a given datetime.
    ///
    /// This is a simplified implementation that handles common timezone `RRULE`s:
    /// - `FREQ=YEARLY` with `BYMONTH` and `BYDAY`
    #[expect(clippy::unused_self, reason = "Method may need self in future for context")]
    fn calculate_rrule_occurrence(
        &self,
        obs: &Observance,
        rrule: &str,
        dt: NaiveDateTime,
    ) -> Option<NaiveDateTime> {
        // Parse RRULE components
        let parts: std::collections::HashMap<&str, &str> = rrule
            .split(';')
            .filter_map(|part| {
                let mut kv = part.splitn(2, '=');
                Some((kv.next()?, kv.next()?))
            })
            .collect();

        // Only handle YEARLY frequency (common for DST rules)
        if parts.get("FREQ") != Some(&"YEARLY") {
            return None;
        }

        // Extract BYMONTH and BYDAY
        let bymonth: u32 = parts.get("BYMONTH")?.parse().ok()?;
        let byday = *parts.get("BYDAY")?;

        // Parse BYDAY (e.g., "1SU", "-1SU", "2SU")
        let (week_ord, weekday) = parse_byday(byday)?;

        // Calculate the occurrence for each year from dtstart to dt
        let start_year = obs.dtstart.year();
        let end_year = dt.year();

        let mut best: Option<NaiveDateTime> = None;
        for year in start_year..=end_year {
            if let Some(occurrence) =
                calculate_nth_weekday_of_month(year, bymonth, weekday, week_ord, obs.dtstart.time())
            {
                if occurrence <= dt && (best.is_none() || occurrence > best.unwrap()) {
                    best = Some(occurrence);
                }
            }
        }

        best
    }

    /// ## Summary
    /// Converts a local datetime to UTC using this timezone's rules.
    #[must_use]
    pub fn to_utc(&self, local_dt: NaiveDateTime) -> NaiveDateTime {
        let offset = self.offset_at(local_dt);
        local_dt - offset.as_duration()
    }

    /// ## Summary
    /// Converts a UTC datetime to local time using this timezone's rules.
    #[must_use]
    pub fn from_utc(&self, utc_dt: NaiveDateTime) -> NaiveDateTime {
        // First approximation: use offset at UTC time
        let approx_local = utc_dt + self.offset_at(utc_dt).as_duration();
        // Refine: use offset at the approximated local time
        let offset = self.offset_at(approx_local);
        utc_dt + offset.as_duration()
    }
}

/// Parses a BYDAY value like "1SU", "-1SU", "2MO".
///
/// Returns (week ordinal, weekday) where week ordinal is:
/// - Positive: nth occurrence (1 = first, 2 = second, etc.)
/// - Negative: nth from end (-1 = last, -2 = second to last, etc.)
fn parse_byday(s: &str) -> Option<(i32, chrono::Weekday)> {
    use chrono::Weekday;

    let s = s.trim();
    if s.len() < 2 {
        return None;
    }

    // Find where the number ends and weekday begins
    let weekday_start = s.len() - 2;
    let num_part = &s[..weekday_start];
    let day_part = &s[weekday_start..];

    let ord: i32 = if num_part.is_empty() {
        0 // No ordinal means "every" - not typical for timezone rules
    } else {
        num_part.parse().ok()?
    };

    let weekday = match day_part.to_ascii_uppercase().as_str() {
        "SU" => Weekday::Sun,
        "MO" => Weekday::Mon,
        "TU" => Weekday::Tue,
        "WE" => Weekday::Wed,
        "TH" => Weekday::Thu,
        "FR" => Weekday::Fri,
        "SA" => Weekday::Sat,
        _ => return None,
    };

    Some((ord, weekday))
}

/// Calculates the nth occurrence of a weekday in a month.
///
/// - `week_ord` > 0: nth occurrence from start (1 = first)
/// - `week_ord` < 0: nth from end (-1 = last)
fn calculate_nth_weekday_of_month(
    year: i32,
    month: u32,
    weekday: chrono::Weekday,
    week_ord: i32,
    time: NaiveTime,
) -> Option<NaiveDateTime> {
    use chrono::{Datelike, NaiveDate};

    if week_ord == 0 {
        return None;
    }

    #[expect(
        clippy::cast_sign_loss,
        clippy::cast_possible_wrap,
        reason = "Values are validated to be within safe ranges"
    )]
    if week_ord > 0 {
        // Find first occurrence of weekday in month
        let first_of_month = NaiveDate::from_ymd_opt(year, month, 1)?;
        let first_weekday = first_of_month.weekday();

        // Days until the target weekday
        // Note: num_days_from_monday() returns 0-6 (safe as i32)
        let days_until = (weekday.num_days_from_monday() as i32
            - first_weekday.num_days_from_monday() as i32
            + 7)
            % 7;

        // Day of month for first occurrence
        let first_occurrence = 1 + days_until;

        // Day of month for nth occurrence
        let day = first_occurrence + (week_ord - 1) * 7;

        // Verify day is still in month
        let date = NaiveDate::from_ymd_opt(year, month, day as u32)?;
        Some(NaiveDateTime::new(date, time))
    } else {
        // Find last occurrence of weekday in month
        let next_month = if month == 12 { 1 } else { month + 1 };
        let next_year = if month == 12 { year + 1 } else { year };
        let first_of_next = NaiveDate::from_ymd_opt(next_year, next_month, 1)?;
        let last_of_month = first_of_next.pred_opt()?;

        let last_weekday = last_of_month.weekday();

        // Days back to target weekday
        // Note: num_days_from_monday() returns 0-6 (safe as i32)
        let days_back = (last_weekday.num_days_from_monday() as i32
            - weekday.num_days_from_monday() as i32
            + 7)
            % 7;

        // Day of month for last occurrence (day() returns 1-31, safe as i32)
        let last_occurrence = last_of_month.day() as i32 - days_back;

        // Day for nth from end occurrence
        let day = last_occurrence + (week_ord + 1) * 7;

        if day < 1 {
            return None;
        }

        let date = NaiveDate::from_ymd_opt(year, month, day as u32)?;
        Some(NaiveDateTime::new(date, time))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    #[test]
    fn test_utc_offset_parse_basic() {
        let offset = UtcOffset::parse("+0500").unwrap();
        assert_eq!(offset.seconds, 5 * 3600);

        let offset = UtcOffset::parse("-0800").unwrap();
        assert_eq!(offset.seconds, -8 * 3600);

        let offset = UtcOffset::parse("+0000").unwrap();
        assert_eq!(offset.seconds, 0);
    }

    #[test]
    fn test_utc_offset_parse_with_seconds() {
        let offset = UtcOffset::parse("+053000").unwrap();
        assert_eq!(offset.seconds, 5 * 3600 + 30 * 60);

        let offset = UtcOffset::parse("-043015").unwrap();
        assert_eq!(offset.seconds, -(4 * 3600 + 30 * 60 + 15));
    }

    #[test]
    fn test_utc_offset_display() {
        assert_eq!(UtcOffset::new(5, 0, 0).to_string(), "+0500");
        assert_eq!(UtcOffset::new(-8, 0, 0).to_string(), "-0800");
        assert_eq!(UtcOffset::new(5, 30, 0).to_string(), "+0530");
        assert_eq!(UtcOffset::new(-4, -30, -15).to_string(), "-043015");
    }

    #[test]
    fn test_parse_byday() {
        assert_eq!(parse_byday("1SU"), Some((1, chrono::Weekday::Sun)));
        assert_eq!(parse_byday("-1SU"), Some((-1, chrono::Weekday::Sun)));
        assert_eq!(parse_byday("2MO"), Some((2, chrono::Weekday::Mon)));
    }

    #[test]
    fn test_calculate_nth_weekday_first_sunday_march_2026() {
        // First Sunday of March 2026 should be March 1st
        let time = NaiveTime::from_hms_opt(2, 0, 0).unwrap();
        let dt = calculate_nth_weekday_of_month(2026, 3, chrono::Weekday::Sun, 1, time);
        assert_eq!(
            dt,
            Some(NaiveDateTime::new(
                NaiveDate::from_ymd_opt(2026, 3, 1).unwrap(),
                time
            ))
        );
    }

    #[test]
    fn test_calculate_nth_weekday_second_sunday_march_2026() {
        // Second Sunday of March 2026 should be March 8th
        let time = NaiveTime::from_hms_opt(2, 0, 0).unwrap();
        let dt = calculate_nth_weekday_of_month(2026, 3, chrono::Weekday::Sun, 2, time);
        assert_eq!(
            dt,
            Some(NaiveDateTime::new(
                NaiveDate::from_ymd_opt(2026, 3, 8).unwrap(),
                time
            ))
        );
    }

    #[test]
    fn test_calculate_nth_weekday_last_sunday_october_2026() {
        // Last Sunday of October 2026 should be October 25th
        let time = NaiveTime::from_hms_opt(2, 0, 0).unwrap();
        let dt = calculate_nth_weekday_of_month(2026, 10, chrono::Weekday::Sun, -1, time);
        assert_eq!(
            dt,
            Some(NaiveDateTime::new(
                NaiveDate::from_ymd_opt(2026, 10, 25).unwrap(),
                time
            ))
        );
    }

    #[test]
    fn test_calculate_nth_weekday_first_sunday_november_2026() {
        // First Sunday of November 2026 should be November 1st
        let time = NaiveTime::from_hms_opt(2, 0, 0).unwrap();
        let dt = calculate_nth_weekday_of_month(2026, 11, chrono::Weekday::Sun, 1, time);
        assert_eq!(
            dt,
            Some(NaiveDateTime::new(
                NaiveDate::from_ymd_opt(2026, 11, 1).unwrap(),
                time
            ))
        );
    }

    #[test]
    fn test_vtimezone_offset_calculation_us_eastern() {
        // Create a VTimezone representing US/Eastern
        // EST: UTC-5, starts first Sunday in November
        // EDT: UTC-4, starts second Sunday in March
        let standard = Observance {
            kind: ObservanceKind::Standard,
            offset_to: UtcOffset::new(-5, 0, 0),
            offset_from: UtcOffset::new(-4, 0, 0),
            dtstart: NaiveDateTime::new(
                NaiveDate::from_ymd_opt(1970, 11, 1).unwrap(),
                NaiveTime::from_hms_opt(2, 0, 0).unwrap(),
            ),
            rrule: Some("FREQ=YEARLY;BYMONTH=11;BYDAY=1SU".to_string()),
            rdates: vec![],
            tzname: Some("EST".to_string()),
        };

        let daylight = Observance {
            kind: ObservanceKind::Daylight,
            offset_to: UtcOffset::new(-4, 0, 0),
            offset_from: UtcOffset::new(-5, 0, 0),
            dtstart: NaiveDateTime::new(
                NaiveDate::from_ymd_opt(1970, 3, 8).unwrap(),
                NaiveTime::from_hms_opt(2, 0, 0).unwrap(),
            ),
            rrule: Some("FREQ=YEARLY;BYMONTH=3;BYDAY=2SU".to_string()),
            rdates: vec![],
            tzname: Some("EDT".to_string()),
        };

        let vtimezone = VTimezone {
            tzid: "US/Eastern".to_string(),
            observances: vec![standard, daylight],
            last_modified: None,
            tzurl: None,
        };

        // Test January (should be EST, -5)
        let jan_dt = NaiveDateTime::new(
            NaiveDate::from_ymd_opt(2026, 1, 15).unwrap(),
            NaiveTime::from_hms_opt(12, 0, 0).unwrap(),
        );
        let jan_offset = vtimezone.offset_at(jan_dt);
        assert_eq!(jan_offset.seconds, -5 * 3600, "January should be EST (-5)");

        // Test July (should be EDT, -4)
        let jul_dt = NaiveDateTime::new(
            NaiveDate::from_ymd_opt(2026, 7, 15).unwrap(),
            NaiveTime::from_hms_opt(12, 0, 0).unwrap(),
        );
        let jul_offset = vtimezone.offset_at(jul_dt);
        assert_eq!(jul_offset.seconds, -4 * 3600, "July should be EDT (-4)");
    }

    #[test]
    fn test_vtimezone_to_utc() {
        // Simple timezone with no DST
        let standard = Observance {
            kind: ObservanceKind::Standard,
            offset_to: UtcOffset::new(5, 30, 0),
            offset_from: UtcOffset::new(5, 30, 0),
            dtstart: NaiveDateTime::new(
                NaiveDate::from_ymd_opt(1970, 1, 1).unwrap(),
                NaiveTime::from_hms_opt(0, 0, 0).unwrap(),
            ),
            rrule: None,
            rdates: vec![],
            tzname: Some("IST".to_string()),
        };

        let vtimezone = VTimezone {
            tzid: "Asia/Kolkata".to_string(),
            observances: vec![standard],
            last_modified: None,
            tzurl: None,
        };

        // 12:00 IST (UTC+5:30) should be 06:30 UTC
        let local = NaiveDateTime::new(
            NaiveDate::from_ymd_opt(2026, 1, 15).unwrap(),
            NaiveTime::from_hms_opt(12, 0, 0).unwrap(),
        );
        let utc = vtimezone.to_utc(local);

        assert_eq!(
            utc,
            NaiveDateTime::new(
                NaiveDate::from_ymd_opt(2026, 1, 15).unwrap(),
                NaiveTime::from_hms_opt(6, 30, 0).unwrap(),
            )
        );
    }
}
