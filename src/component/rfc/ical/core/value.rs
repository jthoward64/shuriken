//! iCalendar DATE and PERIOD value types (RFC 5545 §3.3.4, §3.3.9).

use std::fmt;

use super::{DateTime, Duration};

/// DATE value (RFC 5545 §3.3.4).
///
/// A calendar date without time component.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Date {
    /// Year (e.g., 2026).
    pub year: u16,
    /// Month (1-12).
    pub month: u8,
    /// Day of month (1-31).
    pub day: u8,
}

impl Date {
    /// Creates a new date.
    #[must_use]
    pub const fn new(year: u16, month: u8, day: u8) -> Self {
        Self { year, month, day }
    }
}

impl fmt::Display for Date {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:04}{:02}{:02}", self.year, self.month, self.day)
    }
}

/// PERIOD value (RFC 5545 §3.3.9).
///
/// A precise period of time, defined by either:
/// - An explicit start and end (both DATE-TIME)
/// - A start DATE-TIME and a DURATION
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Period {
    /// Explicit start and end times.
    Explicit {
        /// Start of the period (must be DATE-TIME, not DATE).
        start: DateTime,
        /// End of the period (must be DATE-TIME, not DATE).
        end: DateTime,
    },
    /// Start time and duration.
    Duration {
        /// Start of the period (must be DATE-TIME, not DATE).
        start: DateTime,
        /// Duration of the period.
        duration: Duration,
    },
}

impl Period {
    /// Creates an explicit period from start to end.
    #[must_use]
    pub fn explicit(start: DateTime, end: DateTime) -> Self {
        Self::Explicit { start, end }
    }

    /// Creates a period from a start time and duration.
    #[must_use]
    pub fn from_duration(start: DateTime, duration: Duration) -> Self {
        Self::Duration { start, duration }
    }

    /// Returns the start of the period.
    #[must_use]
    pub fn start(&self) -> &DateTime {
        match self {
            Self::Explicit { start, .. } | Self::Duration { start, .. } => start,
        }
    }
}

impl fmt::Display for Period {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Explicit { start, end } => write!(f, "{start}/{end}"),
            Self::Duration { start, duration } => write!(f, "{start}/{duration}"),
        }
    }
}

/// Value types (RFC 5545 §3.3).
///
/// This enum represents the parsed value of a property. The raw string
/// is preserved separately for round-trip fidelity.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    /// BINARY value (base64 encoded).
    Binary(Vec<u8>),
    /// BOOLEAN value.
    Boolean(bool),
    /// CAL-ADDRESS value (typically mailto: URI).
    CalAddress(String),
    /// DATE value.
    Date(Date),
    /// DATE-TIME value.
    DateTime(DateTime),
    /// DURATION value.
    Duration(Duration),
    /// FLOAT value.
    Float(f64),
    /// INTEGER value.
    Integer(i32),
    /// PERIOD value.
    Period(Period),
    /// RECUR value (recurrence rule).
    Recur(Box<super::RRule>),
    /// TEXT value (unescaped).
    Text(String),
    /// TEXT-LIST value (multiple comma-separated texts).
    TextList(Vec<String>),
    /// TIME value.
    Time(super::Time),
    /// URI value.
    Uri(String),
    /// UTC-OFFSET value.
    UtcOffset(super::UtcOffset),
    /// Unknown or unparsed value. Preserved for round-trip.
    Unknown(String),
}

impl Value {
    /// Returns this value as text, if it is a text value.
    #[must_use]
    pub fn as_text(&self) -> Option<&str> {
        match self {
            Self::Text(s) => Some(s),
            _ => None,
        }
    }

    /// Returns this value as an integer, if it is an integer value.
    #[must_use]
    pub fn as_integer(&self) -> Option<i32> {
        match self {
            Self::Integer(n) => Some(*n),
            _ => None,
        }
    }

    /// Returns this value as a date-time, if it is a date-time value.
    #[must_use]
    pub fn as_datetime(&self) -> Option<&DateTime> {
        match self {
            Self::DateTime(dt) => Some(dt),
            _ => None,
        }
    }

    /// Returns this value as a date, if it is a date value.
    #[must_use]
    pub fn as_date(&self) -> Option<&Date> {
        match self {
            Self::Date(d) => Some(d),
            _ => None,
        }
    }

    /// Returns this value as a duration, if it is a duration value.
    #[must_use]
    pub fn as_duration(&self) -> Option<&Duration> {
        match self {
            Self::Duration(d) => Some(d),
            _ => None,
        }
    }

    /// Returns this value as a boolean, if it is a boolean value.
    #[must_use]
    pub fn as_boolean(&self) -> Option<bool> {
        match self {
            Self::Boolean(b) => Some(*b),
            _ => None,
        }
    }

    /// Returns this value as a recurrence rule, if it is a recur value.
    #[must_use]
    pub fn as_recur(&self) -> Option<&super::RRule> {
        match self {
            Self::Recur(r) => Some(r),
            _ => None,
        }
    }

    /// Returns whether this is an unknown/unparsed value.
    #[must_use]
    pub fn is_unknown(&self) -> bool {
        matches!(self, Self::Unknown(_))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn date_display() {
        assert_eq!(Date::new(2026, 1, 23).to_string(), "20260123");
    }

    #[test]
    fn period_explicit_display() {
        let start = DateTime::utc(2026, 1, 23, 9, 0, 0);
        let end = DateTime::utc(2026, 1, 23, 17, 0, 0);
        let period = Period::explicit(start, end);
        assert_eq!(period.to_string(), "20260123T090000Z/20260123T170000Z");
    }

    #[test]
    fn period_duration_display() {
        let start = DateTime::utc(2026, 1, 23, 9, 0, 0);
        let duration = Duration::hours(8);
        let period = Period::from_duration(start, duration);
        assert_eq!(period.to_string(), "20260123T090000Z/PT8H");
    }
}
