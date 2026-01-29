//! vCard parse error types.

use std::fmt;

/// Result type for vCard parsing operations.
pub type ParseResult<T> = Result<T, ParseError>;

/// An error that occurred during vCard parsing.
#[derive(Debug, Clone)]
pub struct ParseError {
    /// The kind of error.
    pub kind: ParseErrorKind,
    /// Line number where the error occurred (1-based).
    pub line: usize,
    /// Additional context or message.
    pub message: String,
}

impl ParseError {
    /// Creates a new parse error.
    #[must_use]
    pub fn new(kind: ParseErrorKind, line: usize, message: impl Into<String>) -> Self {
        Self {
            kind,
            line,
            message: message.into(),
        }
    }

    /// Creates an unexpected token error.
    #[must_use]
    pub fn unexpected(line: usize, expected: &str, found: &str) -> Self {
        Self::new(
            ParseErrorKind::UnexpectedToken,
            line,
            format!("expected {expected}, found {found}"),
        )
    }

    /// Creates a missing property error.
    #[must_use]
    pub fn missing_property(line: usize, name: &str) -> Self {
        Self::new(
            ParseErrorKind::MissingProperty,
            line,
            format!("missing required property: {name}"),
        )
    }

    /// Creates an invalid value error.
    #[must_use]
    pub fn invalid_value(line: usize, message: impl Into<String>) -> Self {
        Self::new(ParseErrorKind::InvalidValue, line, message)
    }
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "line {}: {}: {}", self.line, self.kind, self.message)
    }
}

impl std::error::Error for ParseError {}

/// The kind of parse error.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParseErrorKind {
    /// Unexpected end of input.
    UnexpectedEof,
    /// Unexpected token or character.
    UnexpectedToken,
    /// Invalid property value.
    InvalidValue,
    /// Missing required property.
    MissingProperty,
    /// Invalid property name.
    InvalidPropertyName,
    /// Invalid parameter.
    InvalidParameter,
    /// Invalid structured value.
    InvalidStructuredValue,
    /// Invalid date or time.
    InvalidDateTime,
    /// Unsupported vCard version.
    UnsupportedVersion,
    /// Encoding error.
    EncodingError,
}

impl fmt::Display for ParseErrorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnexpectedEof => write!(f, "unexpected end of input"),
            Self::UnexpectedToken => write!(f, "unexpected token"),
            Self::InvalidValue => write!(f, "invalid value"),
            Self::MissingProperty => write!(f, "missing property"),
            Self::InvalidPropertyName => write!(f, "invalid property name"),
            Self::InvalidParameter => write!(f, "invalid parameter"),
            Self::InvalidStructuredValue => write!(f, "invalid structured value"),
            Self::InvalidDateTime => write!(f, "invalid date/time"),
            Self::UnsupportedVersion => write!(f, "unsupported version"),
            Self::EncodingError => write!(f, "encoding error"),
        }
    }
}
