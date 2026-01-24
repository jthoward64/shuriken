//! vCard date and time types (RFC 6350 §4.3).
//!
//! vCard dates support partial/truncated forms that iCalendar doesn't allow.

use chrono::{NaiveDate, NaiveTime};

/// A vCard date value with optional truncation (RFC 6350 §4.3.1).
///
/// Supports full dates and truncated forms like --MM-DD or ---DD.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VCardDate {
    /// Full date (YYYY-MM-DD).
    Full(NaiveDate),
    /// Year and month only (YYYY-MM).
    YearMonth { year: i32, month: u32 },
    /// Year only (YYYY).
    Year(i32),
    /// Month and day, no year (--MM-DD).
    MonthDay { month: u32, day: u32 },
    /// Day only (---DD).
    Day(u32),
}

impl VCardDate {
    /// Creates a full date.
    #[must_use]
    pub fn full(date: NaiveDate) -> Self {
        Self::Full(date)
    }

    /// Creates a year-month date.
    #[must_use]
    pub fn year_month(year: i32, month: u32) -> Self {
        Self::YearMonth { year, month }
    }

    /// Creates a year-only date.
    #[must_use]
    pub fn year(year: i32) -> Self {
        Self::Year(year)
    }

    /// Creates a month-day date (anniversary pattern).
    #[must_use]
    pub fn month_day(month: u32, day: u32) -> Self {
        Self::MonthDay { month, day }
    }

    /// Creates a day-only date.
    #[must_use]
    pub fn day(day: u32) -> Self {
        Self::Day(day)
    }

    /// Returns the year if available.
    #[must_use]
    pub fn year_value(&self) -> Option<i32> {
        match self {
            Self::Full(d) => Some(d.year()),
            Self::YearMonth { year, .. } | Self::Year(year) => Some(*year),
            Self::MonthDay { .. } | Self::Day(_) => None,
        }
    }

    /// Returns the month if available.
    #[must_use]
    pub fn month_value(&self) -> Option<u32> {
        match self {
            Self::Full(d) => Some(d.month()),
            Self::YearMonth { month, .. } | Self::MonthDay { month, .. } => Some(*month),
            Self::Year(_) | Self::Day(_) => None,
        }
    }

    /// Returns the day if available.
    #[must_use]
    pub fn day_value(&self) -> Option<u32> {
        match self {
            Self::Full(d) => Some(d.day()),
            Self::MonthDay { day, .. } | Self::Day(day) => Some(*day),
            Self::Year(_) | Self::YearMonth { .. } => None,
        }
    }
}

use chrono::Datelike;

/// A vCard time value with optional truncation (RFC 6350 §4.3.2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VCardTime {
    /// Full time (HH:MM:SS).
    Full(NaiveTime),
    /// Hour and minute only (HH:MM).
    HourMinute { hour: u32, minute: u32 },
    /// Hour only (HH).
    Hour(u32),
    /// Minute and second, no hour (-MM:SS).
    MinuteSecond { minute: u32, second: u32 },
    /// Second only (--SS).
    Second(u32),
}

impl VCardTime {
    /// Creates a full time.
    #[must_use]
    pub fn full(time: NaiveTime) -> Self {
        Self::Full(time)
    }

    /// Creates an hour-minute time.
    #[must_use]
    pub fn hour_minute(hour: u32, minute: u32) -> Self {
        Self::HourMinute { hour, minute }
    }

    /// Creates an hour-only time.
    #[must_use]
    pub fn hour(hour: u32) -> Self {
        Self::Hour(hour)
    }
}

/// UTC offset for vCard times.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VCardUtcOffset {
    /// Hours from UTC (-12 to +14).
    pub hours: i8,
    /// Minutes from UTC (0-59).
    pub minutes: u8,
}

impl VCardUtcOffset {
    /// UTC offset.
    pub const UTC: Self = Self { hours: 0, minutes: 0 };

    /// Creates a new UTC offset.
    #[must_use]
    pub const fn new(hours: i8, minutes: u8) -> Self {
        Self { hours, minutes }
    }

    /// Returns total offset in minutes.
    #[must_use]
    pub const fn total_minutes(&self) -> i32 {
        (self.hours as i32) * 60 + (self.minutes as i32) * self.hours.signum() as i32
    }
}

/// Combined date and time, possibly partial (RFC 6350 §4.3.4).
///
/// This is the main type for BDAY, ANNIVERSARY, and similar properties.
#[derive(Debug, Clone, PartialEq)]
pub enum DateAndOrTime {
    /// Date only.
    Date(VCardDate),
    /// Date and time.
    DateTime {
        date: VCardDate,
        time: VCardTime,
        offset: Option<VCardUtcOffset>,
    },
    /// Time only.
    Time {
        time: VCardTime,
        offset: Option<VCardUtcOffset>,
    },
    /// Free-form text (for non-Gregorian calendars or special cases).
    Text(String),
}

impl DateAndOrTime {
    /// Creates a date-only value.
    #[must_use]
    pub fn date(date: VCardDate) -> Self {
        Self::Date(date)
    }

    /// Creates a full date from year/month/day.
    #[must_use]
    pub fn full_date(year: i32, month: u32, day: u32) -> Option<Self> {
        NaiveDate::from_ymd_opt(year, month, day).map(|d| Self::Date(VCardDate::Full(d)))
    }

    /// Creates a datetime value.
    #[must_use]
    pub fn datetime(date: VCardDate, time: VCardTime, offset: Option<VCardUtcOffset>) -> Self {
        Self::DateTime { date, time, offset }
    }

    /// Creates a time-only value.
    #[must_use]
    pub fn time(time: VCardTime, offset: Option<VCardUtcOffset>) -> Self {
        Self::Time { time, offset }
    }

    /// Creates a text value.
    #[must_use]
    pub fn text(s: impl Into<String>) -> Self {
        Self::Text(s.into())
    }

    /// Returns the date component if available.
    #[must_use]
    pub fn as_date(&self) -> Option<&VCardDate> {
        match self {
            Self::Date(d) | Self::DateTime { date: d, .. } => Some(d),
            _ => None,
        }
    }

    /// Returns the time component if available.
    #[must_use]
    pub fn as_time(&self) -> Option<&VCardTime> {
        match self {
            Self::DateTime { time: t, .. } | Self::Time { time: t, .. } => Some(t),
            _ => None,
        }
    }

    /// Returns whether this is a text value.
    #[must_use]
    pub fn is_text(&self) -> bool {
        matches!(self, Self::Text(_))
    }
}

/// Timestamp value for REV property (RFC 6350 §6.7.4).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Timestamp {
    /// UTC datetime.
    pub datetime: chrono::DateTime<chrono::Utc>,
}

impl Timestamp {
    /// Creates a timestamp from a `chrono` `DateTime`.
    #[must_use]
    pub fn new(datetime: chrono::DateTime<chrono::Utc>) -> Self {
        Self { datetime }
    }

    /// Returns the current timestamp.
    #[must_use]
    pub fn now() -> Self {
        Self {
            datetime: chrono::Utc::now(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vcard_date_full() {
        let date = VCardDate::full(NaiveDate::from_ymd_opt(1990, 6, 15).unwrap());
        assert_eq!(date.year_value(), Some(1990));
        assert_eq!(date.month_value(), Some(6));
        assert_eq!(date.day_value(), Some(15));
    }

    #[test]
    fn vcard_date_month_day() {
        let date = VCardDate::month_day(12, 25);
        assert_eq!(date.year_value(), None);
        assert_eq!(date.month_value(), Some(12));
        assert_eq!(date.day_value(), Some(25));
    }

    #[test]
    fn date_and_or_time_date_only() {
        let val = DateAndOrTime::full_date(1990, 6, 15).unwrap();
        assert!(val.as_date().is_some());
        assert!(val.as_time().is_none());
    }

    #[test]
    fn date_and_or_time_text() {
        let val = DateAndOrTime::text("circa 1800");
        assert!(val.is_text());
    }

    #[test]
    fn utc_offset_total_minutes() {
        let offset = VCardUtcOffset::new(-5, 30);
        assert_eq!(offset.total_minutes(), -330);
    }
}
