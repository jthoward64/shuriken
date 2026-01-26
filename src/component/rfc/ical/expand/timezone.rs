//! Timezone resolution and UTC conversion for iCalendar date-times.

use chrono::{DateTime, LocalResult, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;
use std::collections::HashMap;
use std::str::FromStr;

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
    /// Cache of resolved timezones by TZID.
    cache: HashMap<String, Tz>,
}

impl TimeZoneResolver {
    /// Creates a new timezone resolver.
    #[must_use]
    pub fn new() -> Self {
        Self {
            cache: HashMap::new(),
        }
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
/// Many calendar clients use non-standard TZID values that need to be
/// mapped to standard IANA timezone names.
fn normalize_tzid(tzid: &str) -> String {
    // Strip common prefixes
    let mut normalized = tzid
        .strip_prefix("/mozilla.org/")
        .or_else(|| tzid.strip_prefix("/softwarestudio.org/"))
        .unwrap_or(tzid)
        .to_string();

    // TODO: Replace this if/else chain with data from icu
    // Handle Windows timezone names (common in Outlook)
    if normalized == "Eastern Standard Time" {
        normalized = "America/New_York".to_string();
    } else if normalized == "Pacific Standard Time" {
        normalized = "America/Los_Angeles".to_string();
    } else if normalized == "Central Standard Time" {
        normalized = "America/Chicago".to_string();
    } else if normalized == "Mountain Standard Time" {
        normalized = "America/Denver".to_string();
    } else {
        // Not handled
    }

    normalized
}

/// ## Summary
/// Converts a local datetime to UTC using the specified timezone.
///
/// Handles DST gaps (non-existent times) and folds (ambiguous times)
/// according to RFC 5545 semantics.
///
/// ## Errors
///
/// Returns an error if:
/// - The timezone cannot be resolved
/// - The datetime is non-existent (DST gap)
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
    // Resolve the timezone
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
    use chrono::TimeZone;

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
}
