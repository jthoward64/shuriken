//! Tests for vCard parse errors.

use super::error::{ParseError, ParseErrorKind};

#[test]
fn error_new() {
    let err = ParseError::new(ParseErrorKind::UnexpectedEof, 5, "test message");
    assert_eq!(err.line, 5);
    assert_eq!(err.kind, ParseErrorKind::UnexpectedEof);
    assert_eq!(err.message, "test message");
}

#[test]
fn error_unexpected() {
    let err = ParseError::unexpected(10, "VERSION", "FN");
    assert_eq!(err.line, 10);
    assert_eq!(err.kind, ParseErrorKind::UnexpectedToken);
    assert!(err.message.contains("expected VERSION"));
    assert!(err.message.contains("found FN"));
}

#[test]
fn error_missing_property() {
    let err = ParseError::missing_property(3, "FN");
    assert_eq!(err.line, 3);
    assert_eq!(err.kind, ParseErrorKind::MissingProperty);
    assert!(err.message.contains("FN"));
}

#[test]
fn error_invalid_value() {
    let err = ParseError::invalid_value(7, "malformed phone number");
    assert_eq!(err.line, 7);
    assert_eq!(err.kind, ParseErrorKind::InvalidValue);
    assert_eq!(err.message, "malformed phone number");
}

#[test]
fn error_display() {
    let err = ParseError::new(ParseErrorKind::InvalidDateTime, 12, "bad date");
    let displayed = format!("{err}");
    assert!(displayed.contains("line 12"));
    assert!(displayed.contains("invalid date/time"));
    assert!(displayed.contains("bad date"));
}

#[test]
fn error_kind_display() {
    assert_eq!(
        format!("{}", ParseErrorKind::UnexpectedEof),
        "unexpected end of input"
    );
    assert_eq!(
        format!("{}", ParseErrorKind::UnexpectedToken),
        "unexpected token"
    );
    assert_eq!(format!("{}", ParseErrorKind::InvalidValue), "invalid value");
    assert_eq!(
        format!("{}", ParseErrorKind::MissingProperty),
        "missing property"
    );
    assert_eq!(
        format!("{}", ParseErrorKind::InvalidPropertyName),
        "invalid property name"
    );
    assert_eq!(
        format!("{}", ParseErrorKind::InvalidParameter),
        "invalid parameter"
    );
    assert_eq!(
        format!("{}", ParseErrorKind::InvalidStructuredValue),
        "invalid structured value"
    );
    assert_eq!(
        format!("{}", ParseErrorKind::InvalidDateTime),
        "invalid date/time"
    );
    assert_eq!(
        format!("{}", ParseErrorKind::UnsupportedVersion),
        "unsupported version"
    );
    assert_eq!(
        format!("{}", ParseErrorKind::EncodingError),
        "encoding error"
    );
}

#[test]
fn error_kind_equality() {
    assert_eq!(ParseErrorKind::InvalidValue, ParseErrorKind::InvalidValue);
    assert_ne!(
        ParseErrorKind::InvalidValue,
        ParseErrorKind::MissingProperty
    );
}

#[test]
fn error_clone() {
    let err = ParseError::new(ParseErrorKind::EncodingError, 15, "utf-8 error");
    let cloned = err.clone();
    assert_eq!(err.line, cloned.line);
    assert_eq!(err.kind, cloned.kind);
    assert_eq!(err.message, cloned.message);
}

#[test]
fn error_kind_clone() {
    let kind = ParseErrorKind::UnsupportedVersion;
    let cloned = kind;
    assert_eq!(kind, cloned);
}

#[test]
fn error_as_std_error() {
    let err = ParseError::new(ParseErrorKind::InvalidValue, 1, "test");
    let _: &dyn std::error::Error = &err;
}
