//! Tests for iCalendar parse errors.

use super::*;

#[test]
fn test_parse_error_new() {
    let error = ParseError::new(ParseErrorKind::UnexpectedEof, 10, 5);
    assert_eq!(error.kind, ParseErrorKind::UnexpectedEof);
    assert_eq!(error.line, 10);
    assert_eq!(error.column, 5);
    assert!(error.context.is_none());
}

#[test]
fn test_parse_error_with_context() {
    let error =
        ParseError::new(ParseErrorKind::InvalidDate, 3, 2).with_context("Expected YYYYMMDD format");

    assert_eq!(error.kind, ParseErrorKind::InvalidDate);
    assert_eq!(error.line, 3);
    assert_eq!(error.column, 2);
    assert_eq!(error.context.as_deref(), Some("Expected YYYYMMDD format"));
}

#[test]
fn test_parse_error_display() {
    let error = ParseError::new(ParseErrorKind::MissingColon, 1, 10);
    let display = format!("{error}");
    assert!(display.contains("missing colon separator"));
    assert!(display.contains("line 1"));
    assert!(display.contains("column 10"));
}

#[test]
fn test_parse_error_display_with_context() {
    let error = ParseError::new(ParseErrorKind::InvalidParameter, 5, 15)
        .with_context("NAME=VALUE expected");
    let display = format!("{error}");
    assert!(display.contains("invalid parameter format"));
    assert!(display.contains("line 5"));
    assert!(display.contains("column 15"));
    assert!(display.contains("NAME=VALUE expected"));
}

#[test]
fn test_all_error_kinds_display() {
    let kinds = [
        (ParseErrorKind::UnexpectedEof, "unexpected end of input"),
        (
            ParseErrorKind::InvalidContentLine,
            "invalid content line format",
        ),
        (ParseErrorKind::MissingPropertyName, "missing property name"),
        (ParseErrorKind::InvalidPropertyName, "invalid property name"),
        (ParseErrorKind::MissingColon, "missing colon separator"),
        (ParseErrorKind::InvalidParameter, "invalid parameter format"),
        (ParseErrorKind::UnclosedQuote, "unclosed quoted string"),
        (ParseErrorKind::InvalidEscape, "invalid escape sequence"),
        (ParseErrorKind::InvalidDate, "invalid date format"),
        (ParseErrorKind::InvalidTime, "invalid time format"),
        (ParseErrorKind::InvalidDateTime, "invalid date-time format"),
        (ParseErrorKind::InvalidDuration, "invalid duration format"),
        (ParseErrorKind::InvalidRRule, "invalid recurrence rule"),
        (
            ParseErrorKind::InvalidUtcOffset,
            "invalid UTC offset format",
        ),
        (ParseErrorKind::MissingBegin, "missing BEGIN line"),
        (ParseErrorKind::MissingEnd, "missing END line"),
        (ParseErrorKind::MismatchedComponent, "mismatched BEGIN/END"),
        (ParseErrorKind::InvalidNesting, "invalid component nesting"),
        (
            ParseErrorKind::MissingRequiredProperty,
            "missing required property",
        ),
        (ParseErrorKind::InvalidValue, "invalid property value"),
        (ParseErrorKind::InvalidBoolean, "invalid boolean value"),
        (ParseErrorKind::InvalidInteger, "invalid integer value"),
        (ParseErrorKind::InvalidFloat, "invalid float value"),
        (ParseErrorKind::InvalidPeriod, "invalid period format"),
        (ParseErrorKind::InvalidFrequency, "invalid frequency"),
        (ParseErrorKind::InvalidWeekday, "invalid weekday"),
        (
            ParseErrorKind::UntilCountConflict,
            "UNTIL and COUNT are mutually exclusive",
        ),
    ];

    for (kind, expected) in kinds {
        let display = format!("{kind}");
        assert_eq!(display, expected, "Mismatch for {kind:?}");
    }
}

#[test]
fn test_parse_error_is_error_trait() {
    let error = ParseError::new(ParseErrorKind::InvalidFloat, 2, 3);
    // Verify it implements std::error::Error
    let _: &dyn std::error::Error = &error;
}

#[test]
fn test_parse_error_clone() {
    let original =
        ParseError::new(ParseErrorKind::InvalidRRule, 7, 8).with_context("Invalid FREQ value");
    let cloned = original.clone();

    assert_eq!(cloned.kind, original.kind);
    assert_eq!(cloned.line, original.line);
    assert_eq!(cloned.column, original.column);
    assert_eq!(cloned.context, original.context);
}

#[test]
fn test_parse_error_debug() {
    let error = ParseError::new(ParseErrorKind::MismatchedComponent, 12, 3);
    let debug = format!("{error:?}");
    assert!(debug.contains("ParseError"));
    assert!(debug.contains("MismatchedComponent"));
}
