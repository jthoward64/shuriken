//! iCalendar document parser (RFC 5545).
//!
//! Parses complete iCalendar documents into typed structures.

use super::error::{ParseError, ParseErrorKind, ParseResult};
use super::lexer::{parse_content_line, split_lines};
use super::values::{
    parse_boolean, parse_date, parse_datetime, parse_duration, parse_float, parse_integer,
    parse_period, parse_rrule, parse_utc_offset, unescape_text,
};
use crate::component::rfc::ical::core::{
    Component, ComponentKind, ContentLine, Date, DateTime, ICalendar, Property, Value,
};

/// Parses an iCalendar document from a string.
///
/// ## Errors
///
/// Returns an error if the input is not valid iCalendar.
#[tracing::instrument(skip(input), fields(input_len = input.len()))]
pub fn parse(input: &str) -> ParseResult<ICalendar> {
    tracing::debug!("Parsing iCalendar document");
    
    let lines = split_lines(input);

    if lines.is_empty() {
        tracing::warn!("Empty iCalendar input");
        return Err(ParseError::new(ParseErrorKind::MissingBegin, 1, 1));
    }

    tracing::info!(count = lines.len(), "Split lines");

    let content_lines: Vec<(usize, ContentLine)> = lines
        .into_iter()
        .map(|(line_num, line)| {
            let parsed = parse_content_line(&line, line_num);
            parsed.map(|cl| (line_num, cl))
        })
        .collect::<ParseResult<_>>()?;

    tracing::trace!(count = content_lines.len(), "Parsed content lines");

    let mut iter = content_lines.into_iter().peekable();
    let root = parse_component(&mut iter, None)?;

    // Verify it's a VCALENDAR
    if root.kind != Some(ComponentKind::Calendar) {
        tracing::warn!("Root component is not VCALENDAR");
        return Err(
            ParseError::new(ParseErrorKind::MissingBegin, 1, 1).with_context("expected VCALENDAR")
        );
    }

    tracing::debug!("iCalendar document parsed successfully");

    Ok(ICalendar { root })
}

/// Parses a single component from the content line iterator.
#[expect(clippy::too_many_lines)]
fn parse_component(
    iter: &mut std::iter::Peekable<impl Iterator<Item = (usize, ContentLine)>>,
    expected_name: Option<&str>,
) -> ParseResult<Component> {
    // Expect BEGIN:COMPONENT
    let (line_num, begin_line) = iter
        .next()
        .ok_or_else(|| ParseError::new(ParseErrorKind::MissingBegin, 1, 1))?;

    if begin_line.name != "BEGIN" {
        return Err(ParseError::new(ParseErrorKind::MissingBegin, line_num, 1));
    }

    let component_name = begin_line.raw_value.to_ascii_uppercase();
    if let Some(expected) = expected_name
        && component_name != expected
    {
        return Err(
            ParseError::new(ParseErrorKind::MismatchedComponent, line_num, 1)
                .with_context(format!("expected {expected}, got {component_name}")),
        );
    }

    let kind = ComponentKind::parse(&component_name);
    let mut component = Component {
        kind: Some(kind),
        name: component_name.clone(),
        properties: Vec::new(),
        children: Vec::new(),
    };

    // Parse properties and nested components until END
    loop {
        let Some((line_num, content_line)) = iter.next() else {
            return Err(ParseError::new(ParseErrorKind::MissingEnd, line_num, 1)
                .with_context(format!("missing END:{component_name}")));
        };

        match content_line.name.as_str() {
            "BEGIN" => {
                // Put the BEGIN line back by reconstructing
                let nested_name = content_line.raw_value.to_ascii_uppercase();
                let _begin_cl = ContentLine::new("BEGIN", &nested_name);

                // Create a temp iterator with this line at front
                let nested = parse_component_from_begin(iter, line_num, &nested_name)?;
                component.children.push(nested);
            }
            "END" => {
                let end_name = content_line.raw_value.to_ascii_uppercase();
                if end_name != component_name {
                    return Err(
                        ParseError::new(ParseErrorKind::MismatchedComponent, line_num, 1)
                            .with_context(format!(
                                "expected END:{component_name}, got END:{end_name}"
                            )),
                    );
                }
                break;
            }
            _ => {
                let property = parse_property(content_line, line_num)?;
                component.properties.push(property);
            }
        }
    }

    Ok(component)
}

/// Parses a component given that we already have the BEGIN line info.
fn parse_component_from_begin(
    iter: &mut std::iter::Peekable<impl Iterator<Item = (usize, ContentLine)>>,
    begin_line_num: usize,
    component_name: &str,
) -> ParseResult<Component> {
    let kind = ComponentKind::parse(component_name);
    let mut component = Component {
        kind: Some(kind),
        name: component_name.to_string(),
        properties: Vec::new(),
        children: Vec::new(),
    };

    let mut last_line_num = begin_line_num;

    loop {
        let Some((line_num, content_line)) = iter.next() else {
            return Err(
                ParseError::new(ParseErrorKind::MissingEnd, last_line_num, 1)
                    .with_context(format!("missing END:{component_name}")),
            );
        };
        last_line_num = line_num;

        match content_line.name.as_str() {
            "BEGIN" => {
                let nested_name = content_line.raw_value.to_ascii_uppercase();
                let nested = parse_component_from_begin(iter, line_num, &nested_name)?;
                component.children.push(nested);
            }
            "END" => {
                let end_name = content_line.raw_value.to_ascii_uppercase();
                if end_name != component_name {
                    return Err(
                        ParseError::new(ParseErrorKind::MismatchedComponent, line_num, 1)
                            .with_context(format!(
                                "expected END:{component_name}, got END:{end_name}"
                            )),
                    );
                }
                break;
            }
            _ => {
                let property = parse_property(content_line, line_num)?;
                component.properties.push(property);
            }
        }
    }

    Ok(component)
}

/// Parses a property from a content line, resolving the value type.
fn parse_property(cl: ContentLine, line_num: usize) -> ParseResult<Property> {
    let value_type = determine_value_type(&cl);
    let tzid = cl.tzid();

    let parsed_value = parse_value(&cl.raw_value, value_type, tzid, line_num)?;

    Ok(Property {
        name: cl.name,
        params: cl.params,
        value: parsed_value,
        raw_value: cl.raw_value,
    })
}

/// Determines the value type for a property.
fn determine_value_type(cl: &ContentLine) -> ValueType {
    // Check explicit VALUE parameter first
    if let Some(value_type) = cl.value_type() {
        return ValueType::from_param(value_type);
    }

    // Use property-specific defaults
    match cl.name.as_str() {
        // Date-time properties
        "DTSTART" | "DTEND" | "DTSTAMP" | "CREATED" | "LAST-MODIFIED" | "COMPLETED" | "DUE"
        | "RECURRENCE-ID" => ValueType::DateTime,

        // Date-only by default for some
        "EXDATE" | "RDATE" => {
            // Check if value looks like a date (8 chars, no 'T')
            if cl.raw_value.len() == 8 && !cl.raw_value.contains('T') {
                ValueType::Date
            } else if cl.raw_value.contains('/') {
                ValueType::Period
            } else {
                ValueType::DateTime
            }
        }

        // Duration properties
        "DURATION" | "TRIGGER" => {
            if cl.raw_value.starts_with('P')
                || cl.raw_value.starts_with('-')
                || cl.raw_value.starts_with('+')
            {
                ValueType::Duration
            } else {
                ValueType::DateTime
            }
        }

        // Integer properties
        "PERCENT-COMPLETE" | "PRIORITY" | "REPEAT" | "SEQUENCE" => ValueType::Integer,

        // Boolean properties
        "RSVP" => ValueType::Boolean,

        // Recurrence rule
        "RRULE" | "EXRULE" => ValueType::Recur,

        // UTC offset properties
        "TZOFFSETFROM" | "TZOFFSETTO" => ValueType::UtcOffset,

        // URI properties
        "URL" | "TZURL" | "SOURCE" => ValueType::Uri,

        // Freebusy
        "FREEBUSY" => ValueType::Period,

        // Cal-address properties
        "ATTENDEE" | "ORGANIZER" => ValueType::CalAddress,

        // Default to text (includes GEO which could be handled specially if needed)
        _ => ValueType::Text,
    }
}

/// Internal enum for value type handling.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ValueType {
    Binary,
    Boolean,
    CalAddress,
    Date,
    DateTime,
    Duration,
    Float,
    Integer,
    Period,
    Recur,
    Text,
    Time,
    Uri,
    UtcOffset,
    Unknown,
}

impl ValueType {
    fn from_param(s: &str) -> Self {
        match s.to_ascii_uppercase().as_str() {
            "BINARY" => Self::Binary,
            "BOOLEAN" => Self::Boolean,
            "CAL-ADDRESS" => Self::CalAddress,
            "DATE" => Self::Date,
            "DATE-TIME" => Self::DateTime,
            "DURATION" => Self::Duration,
            "FLOAT" => Self::Float,
            "INTEGER" => Self::Integer,
            "PERIOD" => Self::Period,
            "RECUR" => Self::Recur,
            "TEXT" => Self::Text,
            "TIME" => Self::Time,
            "URI" => Self::Uri,
            "UTC-OFFSET" => Self::UtcOffset,
            _ => Self::Unknown,
        }
    }
}

/// Parses a raw value string into a typed Value.
#[expect(clippy::too_many_lines)]
fn parse_value(
    raw: &str,
    value_type: ValueType,
    tzid: Option<&str>,
    line_num: usize,
) -> ParseResult<Value> {
    match value_type {
        ValueType::Text => Ok(Value::Text(unescape_text(raw))),
        ValueType::DateTime => {
            // Handle comma-separated list (EXDATE, RDATE)
            if raw.contains(',') && !raw.contains('/') {
                // Multiple date-times
                let dts: Vec<DateTime> = raw
                    .split(',')
                    .map(|s| parse_datetime(s.trim(), tzid, line_num, 1))
                    .collect::<ParseResult<_>>()?;
                // For now, just take the first one. TODO: handle lists properly
                if let Some(dt) = dts.into_iter().next() {
                    Ok(Value::DateTime(dt))
                } else {
                    Ok(Value::Unknown(raw.to_string()))
                }
            } else {
                Ok(Value::DateTime(parse_datetime(raw, tzid, line_num, 1)?))
            }
        }
        ValueType::Date => {
            if raw.contains(',') {
                // Multiple dates
                let dates: Vec<Date> = raw
                    .split(',')
                    .map(|s| parse_date(s.trim(), line_num, 1))
                    .collect::<ParseResult<_>>()?;
                if let Some(d) = dates.into_iter().next() {
                    Ok(Value::Date(d))
                } else {
                    Ok(Value::Unknown(raw.to_string()))
                }
            } else {
                Ok(Value::Date(parse_date(raw, line_num, 1)?))
            }
        }
        ValueType::Duration => Ok(Value::Duration(parse_duration(raw, line_num, 1)?)),
        ValueType::Period => {
            // Handle comma-separated periods (FREEBUSY)
            if raw.contains(',') {
                // Just parse the first one for now
                let first = raw.split(',').next().unwrap_or(raw);
                Ok(Value::Period(parse_period(
                    first.trim(),
                    tzid,
                    line_num,
                    1,
                )?))
            } else {
                Ok(Value::Period(parse_period(raw, tzid, line_num, 1)?))
            }
        }
        ValueType::Integer => Ok(Value::Integer(parse_integer(raw, line_num, 1)?)),
        ValueType::Float => Ok(Value::Float(parse_float(raw, line_num, 1)?)),
        ValueType::Boolean => Ok(Value::Boolean(parse_boolean(raw, line_num, 1)?)),
        ValueType::Recur => Ok(Value::Recur(Box::new(parse_rrule(raw, line_num, 1)?))),
        ValueType::UtcOffset => Ok(Value::UtcOffset(parse_utc_offset(raw, line_num, 1)?)),
        ValueType::Uri | ValueType::CalAddress => Ok(Value::Uri(raw.to_string())),
        ValueType::Binary => {
            // Base64 decode
            // For now, just store as unknown
            Ok(Value::Unknown(raw.to_string()))
        }
        ValueType::Time => {
            let time = super::values::parse_time(raw, line_num, 1)?;
            Ok(Value::Time(time))
        }
        ValueType::Unknown => Ok(Value::Unknown(raw.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SIMPLE_VEVENT: &str = "\
BEGIN:VCALENDAR\r\n\
VERSION:2.0\r\n\
PRODID:-//Test//Test//EN\r\n\
BEGIN:VEVENT\r\n\
UID:test-uid-123@example.com\r\n\
DTSTAMP:20260123T120000Z\r\n\
DTSTART:20260123T140000Z\r\n\
DTEND:20260123T150000Z\r\n\
SUMMARY:Test Event\r\n\
END:VEVENT\r\n\
END:VCALENDAR\r\n";

    #[test]
    fn parse_simple_vevent() {
        let ical = parse(SIMPLE_VEVENT).unwrap();

        assert_eq!(ical.version(), Some("2.0"));
        assert_eq!(ical.prodid(), Some("-//Test//Test//EN"));

        let events = ical.events();
        assert_eq!(events.len(), 1);

        let event = &events[0];
        assert_eq!(event.uid(), Some("test-uid-123@example.com"));
        assert_eq!(event.summary(), Some("Test Event"));
    }

    #[test]
    fn parse_with_timezone() {
        let input = "\
BEGIN:VCALENDAR\r\n\
VERSION:2.0\r\n\
PRODID:-//Test//Test//EN\r\n\
BEGIN:VEVENT\r\n\
UID:test@example.com\r\n\
DTSTAMP:20260123T120000Z\r\n\
DTSTART;TZID=America/New_York:20260123T090000\r\n\
SUMMARY:Morning Meeting\r\n\
END:VEVENT\r\n\
END:VCALENDAR\r\n";

        let ical = parse(input).unwrap();
        let event = &ical.events()[0];

        let dtstart = event.get_property("DTSTART").unwrap();
        let dt = dtstart.as_datetime().unwrap();
        assert_eq!(dt.tzid(), Some("America/New_York"));
        assert_eq!(dt.hour, 9);
    }

    #[test]
    fn parse_with_rrule() {
        let input = "\
BEGIN:VCALENDAR\r\n\
VERSION:2.0\r\n\
PRODID:-//Test//Test//EN\r\n\
BEGIN:VEVENT\r\n\
UID:recurring@example.com\r\n\
DTSTAMP:20260123T120000Z\r\n\
DTSTART:20260123T090000Z\r\n\
RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=10\r\n\
SUMMARY:Recurring Meeting\r\n\
END:VEVENT\r\n\
END:VCALENDAR\r\n";

        let ical = parse(input).unwrap();
        let event = &ical.events()[0];

        let rrule_prop = event.get_property("RRULE").unwrap();
        let rrule = rrule_prop.value.as_recur().unwrap();

        assert_eq!(
            rrule.freq,
            Some(crate::component::rfc::ical::core::Frequency::Weekly)
        );
        assert_eq!(rrule.count, Some(10));
        assert_eq!(rrule.by_day.len(), 3);
    }

    #[test]
    fn parse_with_valarm() {
        let input = "\
BEGIN:VCALENDAR\r\n\
VERSION:2.0\r\n\
PRODID:-//Test//Test//EN\r\n\
BEGIN:VEVENT\r\n\
UID:alarm@example.com\r\n\
DTSTAMP:20260123T120000Z\r\n\
DTSTART:20260123T090000Z\r\n\
SUMMARY:Event with Alarm\r\n\
BEGIN:VALARM\r\n\
ACTION:DISPLAY\r\n\
TRIGGER:-PT15M\r\n\
DESCRIPTION:Reminder\r\n\
END:VALARM\r\n\
END:VEVENT\r\n\
END:VCALENDAR\r\n";

        let ical = parse(input).unwrap();
        let event = &ical.events()[0];

        let alarms = event.alarms();
        assert_eq!(alarms.len(), 1);

        let alarm = alarms[0];
        let action = alarm.get_property("ACTION").unwrap();
        assert_eq!(action.as_text(), Some("DISPLAY"));
    }

    #[test]
    fn parse_multiple_events() {
        let input = "\
BEGIN:VCALENDAR\r\n\
VERSION:2.0\r\n\
PRODID:-//Test//Test//EN\r\n\
BEGIN:VEVENT\r\n\
UID:event1@example.com\r\n\
DTSTAMP:20260123T120000Z\r\n\
DTSTART:20260123T090000Z\r\n\
SUMMARY:Event 1\r\n\
END:VEVENT\r\n\
BEGIN:VEVENT\r\n\
UID:event2@example.com\r\n\
DTSTAMP:20260123T120000Z\r\n\
DTSTART:20260124T090000Z\r\n\
SUMMARY:Event 2\r\n\
END:VEVENT\r\n\
END:VCALENDAR\r\n";

        let ical = parse(input).unwrap();
        assert_eq!(ical.events().len(), 2);
        assert_eq!(
            ical.uids(),
            vec!["event1@example.com", "event2@example.com"]
        );
    }

    #[test]
    fn parse_with_escaped_text() {
        let input = "\
BEGIN:VCALENDAR\r\n\
VERSION:2.0\r\n\
PRODID:-//Test//Test//EN\r\n\
BEGIN:VEVENT\r\n\
UID:escaped@example.com\r\n\
DTSTAMP:20260123T120000Z\r\n\
DTSTART:20260123T090000Z\r\n\
SUMMARY:Meeting\\, important\r\n\
DESCRIPTION:Line 1\\nLine 2\\nLine 3\r\n\
END:VEVENT\r\n\
END:VCALENDAR\r\n";

        let ical = parse(input).unwrap();
        let event = &ical.events()[0];

        assert_eq!(event.summary(), Some("Meeting, important"));
        assert_eq!(event.description(), Some("Line 1\nLine 2\nLine 3"));
    }

    #[test]
    fn parse_with_folded_lines() {
        let input = "\
BEGIN:VCALENDAR\r\n\
VERSION:2.0\r\n\
PRODID:-//Test//Test//EN\r\n\
BEGIN:VEVENT\r\n\
UID:folded@example.com\r\n\
DTSTAMP:20260123T120000Z\r\n\
DTSTART:20260123T090000Z\r\n\
SUMMARY:This is a very long summary that needs to be folded across\r\n\
  multiple lines to comply with the 75 octet limit\r\n\
END:VEVENT\r\n\
END:VCALENDAR\r\n";

        let ical = parse(input).unwrap();
        let event = &ical.events()[0];

        let summary = event.summary().unwrap();
        assert!(summary.contains("folded across"));
        assert!(summary.contains("multiple lines"));
    }

    #[test]
    fn parse_missing_begin() {
        let input = "VERSION:2.0\r\n";
        let result = parse(input);
        assert!(result.is_err());
    }

    #[test]
    fn parse_mismatched_end() {
        let input = "\
BEGIN:VCALENDAR\r\n\
VERSION:2.0\r\n\
END:VEVENT\r\n";
        let result = parse(input);
        assert!(result.is_err());
    }

    #[test]
    fn parse_preserves_x_properties() {
        let input = "\
BEGIN:VCALENDAR\r\n\
VERSION:2.0\r\n\
PRODID:-//Test//Test//EN\r\n\
BEGIN:VEVENT\r\n\
UID:xprop@example.com\r\n\
DTSTAMP:20260123T120000Z\r\n\
DTSTART:20260123T090000Z\r\n\
X-CUSTOM-PROP:Custom Value\r\n\
X-APPLE-STRUCTURED-LOCATION:geo:37.7749,-122.4194\r\n\
SUMMARY:Event\r\n\
END:VEVENT\r\n\
END:VCALENDAR\r\n";

        let ical = parse(input).unwrap();
        let event = &ical.events()[0];

        let x_custom = event.get_property("X-CUSTOM-PROP").unwrap();
        assert_eq!(x_custom.raw_value, "Custom Value");

        let x_apple = event.get_property("X-APPLE-STRUCTURED-LOCATION").unwrap();
        assert!(x_apple.raw_value.contains("geo:"));
    }
}
