//! Value type parsers for iCalendar (RFC 5545 §3.3).
//!
//! Error sources are intentionally discarded during parsing (`map_err_ignore`)
//! until richer error types are implemented for value-level parsing.
#![expect(
    clippy::map_err_ignore,
    reason = "Value parsers intentionally discard error sources pending richer error types"
)]

use super::error::{ParseError, ParseErrorKind, ParseResult};
use crate::rfc::ical::core::{
    Date, DateTime, DateTimeForm, Duration, Frequency, Period, RRule, RRuleUntil, Time, UtcOffset,
    Weekday, WeekdayNum,
};

/// Parses a DATE value (RFC 5545 §3.3.4).
///
/// Format: YYYYMMDD (e.g., "19970714")
///
/// ## Errors
/// Returns an error if the string is not a valid 8-digit date.
pub fn parse_date(s: &str, line: usize, col: usize) -> ParseResult<Date> {
    if s.len() != 8 {
        return Err(ParseError::new(ParseErrorKind::InvalidDate, line, col));
    }

    let year = s[0..4]
        .parse::<u16>()
        .map_err(|_| ParseError::new(ParseErrorKind::InvalidDate, line, col))?;
    let month = s[4..6]
        .parse::<u8>()
        .map_err(|_| ParseError::new(ParseErrorKind::InvalidDate, line, col))?;
    let day = s[6..8]
        .parse::<u8>()
        .map_err(|_| ParseError::new(ParseErrorKind::InvalidDate, line, col))?;

    // Basic validation
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return Err(ParseError::new(ParseErrorKind::InvalidDate, line, col));
    }

    Ok(Date { year, month, day })
}

/// Parses a TIME value (RFC 5545 §3.3.12).
///
/// Format: HHMMSS[Z] (e.g., "133000", "133000Z")
///
/// ## Errors
/// Returns an error if the string is not a valid 6-digit time.
pub fn parse_time(s: &str, line: usize, col: usize) -> ParseResult<Time> {
    let (time_str, is_utc) = if let Some(stripped) = s.strip_suffix('Z') {
        (stripped, true)
    } else {
        (s, false)
    };

    if time_str.len() != 6 {
        return Err(ParseError::new(ParseErrorKind::InvalidTime, line, col));
    }

    let hour = time_str[0..2]
        .parse::<u8>()
        .map_err(|_| ParseError::new(ParseErrorKind::InvalidTime, line, col))?;
    let minute = time_str[2..4]
        .parse::<u8>()
        .map_err(|_| ParseError::new(ParseErrorKind::InvalidTime, line, col))?;
    let second = time_str[4..6]
        .parse::<u8>()
        .map_err(|_| ParseError::new(ParseErrorKind::InvalidTime, line, col))?;

    // Basic validation (allow 60 for leap seconds)
    if hour > 23 || minute > 59 || second > 60 {
        return Err(ParseError::new(ParseErrorKind::InvalidTime, line, col));
    }

    Ok(Time {
        hour,
        minute,
        second,
        is_utc,
    })
}

/// Parses a DATE-TIME value (RFC 5545 §3.3.5).
///
/// Format: YYYYMMDD"T"HHMMSS[Z] (e.g., "19970714T133000Z")
///
/// Note: TZID is handled at the property level, not in the value itself.
///
/// ## Errors
/// Returns an error if the string is not a valid datetime format.
pub fn parse_datetime(
    s: &str,
    tzid: Option<&str>,
    line: usize,
    col: usize,
) -> ParseResult<DateTime> {
    let t_pos = s
        .find('T')
        .ok_or_else(|| ParseError::new(ParseErrorKind::InvalidDateTime, line, col))?;

    let date_str = &s[..t_pos];
    let time_str = &s[t_pos + 1..];

    let date = parse_date(date_str, line, col)?;
    let time = parse_time(time_str, line, col + t_pos + 1)?;

    let form = if time.is_utc {
        DateTimeForm::Utc
    } else if let Some(tz) = tzid {
        DateTimeForm::Zoned {
            tzid: tz.to_string(),
        }
    } else {
        DateTimeForm::Floating
    };

    Ok(DateTime {
        year: date.year,
        month: date.month,
        day: date.day,
        hour: time.hour,
        minute: time.minute,
        second: time.second,
        form,
    })
}

/// Parses a UTC-OFFSET value (RFC 5545 §3.3.14).
///
/// Format: (+|-)HHMM[SS] (e.g., "+0530", "-0800")
///
/// ## Errors
/// Returns an error if the string is not a valid UTC offset format.
pub fn parse_utc_offset(s: &str, line: usize, col: usize) -> ParseResult<UtcOffset> {
    if s.len() < 5 {
        return Err(ParseError::new(ParseErrorKind::InvalidUtcOffset, line, col));
    }

    let sign = match s.chars().next() {
        Some('+') => 1,
        Some('-') => -1,
        _ => return Err(ParseError::new(ParseErrorKind::InvalidUtcOffset, line, col)),
    };

    let hours = s[1..3]
        .parse::<i32>()
        .map_err(|_e| ParseError::new(ParseErrorKind::InvalidUtcOffset, line, col))?;
    let minutes = s[3..5]
        .parse::<i32>()
        .map_err(|_e| ParseError::new(ParseErrorKind::InvalidUtcOffset, line, col))?;

    let seconds = if s.len() >= 7 {
        s[5..7]
            .parse::<i32>()
            .map_err(|_e| ParseError::new(ParseErrorKind::InvalidUtcOffset, line, col))?
    } else {
        0
    };

    let total = sign * (hours * 3600 + minutes * 60 + seconds);
    Ok(UtcOffset::from_seconds(total))
}

/// Parses a DURATION value (RFC 5545 §3.3.6).
///
/// Format: [+|-]P[nW] or [+|-]P[nD][T[nH][nM][nS]]
///
/// ## Errors
/// Returns an error if the string is not a valid duration format.
pub fn parse_duration(s: &str, line: usize, col: usize) -> ParseResult<Duration> {
    let mut chars = s.chars().peekable();
    let mut dur = Duration::zero();

    // Parse optional sign
    if let Some('-') = chars.peek() {
        dur.negative = true;
        chars.next();
    } else if let Some('+') = chars.peek() {
        chars.next();
    } else {
        // No sign present, duration is positive
    }

    // Must start with 'P'
    if chars.next() != Some('P') {
        return Err(ParseError::new(ParseErrorKind::InvalidDuration, line, col));
    }

    // Check for week format (simplest case)
    let remaining: String = chars.clone().collect();
    if remaining.ends_with('W') {
        return parse_duration_weeks(&remaining, line, col);
    }

    // Parse day/time format
    parse_duration_components(s, &mut dur, chars, line, col)?;
    Ok(dur)
}

/// Parses week-based duration format.
fn parse_duration_weeks(remaining: &str, line: usize, col: usize) -> ParseResult<Duration> {
    let num_str = &remaining[..remaining.len() - 1];
    let weeks = num_str
        .parse()
        .map_err(|_| ParseError::new(ParseErrorKind::InvalidDuration, line, col))?;
    Ok(Duration {
        weeks,
        ..Duration::zero()
    })
}

/// Parses day/hour/minute/second components of a duration.
fn parse_duration_components(
    s: &str,
    dur: &mut Duration,
    chars: std::iter::Peekable<std::str::Chars<'_>>,
    line: usize,
    col: usize,
) -> ParseResult<()> {
    let mut in_time = false;
    let mut num_start = None;

    for (i, c) in chars.enumerate() {
        if c.is_ascii_digit() {
            if num_start.is_none() {
                num_start = Some(i);
            }
        } else {
            let num = extract_duration_number(s, num_start, dur.negative, i, c, line, col)?;
            apply_duration_component(dur, c, num, in_time, line, col)?;

            if c == 'T' {
                in_time = true;
            }
            num_start = None;
        }
    }
    Ok(())
}

/// Extracts a number from the duration string.
#[expect(
    clippy::too_many_arguments,
    reason = "Duration parser helper requires these parameters for state tracking"
)]
fn extract_duration_number(
    s: &str,
    num_start: Option<usize>,
    negative: bool,
    i: usize,
    c: char,
    line: usize,
    col: usize,
) -> ParseResult<u32> {
    if let Some(start) = num_start {
        let offset = if negative { 2 } else { 1 };
        let num_str = &s[(start + offset)..=(i + offset)];
        let num_only = &num_str[..num_str.len() - 1];
        num_only
            .parse::<u32>()
            .map_err(|_| ParseError::new(ParseErrorKind::InvalidDuration, line, col))
    } else if c == 'T' {
        Ok(0) // T with no preceding number is valid
    } else {
        Err(ParseError::new(ParseErrorKind::InvalidDuration, line, col))
    }
}

/// Applies a parsed component value to the duration.
#[expect(
    clippy::too_many_arguments,
    reason = "Duration parser helper requires these parameters for state tracking"
)]
fn apply_duration_component(
    dur: &mut Duration,
    c: char,
    num: u32,
    in_time: bool,
    line: usize,
    col: usize,
) -> ParseResult<()> {
    match c {
        'D' if !in_time => dur.days = num,
        'H' if in_time => dur.hours = num,
        'M' if in_time => dur.minutes = num,
        'S' if in_time => dur.seconds = num,
        'T' => {} // Already handled
        _ => return Err(ParseError::new(ParseErrorKind::InvalidDuration, line, col)),
    }
    Ok(())
}

/// Parses a PERIOD value (RFC 5545 §3.3.9).
///
/// Format: start"/"end or start"/"duration
///
/// ## Errors
/// Returns an error if the string is not a valid period format.
pub fn parse_period(s: &str, tzid: Option<&str>, line: usize, col: usize) -> ParseResult<Period> {
    let slash_pos = s
        .find('/')
        .ok_or_else(|| ParseError::new(ParseErrorKind::InvalidPeriod, line, col))?;

    let start_str = &s[..slash_pos];
    let end_str = &s[slash_pos + 1..];

    let start = parse_datetime(start_str, tzid, line, col)?;

    if end_str.starts_with('P') || end_str.starts_with('+') || end_str.starts_with('-') {
        // Duration format
        let duration = parse_duration(end_str, line, col + slash_pos + 1)?;
        Ok(Period::Duration { start, duration })
    } else {
        // Explicit end format
        let end = parse_datetime(end_str, tzid, line, col + slash_pos + 1)?;
        Ok(Period::Explicit { start, end })
    }
}

/// Parses a RECUR (RRULE) value (RFC 5545 §3.3.10).
///
/// ## Errors
/// Returns an error if the string is not a valid recurrence rule.
pub fn parse_rrule(s: &str, line: usize, col: usize) -> ParseResult<RRule> {
    let mut rrule = RRule::new();

    for part in s.split(';') {
        let eq_pos = part
            .find('=')
            .ok_or_else(|| ParseError::new(ParseErrorKind::InvalidRRule, line, col))?;

        let key = &part[..eq_pos];
        let value = &part[eq_pos + 1..];

        parse_rrule_part(&mut rrule, key, value, line, col)?;
    }

    Ok(rrule)
}

/// Parses a single RRULE key-value pair.
fn parse_rrule_part(
    rrule: &mut RRule,
    key: &str,
    value: &str,
    line: usize,
    col: usize,
) -> ParseResult<()> {
    match key.to_ascii_uppercase().as_str() {
        "FREQ" => {
            rrule.freq = Some(
                Frequency::parse(value)
                    .ok_or_else(|| ParseError::new(ParseErrorKind::InvalidFrequency, line, col))?,
            );
        }
        "INTERVAL" => {
            rrule.interval = Some(
                value
                    .parse()
                    .map_err(|_| ParseError::new(ParseErrorKind::InvalidRRule, line, col))?,
            );
        }
        "COUNT" => parse_rrule_count(rrule, value, line, col)?,
        "UNTIL" => parse_rrule_until(rrule, value, line, col)?,
        "WKST" => {
            rrule.wkst = Some(
                Weekday::parse(value)
                    .ok_or_else(|| ParseError::new(ParseErrorKind::InvalidWeekday, line, col))?,
            );
        }
        "BYSECOND" => rrule.by_second = parse_u8_list(value, line, col)?,
        "BYMINUTE" => rrule.by_minute = parse_u8_list(value, line, col)?,
        "BYHOUR" => rrule.by_hour = parse_u8_list(value, line, col)?,
        "BYDAY" => rrule.by_day = parse_byday(value, line, col)?,
        "BYMONTHDAY" => rrule.by_monthday = parse_i8_list(value, line, col)?,
        "BYYEARDAY" => rrule.by_yearday = parse_i16_list(value, line, col)?,
        "BYWEEKNO" => rrule.by_weekno = parse_i8_list(value, line, col)?,
        "BYMONTH" => rrule.by_month = parse_u8_list(value, line, col)?,
        "BYSETPOS" => rrule.by_setpos = parse_i16_list(value, line, col)?,
        _ => {} // Unknown rule part - ignore
    }
    Ok(())
}

/// Parses the COUNT component of an RRULE.
fn parse_rrule_count(rrule: &mut RRule, value: &str, line: usize, col: usize) -> ParseResult<()> {
    if rrule.until.is_some() {
        return Err(ParseError::new(
            ParseErrorKind::UntilCountConflict,
            line,
            col,
        ));
    }
    rrule.count = Some(
        value
            .parse()
            .map_err(|_| ParseError::new(ParseErrorKind::InvalidRRule, line, col))?,
    );
    Ok(())
}

/// Parses the UNTIL component of an RRULE.
fn parse_rrule_until(rrule: &mut RRule, value: &str, line: usize, col: usize) -> ParseResult<()> {
    if rrule.count.is_some() {
        return Err(ParseError::new(
            ParseErrorKind::UntilCountConflict,
            line,
            col,
        ));
    }
    // UNTIL can be DATE or DATE-TIME
    if value.contains('T') {
        rrule.until = Some(RRuleUntil::DateTime(parse_datetime(
            value, None, line, col,
        )?));
    } else {
        rrule.until = Some(RRuleUntil::Date(parse_date(value, line, col)?));
    }
    Ok(())
}

/// Parses a comma-separated list of u8 values.
fn parse_u8_list(s: &str, line: usize, col: usize) -> ParseResult<Vec<u8>> {
    s.split(',')
        .map(|v| {
            v.trim()
                .parse()
                .map_err(|_| ParseError::new(ParseErrorKind::InvalidRRule, line, col))
        })
        .collect()
}

/// Parses a comma-separated list of i8 values.
fn parse_i8_list(s: &str, line: usize, col: usize) -> ParseResult<Vec<i8>> {
    s.split(',')
        .map(|v| {
            v.trim()
                .parse()
                .map_err(|_| ParseError::new(ParseErrorKind::InvalidRRule, line, col))
        })
        .collect()
}

/// Parses a comma-separated list of i16 values.
fn parse_i16_list(s: &str, line: usize, col: usize) -> ParseResult<Vec<i16>> {
    s.split(',')
        .map(|v| {
            v.trim()
                .parse()
                .map_err(|_| ParseError::new(ParseErrorKind::InvalidRRule, line, col))
        })
        .collect()
}

/// Parses a BYDAY value (weekdays with optional ordinals).
fn parse_byday(s: &str, line: usize, col: usize) -> ParseResult<Vec<WeekdayNum>> {
    s.split(',')
        .map(|v| parse_weekday_num(v.trim(), line, col))
        .collect()
}

/// Parses a single weekday with optional ordinal (e.g., "MO", "1MO", "-1FR").
fn parse_weekday_num(s: &str, line: usize, col: usize) -> ParseResult<WeekdayNum> {
    let s = s.trim();

    // Find where the weekday starts (last two characters should be weekday)
    if s.len() < 2 {
        return Err(ParseError::new(ParseErrorKind::InvalidWeekday, line, col));
    }

    let weekday_str = &s[s.len() - 2..];
    let ordinal_str = &s[..s.len() - 2];

    let weekday = Weekday::parse(weekday_str)
        .ok_or_else(|| ParseError::new(ParseErrorKind::InvalidWeekday, line, col))?;

    let ordinal = if ordinal_str.is_empty() {
        None
    } else {
        Some(
            ordinal_str
                .parse()
                .map_err(|_| ParseError::new(ParseErrorKind::InvalidRRule, line, col))?,
        )
    };

    Ok(WeekdayNum { ordinal, weekday })
}

/// Unescapes text values (RFC 5545 §3.3.11).
///
/// Escape sequences: \\ \, \; \n \N
#[must_use]
pub fn unescape_text(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n' | 'N') => result.push('\n'),
                Some(',') => result.push(','),
                Some(';') => result.push(';'),
                Some('\\') | None => result.push('\\'),
                Some(other) => {
                    // Invalid escape, preserve as-is
                    result.push('\\');
                    result.push(other);
                }
            }
        } else {
            result.push(c);
        }
    }

    result
}

/// Parses a BOOLEAN value (RFC 5545 §3.3.2).
///
/// ## Errors
/// Returns an error if the string is not "TRUE" or "FALSE".
pub fn parse_boolean(s: &str, line: usize, col: usize) -> ParseResult<bool> {
    match s.to_ascii_uppercase().as_str() {
        "TRUE" => Ok(true),
        "FALSE" => Ok(false),
        _ => Err(ParseError::new(ParseErrorKind::InvalidBoolean, line, col)),
    }
}

/// Parses an INTEGER value (RFC 5545 §3.3.8).
///
/// ## Errors
/// Returns an error if the string is not a valid integer.
pub fn parse_integer(s: &str, line: usize, col: usize) -> ParseResult<i32> {
    s.parse()
        .map_err(|_| ParseError::new(ParseErrorKind::InvalidInteger, line, col))
}

/// Parses a FLOAT value (RFC 5545 §3.3.7).
///
/// ## Errors
/// Returns an error if the string is not a valid floating-point number.
pub fn parse_float(s: &str, line: usize, col: usize) -> ParseResult<f64> {
    s.parse()
        .map_err(|_| ParseError::new(ParseErrorKind::InvalidFloat, line, col))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_date_basic() {
        let date = parse_date("20260123", 1, 1).unwrap();
        assert_eq!(date.year, 2026);
        assert_eq!(date.month, 1);
        assert_eq!(date.day, 23);
    }

    #[test]
    fn parse_date_invalid() {
        assert!(parse_date("2026012", 1, 1).is_err()); // Too short
        assert!(parse_date("20261301", 1, 1).is_err()); // Invalid month
    }

    #[test]
    fn parse_time_utc() {
        let time = parse_time("120000Z", 1, 1).unwrap();
        assert_eq!(time.hour, 12);
        assert_eq!(time.minute, 0);
        assert_eq!(time.second, 0);
        assert!(time.is_utc);
    }

    #[test]
    fn parse_time_local() {
        let time = parse_time("133000", 1, 1).unwrap();
        assert_eq!(time.hour, 13);
        assert_eq!(time.minute, 30);
        assert_eq!(time.second, 0);
        assert!(!time.is_utc);
    }

    #[test]
    fn parse_datetime_utc() {
        let dt = parse_datetime("20260123T120000Z", None, 1, 1).unwrap();
        assert!(dt.is_utc());
        assert_eq!(dt.year, 2026);
    }

    #[test]
    fn parse_datetime_floating() {
        let dt = parse_datetime("20260123T120000", None, 1, 1).unwrap();
        assert!(dt.is_floating());
    }

    #[test]
    fn parse_datetime_zoned() {
        let dt = parse_datetime("20260123T120000", Some("America/New_York"), 1, 1).unwrap();
        assert_eq!(dt.tzid(), Some("America/New_York"));
    }

    #[test]
    fn parse_duration_weeks() {
        let dur = parse_duration("P2W", 1, 1).unwrap();
        assert_eq!(dur.weeks, 2);
    }

    #[test]
    fn parse_duration_days_time() {
        let dur = parse_duration("P1DT2H30M", 1, 1).unwrap();
        assert_eq!(dur.days, 1);
        assert_eq!(dur.hours, 2);
        assert_eq!(dur.minutes, 30);
    }

    #[test]
    fn parse_duration_negative() {
        let dur = parse_duration("-PT15M", 1, 1).unwrap();
        assert!(dur.negative);
        assert_eq!(dur.minutes, 15);
    }

    #[test]
    fn parse_utc_offset_positive() {
        let offset = parse_utc_offset("+0530", 1, 1).unwrap();
        assert_eq!(offset.hours(), 5);
        assert_eq!(offset.minutes(), 30);
    }

    #[test]
    fn parse_utc_offset_negative() {
        let offset = parse_utc_offset("-0800", 1, 1).unwrap();
        assert_eq!(offset.hours(), -8);
        assert_eq!(offset.minutes(), 0);
    }

    #[test]
    fn parse_rrule_basic() {
        let rrule = parse_rrule("FREQ=DAILY;COUNT=10", 1, 1).unwrap();
        assert_eq!(rrule.freq, Some(Frequency::Daily));
        assert_eq!(rrule.count, Some(10));
    }

    #[test]
    fn parse_rrule_weekly_byday() {
        let rrule = parse_rrule("FREQ=WEEKLY;BYDAY=MO,WE,FR", 1, 1).unwrap();
        assert_eq!(rrule.freq, Some(Frequency::Weekly));
        assert_eq!(rrule.by_day.len(), 3);
    }

    #[test]
    fn parse_rrule_monthly_nth() {
        let rrule = parse_rrule("FREQ=MONTHLY;BYDAY=-1FR", 1, 1).unwrap();
        assert_eq!(rrule.by_day.len(), 1);
        assert_eq!(rrule.by_day[0].ordinal, Some(-1));
        assert_eq!(rrule.by_day[0].weekday, Weekday::Friday);
    }

    #[test]
    fn parse_rrule_until_count_conflict() {
        let result = parse_rrule("FREQ=DAILY;COUNT=10;UNTIL=20260131", 1, 1);
        assert!(result.is_err());
    }

    #[test]
    fn unescape_text_basic() {
        assert_eq!(unescape_text("hello\\, world"), "hello, world");
        assert_eq!(unescape_text("line1\\nline2"), "line1\nline2");
        assert_eq!(unescape_text("back\\\\slash"), "back\\slash");
    }

    #[test]
    fn parse_period_explicit() {
        let period = parse_period("20260123T090000Z/20260123T170000Z", None, 1, 1).unwrap();
        match period {
            Period::Explicit { start, end } => {
                assert_eq!(start.hour, 9);
                assert_eq!(end.hour, 17);
            }
            Period::Duration { .. } => panic!("Expected explicit period"),
        }
    }

    #[test]
    fn parse_period_duration() {
        let period = parse_period("20260123T090000Z/PT8H", None, 1, 1).unwrap();
        match period {
            Period::Duration { start, duration } => {
                assert_eq!(start.hour, 9);
                assert_eq!(duration.hours, 8);
            }
            Period::Explicit { .. } => panic!("Expected duration period"),
        }
    }
}
