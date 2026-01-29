//! Timezone resolution and UTC conversion for iCalendar date-times.
//!
//! Uses ICU4X for Windows timezone ID to IANA mapping and timezone canonicalization.

use chrono::{DateTime, LocalResult, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;
use icu::time::zone::WindowsParser;
use icu::time::zone::iana::IanaParserExtended;
use std::collections::HashMap;
use std::str::FromStr;

use super::vtimezone::{VTimezone, VTimezoneError};
use crate::rfc::ical::core::ICalendar;

/// Error during timezone conversion.
#[derive(Debug, thiserror::Error)]
pub enum ConversionError {
    /// Unknown or invalid timezone identifier.
    #[error("Unknown timezone: {0}")]
    UnknownTimezone(String),

    /// Ambiguous time during DST fold.
    #[error("Ambiguous time (DST fold): {0}")]
    AmbiguousTime(String),

    /// Non-existent time during DST gap.
    #[error("Non-existent time (DST gap): {0}")]
    NonExistentTime(String),

    /// Invalid datetime format.
    #[error("Invalid datetime: {0}")]
    InvalidDateTime(String),
}

/// Resolver for timezone identifiers.
///
/// Maintains a cache of resolved timezones and provides fallback
/// to VTIMEZONE component parsing if needed.
pub struct TimeZoneResolver {
    /// Cache of resolved IANA timezones by TZID.
    cache: HashMap<String, Tz>,
    /// Cache of parsed VTIMEZONE components by TZID.
    vtimezones: HashMap<String, super::vtimezone::VTimezone>,
}

/// ## Summary
/// Builds a `TimeZoneResolver` with `VTIMEZONE` components registered.
///
/// ## Errors
/// Returns an error if any `VTIMEZONE` component is invalid.
pub fn build_timezone_resolver(ical: &ICalendar) -> Result<TimeZoneResolver, VTimezoneError> {
    let mut resolver = TimeZoneResolver::new();

    for tz_component in ical.timezones() {
        let vtimezone = VTimezone::parse(tz_component)?;
        resolver.register_vtimezone(vtimezone);
    }

    Ok(resolver)
}

impl TimeZoneResolver {
    /// Creates a new timezone resolver.
    #[must_use]
    pub fn new() -> Self {
        Self {
            cache: HashMap::new(),
            vtimezones: HashMap::new(),
        }
    }

    /// ## Summary
    /// Registers a parsed VTIMEZONE component for use by this resolver.
    ///
    /// This allows custom/proprietary timezones defined in iCalendar data
    /// to be used for datetime conversion.
    pub fn register_vtimezone(&mut self, vtimezone: super::vtimezone::VTimezone) {
        self.vtimezones.insert(vtimezone.tzid.clone(), vtimezone);
    }

    /// ## Summary
    /// Returns the registered VTIMEZONE for a TZID, if any.
    #[must_use]
    pub fn get_vtimezone(&self, tzid: &str) -> Option<&super::vtimezone::VTimezone> {
        self.vtimezones.get(tzid)
    }

    /// ## Summary
    /// Checks if a TZID has a registered VTIMEZONE.
    #[must_use]
    pub fn has_vtimezone(&self, tzid: &str) -> bool {
        self.vtimezones.contains_key(tzid)
    }

    /// ## Summary
    /// Resolves a timezone identifier to a `chrono_tz::Tz`.
    ///
    /// This function attempts to parse the TZID as an IANA timezone name.
    /// Common CalDAV/iCalendar TZIDs are mapped to their IANA equivalents.
    ///
    /// ## Errors
    ///
    /// Returns `ConversionError::UnknownTimezone` if the TZID cannot be resolved.
    ///
    /// ## Side Effects
    ///
    /// Caches successful resolutions to avoid repeated parsing.
    pub fn resolve(&mut self, tzid: &str) -> Result<Tz, ConversionError> {
        // Check cache first
        if let Some(tz) = self.cache.get(tzid) {
            return Ok(*tz);
        }

        // Normalize common CalDAV timezone identifiers
        let normalized = normalize_tzid(tzid);

        // Try parsing as IANA timezone
        let tz = Tz::from_str(&normalized)
            .map_err(|_e| ConversionError::UnknownTimezone(tzid.to_string()))?;

        // Cache the result
        self.cache.insert(tzid.to_string(), tz);

        Ok(tz)
    }
}

impl Default for TimeZoneResolver {
    fn default() -> Self {
        Self::new()
    }
}

/// Normalizes common CalDAV/iCalendar timezone identifiers to IANA names.
///
/// Uses ICU4X for Windows timezone ID mapping and IANA canonicalization.
/// Many calendar clients use non-standard TZID values that need to be
/// mapped to standard IANA timezone names.
fn normalize_tzid(tzid: &str) -> String {
    // Strip common prefixes
    let stripped = tzid
        .strip_prefix("/mozilla.org/")
        .or_else(|| tzid.strip_prefix("/softwarestudio.org/"))
        .unwrap_or(tzid);

    // Try Windows timezone mapping first using ICU
    let windows_parser = WindowsParser::new();
    if let Some(tz) = windows_parser.parse(stripped, None) {
        // Get the canonical IANA name from the BCP-47 timezone ID
        let iana_parser = IanaParserExtended::new();
        for entry in iana_parser.iter() {
            if entry.time_zone == tz {
                return entry.canonical.to_string();
            }
        }
    }

    // Try IANA parser for canonicalization (handles aliases like Europe/Kiev -> Europe/Kyiv)
    let iana_parser = IanaParserExtended::new();
    let parsed = iana_parser.parse(stripped);
    if parsed.time_zone != icu::time::TimeZone::UNKNOWN {
        return parsed.canonical.to_string();
    }

    // Return as-is if not recognized
    stripped.to_string()
}

/// ## Summary
/// Converts a local datetime to UTC using the specified timezone.
///
/// First checks for a registered VTIMEZONE with the given TZID, then
/// falls back to IANA timezone resolution via `chrono-tz`.
///
/// Handles DST gaps (non-existent times) and folds (ambiguous times)
/// according to RFC 5545 semantics.
///
/// ## Errors
///
/// Returns an error if:
/// - The timezone cannot be resolved (no VTIMEZONE registered and not an IANA timezone)
/// - The datetime is non-existent (DST gap) when using IANA timezone
/// - The datetime is ambiguous (DST fold) and cannot be disambiguated
///
/// ## Side Effects
///
/// Updates the timezone resolver's cache if a new timezone is resolved.
pub fn convert_to_utc(
    local_time: NaiveDateTime,
    tzid: &str,
    resolver: &mut TimeZoneResolver,
) -> Result<DateTime<Utc>, ConversionError> {
    // First, check if we have a custom VTIMEZONE for this TZID
    if let Some(vtimezone) = resolver.get_vtimezone(tzid) {
        // Use the VTIMEZONE to calculate UTC
        let utc_naive = vtimezone.to_utc(local_time);
        return Ok(DateTime::from_naive_utc_and_offset(utc_naive, Utc));
    }

    // Fall back to IANA timezone resolution
    let tz = resolver.resolve(tzid)?;

    // Convert local time to UTC
    // Handle DST ambiguity
    match tz.from_local_datetime(&local_time) {
        LocalResult::None => {
            // DST gap: time doesn't exist
            // RFC 5545 doesn't specify behavior, but common practice is to
            // shift forward to the next valid time
            Err(ConversionError::NonExistentTime(format!(
                "{local_time} in timezone {tzid}"
            )))
        }
        LocalResult::Single(dt) => {
            // Unambiguous conversion
            Ok(dt.with_timezone(&Utc))
        }
        LocalResult::Ambiguous(dt1, _dt2) => {
            // DST fold: time occurs twice
            // RFC 5545 §3.3.5 specifies using the first occurrence (before DST shift)
            Ok(dt1.with_timezone(&Utc))
        }
    }
}

/// ## Summary
/// Converts a local datetime to UTC, with fallback handling for DST gaps.
///
/// This is a lenient version of `convert_to_utc` that shifts non-existent
/// times forward by one hour instead of returning an error.
///
/// ## Errors
///
/// Returns an error if the timezone cannot be resolved.
///
/// ## Side Effects
///
/// Updates the timezone resolver's cache if a new timezone is resolved.
#[expect(dead_code, reason = "Scaffolded for future use")]
pub fn convert_to_utc_lenient(
    local_time: NaiveDateTime,
    tzid: &str,
    resolver: &mut TimeZoneResolver,
) -> Result<DateTime<Utc>, ConversionError> {
    match convert_to_utc(local_time, tzid, resolver) {
        Ok(dt) => Ok(dt),
        Err(ConversionError::NonExistentTime(_)) => {
            // Shift forward by one hour and retry
            let shifted = local_time + chrono::Duration::hours(1);
            convert_to_utc(shifted, tzid, resolver)
        }
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rfc::ical::core::{Component, ComponentKind, DateTime, Property};
    use chrono::TimeZone;

    fn build_fixed_vtimezone(tzid: &str, offset: &str) -> Component {
        let mut timezone = Component::new(ComponentKind::Timezone);
        timezone.add_property(Property::text("TZID", tzid));

        let mut standard = Component::new(ComponentKind::Standard);
        standard.add_property(Property::datetime(
            "DTSTART",
            DateTime::floating(2026, 1, 1, 0, 0, 0),
        ));
        standard.add_property(Property::text("TZOFFSETFROM", offset));
        standard.add_property(Property::text("TZOFFSETTO", offset));

        timezone.add_child(standard);
        timezone
    }

    #[test]
    fn test_resolve_standard_timezone() {
        let mut resolver = TimeZoneResolver::new();

        let tz = resolver
            .resolve("America/New_York")
            .expect("should resolve");
        assert_eq!(tz, Tz::America__New_York);
    }

    #[test]
    fn test_normalize_windows_timezone() {
        assert_eq!(normalize_tzid("Eastern Standard Time"), "America/New_York");
        assert_eq!(
            normalize_tzid("Pacific Standard Time"),
            "America/Los_Angeles"
        );
    }

    #[test]
    fn test_normalize_mozilla_prefix() {
        assert_eq!(
            normalize_tzid("/mozilla.org/America/New_York"),
            "America/New_York"
        );
    }

    #[test]
    fn test_convert_to_utc_basic() {
        let mut resolver = TimeZoneResolver::new();

        // 2026-01-15 10:00:00 in New York
        let local = NaiveDateTime::new(
            chrono::NaiveDate::from_ymd_opt(2026, 1, 15).unwrap(),
            chrono::NaiveTime::from_hms_opt(10, 0, 0).unwrap(),
        );

        let utc = convert_to_utc(local, "America/New_York", &mut resolver)
            .expect("conversion should succeed");

        // In January, EST is UTC-5
        let expected = Utc.with_ymd_and_hms(2026, 1, 15, 15, 0, 0).unwrap();
        assert_eq!(utc, expected);
    }

    #[test]
    fn test_convert_to_utc_dst() {
        let mut resolver = TimeZoneResolver::new();

        // 2026-07-15 10:00:00 in New York (EDT, UTC-4)
        let local = NaiveDateTime::new(
            chrono::NaiveDate::from_ymd_opt(2026, 7, 15).unwrap(),
            chrono::NaiveTime::from_hms_opt(10, 0, 0).unwrap(),
        );

        let utc = convert_to_utc(local, "America/New_York", &mut resolver)
            .expect("conversion should succeed");

        // In July, EDT is UTC-4
        let expected = Utc.with_ymd_and_hms(2026, 7, 15, 14, 0, 0).unwrap();
        assert_eq!(utc, expected);
    }

    #[test]
    fn test_build_timezone_resolver_registers_vtimezone() {
        let mut calendar = crate::rfc::ical::core::ICalendar::default();
        calendar.add_timezone(build_fixed_vtimezone("Test/Fixed", "+0200"));

        let resolver = build_timezone_resolver(&calendar).expect("valid VTIMEZONE");
        assert!(resolver.has_vtimezone("Test/Fixed"));
    }

    #[test]
    fn test_convert_to_utc_prefers_vtimezone() {
        let mut calendar = crate::rfc::ical::core::ICalendar::default();
        calendar.add_timezone(build_fixed_vtimezone("Test/Fixed", "+0200"));

        let mut resolver = build_timezone_resolver(&calendar).expect("valid VTIMEZONE");

        let local = NaiveDateTime::new(
            chrono::NaiveDate::from_ymd_opt(2026, 1, 15).unwrap(),
            chrono::NaiveTime::from_hms_opt(10, 0, 0).unwrap(),
        );

        let utc =
            convert_to_utc(local, "Test/Fixed", &mut resolver).expect("conversion should succeed");

        let expected = Utc.with_ymd_and_hms(2026, 1, 15, 8, 0, 0).unwrap();
        assert_eq!(utc, expected);
    }

    #[test]
    fn test_timezone_caching() {
        let mut resolver = TimeZoneResolver::new();

        // First resolution
        resolver
            .resolve("America/New_York")
            .expect("should resolve");

        // Cache should contain the timezone
        assert!(resolver.cache.contains_key("America/New_York"));

        // Second resolution should use cache
        resolver
            .resolve("America/New_York")
            .expect("should resolve from cache");
    }

    #[test]
    fn test_normalize_additional_windows_timezones() {
        // Test additional Windows timezone mappings via ICU
        assert_eq!(normalize_tzid("Central Standard Time"), "America/Chicago");
        assert_eq!(normalize_tzid("Mountain Standard Time"), "America/Denver");
        // GMT Standard Time should map to Europe/London
        assert_eq!(normalize_tzid("GMT Standard Time"), "Europe/London");
        // W. Europe Standard Time should map to Europe/Berlin
        assert_eq!(normalize_tzid("W. Europe Standard Time"), "Europe/Berlin");
    }

    #[test]
    fn test_normalize_iana_alias() {
        // Test that IANA aliases are canonicalized
        // Europe/Kiev was renamed to Europe/Kyiv
        assert_eq!(normalize_tzid("Europe/Kiev"), "Europe/Kyiv");
        // US/Eastern is an alias for America/New_York
        assert_eq!(normalize_tzid("US/Eastern"), "America/New_York");
    }
}
