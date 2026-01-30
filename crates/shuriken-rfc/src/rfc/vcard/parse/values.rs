//! vCard value parsers.
//!
//! Error sources are intentionally discarded during parsing (`map_err_ignore`)
//! until richer error types are implemented for value-level parsing.
#![expect(
    clippy::map_err_ignore,
    reason = "Value parsers intentionally discard error sources pending richer error types"
)]

use chrono::NaiveDate;

use super::error::{ParseError, ParseErrorKind, ParseResult};
use crate::rfc::vcard::core::{
    Address, ClientPidMap, DateAndOrTime, Gender, Organization, Sex, StructuredName, VCardDate,
    VCardTime, VCardUtcOffset,
};

/// Unescapes a vCard text value.
///
/// vCard escapes: \n, \N (newline), \, (comma), \; (semicolon), \\ (backslash)
#[must_use]
pub fn unescape_text(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.peek() {
                Some('n' | 'N') => {
                    chars.next();
                    result.push('\n');
                }
                Some(',') => {
                    chars.next();
                    result.push(',');
                }
                Some(';') => {
                    chars.next();
                    result.push(';');
                }
                Some('\\') => {
                    chars.next();
                    result.push('\\');
                }
                _ => result.push(c),
            }
        } else {
            result.push(c);
        }
    }

    result
}

/// Splits a structured value on unescaped semicolons.
#[must_use]
pub fn split_structured(s: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut start = 0;
    let mut chars = s.char_indices().peekable();
    let mut prev_backslash = false;

    #[expect(clippy::while_let_on_iterator)]
    while let Some((i, c)) = chars.next() {
        if c == '\\' {
            prev_backslash = true;
            continue;
        }

        if c == ';' && !prev_backslash {
            parts.push(&s[start..i]);
            start = i + 1;
        }

        prev_backslash = false;
    }

    parts.push(&s[start..]);
    parts
}

/// Splits a component value on unescaped commas.
#[must_use]
pub fn split_component(s: &str) -> Vec<String> {
    if s.is_empty() {
        return Vec::new();
    }

    let mut parts = Vec::new();
    let mut current = String::new();
    let mut chars = s.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '\\' {
            if let Some(&next) = chars.peek() {
                match next {
                    ',' => {
                        chars.next();
                        current.push(',');
                    }
                    ';' => {
                        chars.next();
                        current.push(';');
                    }
                    'n' | 'N' => {
                        chars.next();
                        current.push('\n');
                    }
                    '\\' => {
                        chars.next();
                        current.push('\\');
                    }
                    _ => current.push(c),
                }
            } else {
                current.push(c);
            }
        } else if c == ',' {
            parts.push(std::mem::take(&mut current));
        } else {
            current.push(c);
        }
    }

    parts.push(current);
    parts
}

/// Parses a structured name (N property).
///
/// ## Errors
/// Returns an error if the structured name format is invalid.
pub fn parse_structured_name(value: &str, _line_num: usize) -> ParseResult<StructuredName> {
    let parts = split_structured(value);

    // N has 5 components: family;given;additional;prefixes;suffixes
    // All are optional, but we need at least the structure
    let family = parts
        .first()
        .map(|s| split_component(s))
        .unwrap_or_default();
    let given = parts.get(1).map(|s| split_component(s)).unwrap_or_default();
    let additional = parts.get(2).map(|s| split_component(s)).unwrap_or_default();
    let prefixes = parts.get(3).map(|s| split_component(s)).unwrap_or_default();
    let suffixes = parts.get(4).map(|s| split_component(s)).unwrap_or_default();

    Ok(StructuredName {
        family,
        given,
        additional,
        prefixes,
        suffixes,
    })
}

/// Parses an address (ADR property).
///
/// ## Errors
/// Returns an error if the address format is invalid.
pub fn parse_address(value: &str, _line_num: usize) -> ParseResult<Address> {
    let parts = split_structured(value);

    // ADR has 7 components: PO Box;Extended;Street;Locality;Region;PostalCode;Country
    let po_box = parts
        .first()
        .map(|s| split_component(s))
        .unwrap_or_default();
    let extended = parts.get(1).map(|s| split_component(s)).unwrap_or_default();
    let street = parts.get(2).map(|s| split_component(s)).unwrap_or_default();
    let locality = parts.get(3).map(|s| split_component(s)).unwrap_or_default();
    let region = parts.get(4).map(|s| split_component(s)).unwrap_or_default();
    let postal_code = parts.get(5).map(|s| split_component(s)).unwrap_or_default();
    let country = parts.get(6).map(|s| split_component(s)).unwrap_or_default();

    Ok(Address {
        po_box,
        extended,
        street,
        locality,
        region,
        postal_code,
        country,
    })
}

/// Parses an organization (ORG property).
///
/// ## Errors
/// Returns an error if the organization format is invalid.
pub fn parse_organization(value: &str, _line_num: usize) -> ParseResult<Organization> {
    let parts = split_structured(value);

    let name = parts.first().map(|s| unescape_text(s)).unwrap_or_default();

    let units = parts.iter().skip(1).map(|s| unescape_text(s)).collect();

    Ok(Organization { name, units })
}

/// Parses a gender (GENDER property).
///
/// ## Errors
/// Returns an error if the gender format is invalid.
pub fn parse_gender(value: &str, _line_num: usize) -> ParseResult<Gender> {
    let parts = split_structured(value);

    let sex = parts
        .first()
        .filter(|s| !s.is_empty())
        .and_then(|s| s.chars().next())
        .and_then(Sex::from_char);

    let identity = parts
        .get(1)
        .filter(|s| !s.is_empty())
        .map(|s| unescape_text(s));

    Ok(Gender { sex, identity })
}

/// Parses a client PID map (CLIENTPIDMAP property).
pub fn parse_client_pid_map(value: &str, line_num: usize) -> ParseResult<ClientPidMap> {
    let parts = split_structured(value);

    if parts.len() < 2 {
        return Err(ParseError::new(
            ParseErrorKind::InvalidStructuredValue,
            line_num,
            "CLIENTPIDMAP requires source_id and URI",
        ));
    }

    let source_id: u32 = parts[0].parse().map_err(|_| {
        ParseError::new(
            ParseErrorKind::InvalidValue,
            line_num,
            "invalid source_id in CLIENTPIDMAP",
        )
    })?;

    let uri = parts[1].to_string();

    Ok(ClientPidMap { source_id, uri })
}

/// Parses a vCard date value.
///
/// ## Errors
/// Returns an error if the date format is invalid or unrecognized.
#[expect(
    clippy::too_many_lines,
    reason = "RFC 6350 date formats include many variants"
)]
pub fn parse_date(value: &str, line_num: usize) -> ParseResult<VCardDate> {
    let s = value.trim();

    // Check for truncated forms
    if let Some(rest) = s.strip_prefix("---") {
        // Day only: ---DD
        let day: u32 = rest.parse().map_err(|_| {
            ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid day")
        })?;
        return Ok(VCardDate::Day(day));
    }

    if let Some(rest) = s.strip_prefix("--") {
        // RFC 6350 §4.3.1 truncated date forms:
        // --MM-DD (month and day, extended)
        // --MMDD (month and day, basic)
        // --MM (month only)
        if rest.contains('-') {
            let parts: Vec<&str> = rest.split('-').collect();
            if parts.len() == 2 {
                let month: u32 = parts[0].parse().map_err(|_| {
                    ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid month")
                })?;
                let day: u32 = parts[1].parse().map_err(|_| {
                    ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid day")
                })?;
                return Ok(VCardDate::MonthDay { month, day });
            }
            // Fall through if parts.len() != 2
        } else if rest.len() == 4 {
            // --MMDD (basic format month-day)
            let month: u32 = rest[..2].parse().map_err(|_| {
                ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid month")
            })?;
            let day: u32 = rest[2..].parse().map_err(|_| {
                ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid day")
            })?;
            return Ok(VCardDate::MonthDay { month, day });
        } else if rest.len() == 2 {
            // --MM (month only)
            let month: u32 = rest.parse().map_err(|_| {
                ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid month")
            })?;
            if !(1..=12).contains(&month) {
                return Err(ParseError::new(
                    ParseErrorKind::InvalidDateTime,
                    line_num,
                    "month out of range",
                ));
            }
            return Ok(VCardDate::Month(month));
        } else {
            // Invalid month-day format, fall through
        }
    }

    // Full date: YYYY-MM-DD or YYYYMMDD
    if s.contains('-') && s.len() >= 10 {
        // Extended format
        let parts: Vec<&str> = s.split('-').collect();
        match parts.len() {
            3 => {
                let year: i32 = parts[0].parse().map_err(|_| {
                    ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid year")
                })?;
                let month: u32 = parts[1].parse().map_err(|_| {
                    ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid month")
                })?;
                let day: u32 = parts[2].parse().map_err(|_| {
                    ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid day")
                })?;

                let date = NaiveDate::from_ymd_opt(year, month, day).ok_or_else(|| {
                    ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid date")
                })?;

                return Ok(VCardDate::Full(date));
            }
            2 => {
                // Year-month only
                let year: i32 = parts[0].parse().map_err(|_| {
                    ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid year")
                })?;
                let month: u32 = parts[1].parse().map_err(|_| {
                    ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid month")
                })?;
                return Ok(VCardDate::YearMonth { year, month });
            }
            _ => {
                // Invalid format (not 2 or 3 parts), fall through to subsequent format checks
            }
        }
    }

    // Basic format: YYYYMMDD
    if s.len() == 8 && s.chars().all(|c| c.is_ascii_digit()) {
        let year: i32 = s[..4].parse().map_err(|_| {
            ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid year")
        })?;
        let month: u32 = s[4..6].parse().map_err(|_| {
            ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid month")
        })?;
        let day: u32 = s[6..8].parse().map_err(|_| {
            ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid day")
        })?;

        let date = NaiveDate::from_ymd_opt(year, month, day).ok_or_else(|| {
            ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid date")
        })?;

        return Ok(VCardDate::Full(date));
    }

    // Year only: YYYY
    if s.len() == 4 && s.chars().all(|c| c.is_ascii_digit()) {
        let year: i32 = s.parse().map_err(|_| {
            ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid year")
        })?;
        return Ok(VCardDate::Year(year));
    }

    Err(ParseError::new(
        ParseErrorKind::InvalidDateTime,
        line_num,
        format!("unrecognized date format: {s}"),
    ))
}

/// Parses a vCard time value.
///
/// ## Errors
/// Returns an error if the time format is invalid.
pub fn parse_time(
    value: &str,
    line_num: usize,
) -> ParseResult<(VCardTime, Option<VCardUtcOffset>)> {
    let s = value.trim();

    // Separate time from offset
    let (time_str, offset) = if let Some(stripped) = s.strip_suffix('Z') {
        (stripped, Some(VCardUtcOffset::UTC))
    } else if let Some(pos) = s.rfind('+') {
        let off = parse_utc_offset(&s[pos..], line_num)?;
        (&s[..pos], Some(off))
    } else if let Some(pos) = s.rfind('-') {
        // Make sure it's not part of a date
        if pos > 0 && s[..pos].chars().all(|c| c.is_ascii_digit() || c == ':') {
            let off = parse_utc_offset(&s[pos..], line_num)?;
            (&s[..pos], Some(off))
        } else {
            (s, None)
        }
    } else {
        (s, None)
    };

    // Parse time
    let time = parse_time_value(time_str, line_num)?;

    Ok((time, offset))
}

#[expect(
    clippy::too_many_lines,
    reason = "RFC 6350 time formats include many truncated variants"
)]
fn parse_time_value(s: &str, line_num: usize) -> ParseResult<VCardTime> {
    use chrono::NaiveTime;

    // RFC 6350 §4.3.2: Truncated forms
    // --SS (second only, truncated hour and minute)
    if let Some(sec_str) = s.strip_prefix("--") {
        let second: u32 = sec_str.parse().map_err(|_| {
            ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid second")
        })?;
        if second > 59 {
            return Err(ParseError::new(
                ParseErrorKind::InvalidDateTime,
                line_num,
                "second out of range",
            ));
        }
        return Ok(VCardTime::Second(second));
    }

    // -MM or -MMSS or -MM:SS (minute with optional second, truncated hour)
    if let Some(rest) = s.strip_prefix('-') {
        // Extended format: -MM:SS
        if rest.contains(':') {
            let parts: Vec<&str> = rest.split(':').collect();
            if parts.len() == 2 {
                let minute: u32 = parts[0].parse().map_err(|_| {
                    ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid minute")
                })?;
                let second: u32 = parts[1].parse().map_err(|_| {
                    ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid second")
                })?;
                if minute > 59 || second > 59 {
                    return Err(ParseError::new(
                        ParseErrorKind::InvalidDateTime,
                        line_num,
                        "minute or second out of range",
                    ));
                }
                return Ok(VCardTime::MinuteSecond { minute, second });
            }
            return Err(ParseError::new(
                ParseErrorKind::InvalidDateTime,
                line_num,
                "invalid truncated time format",
            ));
        }

        // Basic format: -MM or -MMSS
        match rest.len() {
            2 => {
                // -MM (minute only, but RFC says minute with optional second)
                // We represent minute-only as MinuteSecond with second=0
                let minute: u32 = rest.parse().map_err(|_| {
                    ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid minute")
                })?;
                if minute > 59 {
                    return Err(ParseError::new(
                        ParseErrorKind::InvalidDateTime,
                        line_num,
                        "minute out of range",
                    ));
                }
                return Ok(VCardTime::MinuteSecond { minute, second: 0 });
            }
            4 => {
                // -MMSS
                let minute: u32 = rest[..2].parse().map_err(|_| {
                    ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid minute")
                })?;
                let second: u32 = rest[2..4].parse().map_err(|_| {
                    ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid second")
                })?;
                if minute > 59 || second > 59 {
                    return Err(ParseError::new(
                        ParseErrorKind::InvalidDateTime,
                        line_num,
                        "minute or second out of range",
                    ));
                }
                return Ok(VCardTime::MinuteSecond { minute, second });
            }
            _ => {
                return Err(ParseError::new(
                    ParseErrorKind::InvalidDateTime,
                    line_num,
                    "invalid truncated time format",
                ));
            }
        }
    }

    // Extended format: HH:MM:SS or HH:MM
    if s.contains(':') {
        let parts: Vec<&str> = s.split(':').collect();
        match parts.len() {
            2 => {
                let hour: u32 = parts[0].parse().map_err(|_| {
                    ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid hour")
                })?;
                let minute: u32 = parts[1].parse().map_err(|_| {
                    ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid minute")
                })?;
                Ok(VCardTime::HourMinute { hour, minute })
            }
            3 => {
                let hour: u32 = parts[0].parse().map_err(|_| {
                    ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid hour")
                })?;
                let minute: u32 = parts[1].parse().map_err(|_| {
                    ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid minute")
                })?;
                // Handle seconds with possible fractional part
                let sec_str = parts[2].split('.').next().unwrap_or(parts[2]);
                let second: u32 = sec_str.parse().map_err(|_| {
                    ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid second")
                })?;

                let time = NaiveTime::from_hms_opt(hour, minute, second).ok_or_else(|| {
                    ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid time")
                })?;

                Ok(VCardTime::Full(time))
            }
            _ => Err(ParseError::new(
                ParseErrorKind::InvalidDateTime,
                line_num,
                "invalid time format",
            )),
        }
    } else {
        // Basic format: HHMMSS or HHMM or HH
        match s.len() {
            2 => {
                let hour: u32 = s.parse().map_err(|_| {
                    ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid hour")
                })?;
                Ok(VCardTime::Hour(hour))
            }
            4 => {
                let hour: u32 = s[..2].parse().map_err(|_| {
                    ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid hour")
                })?;
                let minute: u32 = s[2..4].parse().map_err(|_| {
                    ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid minute")
                })?;
                Ok(VCardTime::HourMinute { hour, minute })
            }
            6..=9 => {
                // 6 = HHMMSS, 7+ includes fractional
                let hour: u32 = s[..2].parse().map_err(|_| {
                    ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid hour")
                })?;
                let minute: u32 = s[2..4].parse().map_err(|_| {
                    ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid minute")
                })?;
                let second: u32 = s[4..6].parse().map_err(|_| {
                    ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid second")
                })?;

                let time = NaiveTime::from_hms_opt(hour, minute, second).ok_or_else(|| {
                    ParseError::new(ParseErrorKind::InvalidDateTime, line_num, "invalid time")
                })?;

                Ok(VCardTime::Full(time))
            }
            _ => Err(ParseError::new(
                ParseErrorKind::InvalidDateTime,
                line_num,
                format!("invalid time format: {s}"),
            )),
        }
    }
}

/// Parses a UTC offset.
///
/// ## Errors
/// Returns an error if the offset format is invalid.
pub fn parse_utc_offset(s: &str, line_num: usize) -> ParseResult<VCardUtcOffset> {
    let s = s.trim();

    if s == "Z" {
        return Ok(VCardUtcOffset::UTC);
    }

    let (sign, rest) = if let Some(rest) = s.strip_prefix('+') {
        (1i8, rest)
    } else if let Some(rest) = s.strip_prefix('-') {
        (-1i8, rest)
    } else {
        return Err(ParseError::new(
            ParseErrorKind::InvalidDateTime,
            line_num,
            "UTC offset must start with + or -",
        ));
    };

    let (hours, minutes) = if rest.contains(':') {
        let parts: Vec<&str> = rest.split(':').collect();
        if parts.len() != 2 {
            return Err(ParseError::new(
                ParseErrorKind::InvalidDateTime,
                line_num,
                "invalid UTC offset format",
            ));
        }
        let h: i8 = parts[0].parse().map_err(|_| {
            ParseError::new(
                ParseErrorKind::InvalidDateTime,
                line_num,
                "invalid offset hours",
            )
        })?;
        let m: u8 = parts[1].parse().map_err(|_| {
            ParseError::new(
                ParseErrorKind::InvalidDateTime,
                line_num,
                "invalid offset minutes",
            )
        })?;
        (h, m)
    } else if rest.len() == 4 {
        let h: i8 = rest[..2].parse().map_err(|_| {
            ParseError::new(
                ParseErrorKind::InvalidDateTime,
                line_num,
                "invalid offset hours",
            )
        })?;
        let m: u8 = rest[2..4].parse().map_err(|_| {
            ParseError::new(
                ParseErrorKind::InvalidDateTime,
                line_num,
                "invalid offset minutes",
            )
        })?;
        (h, m)
    } else if rest.len() == 2 {
        let h: i8 = rest.parse().map_err(|_| {
            ParseError::new(
                ParseErrorKind::InvalidDateTime,
                line_num,
                "invalid offset hours",
            )
        })?;
        (h, 0)
    } else {
        return Err(ParseError::new(
            ParseErrorKind::InvalidDateTime,
            line_num,
            format!("invalid UTC offset: {s}"),
        ));
    };

    Ok(VCardUtcOffset::new(sign * hours, minutes))
}

/// Parses a date-and-or-time value.
///
/// ## Errors
/// Returns an error if the date/time format is invalid.
pub fn parse_date_and_or_time(
    value: &str,
    value_type: Option<&str>,
    line_num: usize,
) -> ParseResult<DateAndOrTime> {
    let s = value.trim();

    // Check for text value
    if value_type == Some("text") {
        return Ok(DateAndOrTime::Text(s.to_string()));
    }

    // Check for time-only (starts with T)
    if let Some(stripped) = s.strip_prefix('T') {
        let (time, offset) = parse_time(stripped, line_num)?;
        return Ok(DateAndOrTime::Time { time, offset });
    }

    // Check if there's a time component
    if s.contains('T') {
        let parts: Vec<&str> = s.splitn(2, 'T').collect();
        let date = parse_date(parts[0], line_num)?;
        let (time, offset) = parse_time(parts[1], line_num)?;
        return Ok(DateAndOrTime::DateTime { date, time, offset });
    }

    // Date only
    let date = parse_date(s, line_num)?;
    Ok(DateAndOrTime::Date(date))
}

/// Parses a timestamp value for the REV property.
///
/// Format: `YYYYMMDDTHHMMSSZ` or `YYYY-MM-DDTHH:MM:SSZ` (both supported).
///
/// Per RFC 6350 §6.7.4, REV must be a UTC timestamp.
///
/// ## Errors
/// Returns an error if the string is not a valid timestamp format.
pub fn parse_timestamp(
    s: &str,
    line_num: usize,
) -> ParseResult<crate::rfc::vcard::core::Timestamp> {
    // Try iCalendar format first: YYYYMMDDTHHMMSSZ
    if let Some(ts) = parse_icalendar_timestamp(s) {
        return Ok(crate::rfc::vcard::core::Timestamp::new(ts));
    }

    // Try ISO 8601 / RFC 3339 format: YYYY-MM-DDTHH:MM:SSZ
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return Ok(crate::rfc::vcard::core::Timestamp::new(
            dt.with_timezone(&chrono::Utc),
        ));
    }

    Err(ParseError::new(
        ParseErrorKind::InvalidValue,
        line_num,
        "invalid timestamp",
    ))
}

/// Parses iCalendar-format timestamp: `YYYYMMDDTHHMMSSZ`
fn parse_icalendar_timestamp(s: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    // Must end with Z for UTC
    let s = s.strip_suffix('Z')?;

    // Must be exactly 15 characters: YYYYMMDDTHHMMSS
    if s.len() != 15 {
        return None;
    }

    // Must have T at position 8
    if s.as_bytes().get(8) != Some(&b'T') {
        return None;
    }

    let year = s[0..4].parse::<i32>().ok()?;
    let month = s[4..6].parse::<u32>().ok()?;
    let day = s[6..8].parse::<u32>().ok()?;
    let hour = s[9..11].parse::<u32>().ok()?;
    let minute = s[11..13].parse::<u32>().ok()?;
    let second = s[13..15].parse::<u32>().ok()?;

    chrono::NaiveDate::from_ymd_opt(year, month, day)
        .and_then(|d| d.and_hms_opt(hour, minute, second))
        .map(|dt| chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(dt, chrono::Utc))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unescape_text_newline() {
        assert_eq!(unescape_text(r"Line1\nLine2"), "Line1\nLine2");
        assert_eq!(unescape_text(r"Line1\NLine2"), "Line1\nLine2");
    }

    #[test]
    fn unescape_text_special() {
        assert_eq!(unescape_text(r"a\,b\;c\\d"), "a,b;c\\d");
    }

    #[test]
    fn split_structured_basic() {
        let parts = split_structured("Doe;John;Q;Mr.;Jr.");
        assert_eq!(parts, vec!["Doe", "John", "Q", "Mr.", "Jr."]);
    }

    #[test]
    fn split_structured_escaped() {
        let parts = split_structured(r"Doe\;Smith;John");
        assert_eq!(parts, vec![r"Doe\;Smith", "John"]);
    }

    #[test]
    fn split_component_commas() {
        let parts = split_component("a,b,c");
        assert_eq!(parts, vec!["a", "b", "c"]);
    }

    #[test]
    fn parse_structured_name_full() {
        let name = parse_structured_name("Doe;John;Quincy;Mr.;Jr.", 1).unwrap();
        assert_eq!(name.family, vec!["Doe"]);
        assert_eq!(name.given, vec!["John"]);
        assert_eq!(name.additional, vec!["Quincy"]);
        assert_eq!(name.prefixes, vec!["Mr."]);
        assert_eq!(name.suffixes, vec!["Jr."]);
    }

    #[test]
    fn parse_address_full() {
        let addr = parse_address(";;123 Main St;Anytown;CA;12345;USA", 1).unwrap();
        assert!(addr.po_box.is_empty());
        assert_eq!(addr.street, vec!["123 Main St"]);
        assert_eq!(addr.locality, vec!["Anytown"]);
    }

    #[test]
    fn parse_organization_with_units() {
        let org = parse_organization("Acme Inc.;Engineering;Backend Team", 1).unwrap();
        assert_eq!(org.name, "Acme Inc.");
        assert_eq!(org.units, vec!["Engineering", "Backend Team"]);
    }

    #[test]
    fn parse_gender_full() {
        let gender = parse_gender("F;female", 1).unwrap();
        assert_eq!(gender.sex, Some(Sex::Female));
        assert_eq!(gender.identity, Some("female".to_string()));
    }

    #[test]
    fn parse_date_full() {
        use chrono::Datelike;
        let date = parse_date("1990-06-15", 1).unwrap();
        matches!(date, VCardDate::Full(d) if d.year() == 1990);
    }

    #[test]
    fn parse_date_month_day() {
        let date = parse_date("--12-25", 1).unwrap();
        assert_eq!(date, VCardDate::MonthDay { month: 12, day: 25 });
    }

    #[test]
    fn parse_date_month_only() {
        // RFC 6350 §4.3.1: --MM format (month only)
        let date = parse_date("--06", 1).unwrap();
        assert_eq!(date, VCardDate::Month(6));
    }

    #[test]
    fn parse_date_year_only() {
        let date = parse_date("1990", 1).unwrap();
        assert_eq!(date, VCardDate::Year(1990));
    }

    #[test]
    fn parse_utc_offset_positive() {
        let offset = parse_utc_offset("+05:30", 1).unwrap();
        assert_eq!(offset.hours, 5);
        assert_eq!(offset.minutes, 30);
    }

    #[test]
    fn parse_utc_offset_negative() {
        let offset = parse_utc_offset("-0800", 1).unwrap();
        assert_eq!(offset.hours, -8);
        assert_eq!(offset.minutes, 0);
    }

    #[test]
    fn parse_datetime_full() {
        let dt = parse_date_and_or_time("1990-06-15T14:30:00Z", None, 1).unwrap();
        match dt {
            DateAndOrTime::DateTime {
                date,
                time: _,
                offset,
            } => {
                assert!(matches!(date, VCardDate::Full(_)));
                assert!(offset.is_some());
            }
            _ => panic!("expected DateTime"),
        }
    }

    #[test]
    fn parse_datetime_text() {
        let dt = parse_date_and_or_time("circa 1800", Some("text"), 1).unwrap();
        assert!(matches!(dt, DateAndOrTime::Text(_)));
    }

    #[test]
    fn parse_time_truncated_second_only() {
        // RFC 6350 §4.3.2: --SS format (second only)
        let (time, offset) = parse_time("--30", 1).unwrap();
        assert_eq!(time, VCardTime::Second(30));
        assert!(offset.is_none());
    }

    #[test]
    fn parse_time_truncated_minute_second_basic() {
        // RFC 6350 §4.3.2: -MMSS format (minute and second, basic)
        let (time, offset) = parse_time("-1530", 1).unwrap();
        assert_eq!(
            time,
            VCardTime::MinuteSecond {
                minute: 15,
                second: 30
            }
        );
        assert!(offset.is_none());
    }

    #[test]
    fn parse_time_truncated_minute_second_extended() {
        // RFC 6350 §4.3.2: -MM:SS format (minute and second, extended)
        let (time, offset) = parse_time("-15:30", 1).unwrap();
        assert_eq!(
            time,
            VCardTime::MinuteSecond {
                minute: 15,
                second: 30
            }
        );
        assert!(offset.is_none());
    }

    #[test]
    fn parse_time_truncated_minute_only() {
        // RFC 6350 §4.3.2: -MM format (minute only)
        let (time, offset) = parse_time("-15", 1).unwrap();
        assert_eq!(
            time,
            VCardTime::MinuteSecond {
                minute: 15,
                second: 0
            }
        );
        assert!(offset.is_none());
    }

    #[test]
    fn parse_time_truncated_with_offset() {
        // RFC 6350 §4.3.2: truncated time with UTC offset
        let (time, offset) = parse_time("--30Z", 1).unwrap();
        assert_eq!(time, VCardTime::Second(30));
        assert_eq!(offset, Some(VCardUtcOffset::UTC));
    }
}
