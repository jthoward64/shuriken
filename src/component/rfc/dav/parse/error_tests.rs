//! Tests for DAV XML parse errors.

use super::error::{ParseError, ParseErrorKind};

#[test]
fn error_new() {
    let err = ParseError::new(ParseErrorKind::XmlError, "malformed XML");
    assert!(matches!(err.kind, ParseErrorKind::XmlError));
    assert_eq!(err.message, "malformed XML");
}

#[test]
fn error_xml() {
    let err = ParseError::xml("unclosed tag");
    assert!(matches!(err.kind, ParseErrorKind::XmlError));
    assert!(err.message.contains("unclosed tag"));
}

#[test]
fn error_missing_element() {
    let err = ParseError::missing_element("prop");
    assert!(matches!(err.kind, ParseErrorKind::MissingElement));
    assert!(err.message.contains("prop"));
    assert!(err.message.contains("missing required element"));
}

#[test]
fn error_unexpected_element() {
    let err = ParseError::unexpected_element("unknown");
    assert!(matches!(err.kind, ParseErrorKind::UnexpectedElement));
    assert!(err.message.contains("unknown"));
    assert!(err.message.contains("unexpected element"));
}

#[test]
fn error_invalid_value() {
    let err = ParseError::invalid_value("depth must be 0, 1, or infinity");
    assert!(matches!(err.kind, ParseErrorKind::InvalidValue));
    assert_eq!(err.message, "depth must be 0, 1, or infinity");
}

#[test]
fn error_unsupported_namespace() {
    let err = ParseError::unsupported_namespace("http://example.com/ns");
    assert!(matches!(err.kind, ParseErrorKind::UnsupportedNamespace));
    assert!(err.message.contains("http://example.com/ns"));
}

#[test]
fn error_display() {
    let err = ParseError::xml("test error message");
    let displayed = format!("{}", err);
    assert!(displayed.contains("XML error"));
    assert!(displayed.contains("test error message"));
}

#[test]
fn error_kind_display() {
    assert_eq!(format!("{}", ParseErrorKind::XmlError), "XML error");
    assert_eq!(format!("{}", ParseErrorKind::MissingElement), "missing element");
    assert_eq!(format!("{}", ParseErrorKind::UnexpectedElement), "unexpected element");
    assert_eq!(format!("{}", ParseErrorKind::InvalidValue), "invalid value");
    assert_eq!(format!("{}", ParseErrorKind::UnsupportedNamespace), "unsupported namespace");
    assert_eq!(format!("{}", ParseErrorKind::EncodingError), "encoding error");
}

#[test]
fn error_kind_equality() {
    assert_eq!(ParseErrorKind::XmlError, ParseErrorKind::XmlError);
    assert_ne!(ParseErrorKind::XmlError, ParseErrorKind::InvalidValue);
}

#[test]
fn error_kind_clone() {
    let kind = ParseErrorKind::MissingElement;
    let cloned = kind;
    assert_eq!(kind, cloned);
}

#[test]
fn error_as_std_error() {
    let err = ParseError::new(ParseErrorKind::InvalidValue, "test");
    let _: &dyn std::error::Error = &err;
}

#[test]
fn error_from_utf8_error() {
    let invalid_utf8 = vec![0xFF, 0xFE, 0xFD];
    let utf8_err = std::str::from_utf8(&invalid_utf8).unwrap_err();
    let parse_err: ParseError = utf8_err.into();
    assert!(matches!(parse_err.kind, ParseErrorKind::EncodingError));
}
