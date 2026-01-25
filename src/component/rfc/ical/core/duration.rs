//! iCalendar DURATION value type (RFC 5545 §3.3.6).

use std::fmt;

/// Duration value (RFC 5545 §3.3.6).
///
/// Represents a duration of time. iCalendar durations can be either:
/// - Week-based: `P1W` (1 week)
/// - Day/time-based: `P1DT2H30M` (1 day, 2 hours, 30 minutes)
///
/// Note: iCalendar does not support year/month designators in durations
/// because months have variable lengths.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Duration {
    /// Whether this duration is negative.
    pub negative: bool,
    /// Number of weeks (mutually exclusive with days/hours/minutes/seconds).
    pub weeks: u32,
    /// Number of days.
    pub days: u32,
    /// Number of hours.
    pub hours: u32,
    /// Number of minutes.
    pub minutes: u32,
    /// Number of seconds.
    pub seconds: u32,
}

impl Duration {
    /// Creates a new zero duration.
    #[must_use]
    pub const fn zero() -> Self {
        Self {
            negative: false,
            weeks: 0,
            days: 0,
            hours: 0,
            minutes: 0,
            seconds: 0,
        }
    }

    /// Creates a duration from weeks.
    #[must_use]
    pub const fn weeks(weeks: u32) -> Self {
        Self {
            negative: false,
            weeks,
            days: 0,
            hours: 0,
            minutes: 0,
            seconds: 0,
        }
    }

    /// Creates a duration from days.
    #[must_use]
    pub const fn days(days: u32) -> Self {
        Self {
            negative: false,
            weeks: 0,
            days,
            hours: 0,
            minutes: 0,
            seconds: 0,
        }
    }

    /// Creates a duration from hours.
    #[must_use]
    pub const fn hours(hours: u32) -> Self {
        Self {
            negative: false,
            weeks: 0,
            days: 0,
            hours,
            minutes: 0,
            seconds: 0,
        }
    }

    /// Creates a duration from minutes.
    #[must_use]
    pub const fn minutes(minutes: u32) -> Self {
        Self {
            negative: false,
            weeks: 0,
            days: 0,
            hours: 0,
            minutes,
            seconds: 0,
        }
    }

    /// Creates a duration from seconds.
    #[must_use]
    pub const fn seconds(seconds: u32) -> Self {
        Self {
            negative: false,
            weeks: 0,
            days: 0,
            hours: 0,
            minutes: 0,
            seconds,
        }
    }

    /// Creates a new duration builder.
    #[must_use]
    pub const fn builder() -> DurationBuilder {
        DurationBuilder::new()
    }

    /// Returns whether this is a week-based duration.
    #[must_use]
    pub const fn is_week_based(&self) -> bool {
        self.weeks > 0
    }

    /// Negates this duration.
    #[must_use]
    pub const fn negate(mut self) -> Self {
        self.negative = !self.negative;
        self
    }

    /// Returns the total duration as seconds.
    #[must_use]
    pub const fn as_seconds(&self) -> i64 {
        let total = (self.weeks as i64 * 7 * 24 * 3600)
            + (self.days as i64 * 24 * 3600)
            + (self.hours as i64 * 3600)
            + (self.minutes as i64 * 60)
            + (self.seconds as i64);

        if self.negative { -total } else { total }
    }
}

impl fmt::Display for Duration {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.negative {
            write!(f, "-")?;
        }
        write!(f, "P")?;

        if self.weeks > 0 {
            write!(f, "{}W", self.weeks)?;
        } else {
            if self.days > 0 {
                write!(f, "{}D", self.days)?;
            }
            if self.hours > 0 || self.minutes > 0 || self.seconds > 0 {
                write!(f, "T")?;
                if self.hours > 0 {
                    write!(f, "{}H", self.hours)?;
                }
                if self.minutes > 0 {
                    write!(f, "{}M", self.minutes)?;
                }
                if self.seconds > 0 {
                    write!(f, "{}S", self.seconds)?;
                }
            } else if self.days == 0 {
                // Zero duration: P0D
                write!(f, "0D")?;
            } else {
                // Days > 0 but no time components - already handled above
            }
        }
        Ok(())
    }
}

/// Builder for constructing `Duration` values.
#[derive(Debug, Clone, Copy, Default)]
pub struct DurationBuilder {
    negative: bool,
    weeks: u32,
    days: u32,
    hours: u32,
    minutes: u32,
    seconds: u32,
}

impl DurationBuilder {
    /// Creates a new duration builder.
    #[must_use]
    pub const fn new() -> Self {
        Self {
            negative: false,
            weeks: 0,
            days: 0,
            hours: 0,
            minutes: 0,
            seconds: 0,
        }
    }

    /// Sets the duration as negative.
    #[must_use]
    pub const fn negative(mut self) -> Self {
        self.negative = true;
        self
    }

    /// Sets the weeks component.
    #[must_use]
    pub const fn weeks(mut self, weeks: u32) -> Self {
        self.weeks = weeks;
        self
    }

    /// Sets the days component.
    #[must_use]
    pub const fn days(mut self, days: u32) -> Self {
        self.days = days;
        self
    }

    /// Sets the hours component.
    #[must_use]
    pub const fn hours(mut self, hours: u32) -> Self {
        self.hours = hours;
        self
    }

    /// Sets the minutes component.
    #[must_use]
    pub const fn minutes(mut self, minutes: u32) -> Self {
        self.minutes = minutes;
        self
    }

    /// Sets the seconds component.
    #[must_use]
    pub const fn seconds(mut self, seconds: u32) -> Self {
        self.seconds = seconds;
        self
    }

    /// Builds the duration.
    #[must_use]
    pub const fn build(self) -> Duration {
        Duration {
            negative: self.negative,
            weeks: self.weeks,
            days: self.days,
            hours: self.hours,
            minutes: self.minutes,
            seconds: self.seconds,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duration_display_weeks() {
        assert_eq!(Duration::weeks(2).to_string(), "P2W");
    }

    #[test]
    fn duration_display_days_time() {
        let d = Duration::builder().days(1).hours(2).minutes(30).build();
        assert_eq!(d.to_string(), "P1DT2H30M");
    }

    #[test]
    fn duration_display_time_only() {
        assert_eq!(Duration::minutes(15).to_string(), "PT15M");
    }

    #[test]
    fn duration_display_negative() {
        assert_eq!(Duration::minutes(15).negate().to_string(), "-PT15M");
    }

    #[test]
    fn duration_display_zero() {
        assert_eq!(Duration::zero().to_string(), "P0D");
    }

    #[test]
    fn duration_as_seconds() {
        let d = Duration::builder().days(1).hours(2).minutes(30).build();
        assert_eq!(d.as_seconds(), 24 * 3600 + 2 * 3600 + 30 * 60);

        let d = Duration::minutes(15).negate();
        assert_eq!(d.as_seconds(), -15 * 60);
    }
}
