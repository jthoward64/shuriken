//! iCalendar RRULE (Recurrence Rule) value type (RFC 5545 §3.3.10, §3.8.5.3).

use std::fmt;

use super::Date;

/// Recurrence frequency (RFC 5545 §3.3.10).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Frequency {
    Secondly,
    Minutely,
    Hourly,
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

impl Frequency {
    /// Returns the string representation.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Secondly => "SECONDLY",
            Self::Minutely => "MINUTELY",
            Self::Hourly => "HOURLY",
            Self::Daily => "DAILY",
            Self::Weekly => "WEEKLY",
            Self::Monthly => "MONTHLY",
            Self::Yearly => "YEARLY",
        }
    }

    /// Parses a frequency from a string (case-insensitive).
    #[must_use]
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s.to_ascii_uppercase().as_str() {
            "SECONDLY" => Self::Secondly,
            "MINUTELY" => Self::Minutely,
            "HOURLY" => Self::Hourly,
            "DAILY" => Self::Daily,
            "WEEKLY" => Self::Weekly,
            "MONTHLY" => Self::Monthly,
            "YEARLY" => Self::Yearly,
            _ => return None,
        })
    }
}

impl fmt::Display for Frequency {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Day of the week.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Weekday {
    Sunday,
    Monday,
    Tuesday,
    Wednesday,
    Thursday,
    Friday,
    Saturday,
}

impl Weekday {
    /// Returns the two-letter abbreviation.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Sunday => "SU",
            Self::Monday => "MO",
            Self::Tuesday => "TU",
            Self::Wednesday => "WE",
            Self::Thursday => "TH",
            Self::Friday => "FR",
            Self::Saturday => "SA",
        }
    }

    /// Parses a weekday from a two-letter abbreviation (case-insensitive).
    #[must_use]
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s.to_ascii_uppercase().as_str() {
            "SU" => Self::Sunday,
            "MO" => Self::Monday,
            "TU" => Self::Tuesday,
            "WE" => Self::Wednesday,
            "TH" => Self::Thursday,
            "FR" => Self::Friday,
            "SA" => Self::Saturday,
            _ => return None,
        })
    }

    /// Returns all weekdays in order (Sunday through Saturday).
    #[must_use]
    pub const fn all() -> [Self; 7] {
        [
            Self::Sunday,
            Self::Monday,
            Self::Tuesday,
            Self::Wednesday,
            Self::Thursday,
            Self::Friday,
            Self::Saturday,
        ]
    }
}

impl fmt::Display for Weekday {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Weekday with optional occurrence number.
///
/// Used in BYDAY rule part. Examples:
/// - `MO` - every Monday
/// - `1MO` - first Monday of the month/year
/// - `-1FR` - last Friday of the month/year
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WeekdayNum {
    /// Optional occurrence number (-53 to 53, excluding 0).
    pub ordinal: Option<i8>,
    /// The day of the week.
    pub weekday: Weekday,
}

impl WeekdayNum {
    /// Creates a weekday occurrence without an ordinal.
    #[must_use]
    pub const fn every(weekday: Weekday) -> Self {
        Self {
            ordinal: None,
            weekday,
        }
    }

    /// Creates a weekday occurrence with an ordinal.
    ///
    /// ## Panics
    ///
    /// Panics if ordinal is 0 or outside the range -53..=53.
    #[must_use]
    pub fn nth(ordinal: i8, weekday: Weekday) -> Self {
        assert!(ordinal != 0 && (-53..=53).contains(&ordinal));
        Self {
            ordinal: Some(ordinal),
            weekday,
        }
    }
}

impl fmt::Display for WeekdayNum {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let Some(n) = self.ordinal {
            write!(f, "{n}")?;
        }
        write!(f, "{}", self.weekday)
    }
}

/// UNTIL value for RRULE - can be either DATE or DATE-TIME.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RRuleUntil {
    /// Date-only boundary (inclusive).
    Date(Date),
    /// Date-time boundary (inclusive, must be UTC if DTSTART has TZID or is UTC).
    DateTime(super::DateTime),
}

impl fmt::Display for RRuleUntil {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Date(d) => write!(f, "{d}"),
            Self::DateTime(dt) => write!(f, "{dt}"),
        }
    }
}

/// Recurrence rule (RFC 5545 §3.3.10, §3.8.5.3).
///
/// Defines a pattern for recurring events, todos, or journal entries.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RRule {
    /// Recurrence frequency (required).
    pub freq: Option<Frequency>,

    /// Recurrence interval (default: 1).
    /// Defines how often the frequency repeats.
    pub interval: Option<u32>,

    /// End date/time of the recurrence (mutually exclusive with count).
    pub until: Option<RRuleUntil>,

    /// Number of occurrences (mutually exclusive with until).
    pub count: Option<u32>,

    /// Week start day (default: Monday).
    pub wkst: Option<Weekday>,

    /// By-second list (0-60, 60 for leap second).
    pub by_second: Vec<u8>,

    /// By-minute list (0-59).
    pub by_minute: Vec<u8>,

    /// By-hour list (0-23).
    pub by_hour: Vec<u8>,

    /// By-day list with optional occurrence numbers.
    pub by_day: Vec<WeekdayNum>,

    /// By-monthday list (-31 to 31, excluding 0).
    pub by_monthday: Vec<i8>,

    /// By-yearday list (-366 to 366, excluding 0).
    pub by_yearday: Vec<i16>,

    /// By-weekno list (-53 to 53, excluding 0, ISO 8601).
    pub by_weekno: Vec<i8>,

    /// By-month list (1-12).
    pub by_month: Vec<u8>,

    /// By-setpos list (-366 to 366, excluding 0).
    /// Filters on position within the frequency period.
    pub by_setpos: Vec<i16>,
}

impl RRule {
    /// Creates a new empty recurrence rule.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Creates a daily recurrence rule.
    #[must_use]
    pub fn daily() -> Self {
        Self {
            freq: Some(Frequency::Daily),
            ..Self::default()
        }
    }

    /// Creates a weekly recurrence rule.
    #[must_use]
    pub fn weekly() -> Self {
        Self {
            freq: Some(Frequency::Weekly),
            ..Self::default()
        }
    }

    /// Creates a monthly recurrence rule.
    #[must_use]
    pub fn monthly() -> Self {
        Self {
            freq: Some(Frequency::Monthly),
            ..Self::default()
        }
    }

    /// Creates a yearly recurrence rule.
    #[must_use]
    pub fn yearly() -> Self {
        Self {
            freq: Some(Frequency::Yearly),
            ..Self::default()
        }
    }

    /// Sets the interval.
    #[must_use]
    pub fn with_interval(mut self, interval: u32) -> Self {
        self.interval = Some(interval);
        self
    }

    /// Sets the count.
    #[must_use]
    pub fn with_count(mut self, count: u32) -> Self {
        self.count = Some(count);
        self.until = None; // Mutually exclusive
        self
    }

    /// Sets the until date.
    #[must_use]
    pub fn with_until_date(mut self, date: Date) -> Self {
        self.until = Some(RRuleUntil::Date(date));
        self.count = None; // Mutually exclusive
        self
    }

    /// Sets the until date-time.
    #[must_use]
    pub fn with_until_datetime(mut self, datetime: super::DateTime) -> Self {
        self.until = Some(RRuleUntil::DateTime(datetime));
        self.count = None; // Mutually exclusive
        self
    }

    /// Sets the by-day list.
    #[must_use]
    pub fn with_by_day(mut self, days: Vec<WeekdayNum>) -> Self {
        self.by_day = days;
        self
    }

    /// Sets the by-month list.
    #[must_use]
    pub fn with_by_month(mut self, months: Vec<u8>) -> Self {
        self.by_month = months;
        self
    }

    /// Sets the week start day.
    #[must_use]
    pub fn with_wkst(mut self, wkst: Weekday) -> Self {
        self.wkst = Some(wkst);
        self
    }
}

impl fmt::Display for RRule {
    #[expect(clippy::too_many_lines)]
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut parts = Vec::new();

        if let Some(ref freq) = self.freq {
            parts.push(format!("FREQ={freq}"));
        }

        if let Some(interval) = self.interval && interval != 1 {
            parts.push(format!("INTERVAL={interval}"));
        }

        if let Some(ref until) = self.until {
            parts.push(format!("UNTIL={until}"));
        }

        if let Some(count) = self.count {
            parts.push(format!("COUNT={count}"));
        }

        if let Some(wkst) = self.wkst {
            parts.push(format!("WKST={wkst}"));
        }

        if !self.by_second.is_empty() {
            let s: Vec<_> = self.by_second.iter().map(ToString::to_string).collect();
            parts.push(format!("BYSECOND={}", s.join(",")));
        }

        if !self.by_minute.is_empty() {
            let s: Vec<_> = self.by_minute.iter().map(ToString::to_string).collect();
            parts.push(format!("BYMINUTE={}", s.join(",")));
        }

        if !self.by_hour.is_empty() {
            let s: Vec<_> = self.by_hour.iter().map(ToString::to_string).collect();
            parts.push(format!("BYHOUR={}", s.join(",")));
        }

        if !self.by_day.is_empty() {
            let s: Vec<_> = self.by_day.iter().map(ToString::to_string).collect();
            parts.push(format!("BYDAY={}", s.join(",")));
        }

        if !self.by_monthday.is_empty() {
            let s: Vec<_> = self.by_monthday.iter().map(ToString::to_string).collect();
            parts.push(format!("BYMONTHDAY={}", s.join(",")));
        }

        if !self.by_yearday.is_empty() {
            let s: Vec<_> = self.by_yearday.iter().map(ToString::to_string).collect();
            parts.push(format!("BYYEARDAY={}", s.join(",")));
        }

        if !self.by_weekno.is_empty() {
            let s: Vec<_> = self.by_weekno.iter().map(ToString::to_string).collect();
            parts.push(format!("BYWEEKNO={}", s.join(",")));
        }

        if !self.by_month.is_empty() {
            let s: Vec<_> = self.by_month.iter().map(ToString::to_string).collect();
            parts.push(format!("BYMONTH={}", s.join(",")));
        }

        if !self.by_setpos.is_empty() {
            let s: Vec<_> = self.by_setpos.iter().map(ToString::to_string).collect();
            parts.push(format!("BYSETPOS={}", s.join(",")));
        }

        write!(f, "{}", parts.join(";"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rrule_display_basic() {
        let rrule = RRule::daily().with_count(10);
        assert_eq!(rrule.to_string(), "FREQ=DAILY;COUNT=10");
    }

    #[test]
    fn rrule_display_weekly_byday() {
        let rrule = RRule::weekly().with_by_day(vec![
            WeekdayNum::every(Weekday::Monday),
            WeekdayNum::every(Weekday::Wednesday),
            WeekdayNum::every(Weekday::Friday),
        ]);
        assert_eq!(rrule.to_string(), "FREQ=WEEKLY;BYDAY=MO,WE,FR");
    }

    #[test]
    fn rrule_display_monthly_nth() {
        let rrule =
            RRule::monthly().with_by_day(vec![WeekdayNum::nth(-1, Weekday::Friday)]);
        assert_eq!(rrule.to_string(), "FREQ=MONTHLY;BYDAY=-1FR");
    }

    #[test]
    fn rrule_display_with_interval() {
        let rrule = RRule::weekly().with_interval(2);
        assert_eq!(rrule.to_string(), "FREQ=WEEKLY;INTERVAL=2");
    }

    #[test]
    fn weekday_parse() {
        assert_eq!(Weekday::parse("MO"), Some(Weekday::Monday));
        assert_eq!(Weekday::parse("fr"), Some(Weekday::Friday));
        assert_eq!(Weekday::parse("XX"), None);
    }

    #[test]
    fn frequency_parse() {
        assert_eq!(Frequency::parse("DAILY"), Some(Frequency::Daily));
        assert_eq!(Frequency::parse("weekly"), Some(Frequency::Weekly));
        assert_eq!(Frequency::parse("INVALID"), None);
    }
}
