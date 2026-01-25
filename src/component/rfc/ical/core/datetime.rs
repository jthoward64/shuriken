//! iCalendar DATE-TIME and TIME value types (RFC 5545 §3.3.5, §3.3.12).

use std::fmt;

/// UTC offset representation (e.g., +0530, -0800).
///
/// Stored as total seconds from UTC. Valid range is roughly ±14 hours.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct UtcOffset {
    /// Total seconds from UTC (positive = east, negative = west).
    seconds: i32,
}

impl UtcOffset {
    /// Creates a UTC offset from hours and minutes.
    ///
    /// ## Panics
    ///
    /// Panics if the offset is out of valid range (±14:00).
    #[must_use]
    pub fn new(hours: i8, minutes: u8) -> Self {
        let seconds = i32::from(hours) * 3600 + i32::from(minutes) * 60;
        assert!(
            (-14 * 3600..=14 * 3600).contains(&seconds),
            "UTC offset out of valid range"
        );
        Self { seconds }
    }

    /// Creates a UTC offset from total seconds.
    #[must_use]
    pub const fn from_seconds(seconds: i32) -> Self {
        Self { seconds }
    }

    /// Returns the offset as total seconds from UTC.
    #[must_use]
    pub const fn as_seconds(self) -> i32 {
        self.seconds
    }

    /// Returns hours component (may be negative).
    #[must_use]
    #[expect(
        clippy::cast_possible_truncation,
        reason = "UTC offsets are bounded to ±14 hours per RFC 5545, truncation to i8 is safe"
    )]
    pub const fn hours(self) -> i8 {
        (self.seconds / 3600) as i8
    }

    /// Returns minutes component (always positive).
    #[must_use]
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "Minutes component is always 0-59 per RFC 5545, truncation and sign loss to u8 are safe"
    )]
    pub const fn minutes(self) -> u8 {
        ((self.seconds.abs() % 3600) / 60) as u8
    }

    /// UTC offset (zero).
    pub const UTC: Self = Self { seconds: 0 };
}

impl fmt::Display for UtcOffset {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let sign = if self.seconds >= 0 { '+' } else { '-' };
        let hours = self.seconds.abs() / 3600;
        let minutes = (self.seconds.abs() % 3600) / 60;
        write!(f, "{sign}{hours:02}{minutes:02}")
    }
}

/// Time value (RFC 5545 §3.3.12).
///
/// Represents a time of day with optional UTC indicator or timezone offset.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Time {
    /// Hour (0-23).
    pub hour: u8,
    /// Minute (0-59).
    pub minute: u8,
    /// Second (0-60, allowing for leap seconds).
    pub second: u8,
    /// Whether this time is in UTC (indicated by 'Z' suffix).
    pub is_utc: bool,
}

impl Time {
    /// Creates a new time value.
    #[must_use]
    pub const fn new(hour: u8, minute: u8, second: u8, is_utc: bool) -> Self {
        Self {
            hour,
            minute,
            second,
            is_utc,
        }
    }

    /// Creates a UTC time.
    #[must_use]
    pub const fn utc(hour: u8, minute: u8, second: u8) -> Self {
        Self::new(hour, minute, second, true)
    }

    /// Creates a local (non-UTC) time.
    #[must_use]
    pub const fn local(hour: u8, minute: u8, second: u8) -> Self {
        Self::new(hour, minute, second, false)
    }
}

impl fmt::Display for Time {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:02}{:02}{:02}", self.hour, self.minute, self.second)?;
        if self.is_utc {
            write!(f, "Z")?;
        }
        Ok(())
    }
}

/// Form of DATE-TIME value (RFC 5545 §3.3.5).
///
/// iCalendar DATE-TIME values come in three mutually exclusive forms.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DateTimeForm {
    /// Floating time - same wall-clock time in any timezone.
    ///
    /// Example: `19980118T230000`
    Floating,

    /// UTC time - absolute instant, indicated by 'Z' suffix.
    ///
    /// Example: `19980119T070000Z`
    Utc,

    /// Zoned time - local time with TZID reference.
    ///
    /// Example: `TZID=America/New_York:19980119T020000`
    Zoned {
        /// The IANA timezone identifier.
        tzid: String,
    },
}

/// DATE-TIME value (RFC 5545 §3.3.5).
///
/// A specific point in time, which may be floating, UTC, or zoned.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DateTime {
    /// Year (e.g., 2026).
    pub year: u16,
    /// Month (1-12).
    pub month: u8,
    /// Day of month (1-31).
    pub day: u8,
    /// Hour (0-23).
    pub hour: u8,
    /// Minute (0-59).
    pub minute: u8,
    /// Second (0-60, allowing for leap seconds).
    pub second: u8,
    /// The form of this DATE-TIME (floating, UTC, or zoned).
    pub form: DateTimeForm,
}

impl DateTime {
    /// Creates a floating DATE-TIME.
    #[must_use]
    #[expect(
        clippy::too_many_arguments,
        reason = "Constructor mirrors RFC 5545 DATE-TIME components"
    )]
    pub fn floating(year: u16, month: u8, day: u8, hour: u8, minute: u8, second: u8) -> Self {
        Self {
            year,
            month,
            day,
            hour,
            minute,
            second,
            form: DateTimeForm::Floating,
        }
    }

    /// Creates a UTC DATE-TIME.
    #[must_use]
    #[expect(
        clippy::too_many_arguments,
        reason = "Constructor mirrors RFC 5545 DATE-TIME components"
    )]
    pub fn utc(year: u16, month: u8, day: u8, hour: u8, minute: u8, second: u8) -> Self {
        Self {
            year,
            month,
            day,
            hour,
            minute,
            second,
            form: DateTimeForm::Utc,
        }
    }

    /// Creates a zoned DATE-TIME.
    #[must_use]
    #[expect(
        clippy::too_many_arguments,
        reason = "Constructor mirrors RFC 5545 DATE-TIME components plus TZID"
    )]
    pub fn zoned(
        year: u16,
        month: u8,
        day: u8,
        hour: u8,
        minute: u8,
        second: u8,
        tzid: impl Into<String>,
    ) -> Self {
        Self {
            year,
            month,
            day,
            hour,
            minute,
            second,
            form: DateTimeForm::Zoned { tzid: tzid.into() },
        }
    }

    /// Returns whether this is a UTC time.
    #[must_use]
    pub fn is_utc(&self) -> bool {
        matches!(self.form, DateTimeForm::Utc)
    }

    /// Returns whether this is a floating time.
    #[must_use]
    pub fn is_floating(&self) -> bool {
        matches!(self.form, DateTimeForm::Floating)
    }

    /// Returns the timezone ID if this is a zoned time.
    #[must_use]
    pub fn tzid(&self) -> Option<&str> {
        match &self.form {
            DateTimeForm::Zoned { tzid } => Some(tzid),
            _ => None,
        }
    }
}

impl fmt::Display for DateTime {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{:04}{:02}{:02}T{:02}{:02}{:02}",
            self.year, self.month, self.day, self.hour, self.minute, self.second
        )?;
        if self.is_utc() {
            write!(f, "Z")?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utc_offset_display() {
        assert_eq!(UtcOffset::new(5, 30).to_string(), "+0530");
        assert_eq!(UtcOffset::new(-8, 0).to_string(), "-0800");
        assert_eq!(UtcOffset::UTC.to_string(), "+0000");
    }

    #[test]
    fn time_display() {
        assert_eq!(Time::utc(13, 30, 0).to_string(), "133000Z");
        assert_eq!(Time::local(9, 15, 30).to_string(), "091530");
    }

    #[test]
    fn datetime_display() {
        let dt = DateTime::utc(2026, 1, 23, 12, 0, 0);
        assert_eq!(dt.to_string(), "20260123T120000Z");

        let dt = DateTime::floating(2026, 1, 23, 12, 0, 0);
        assert_eq!(dt.to_string(), "20260123T120000");
    }
}
