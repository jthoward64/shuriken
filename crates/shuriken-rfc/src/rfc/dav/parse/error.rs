//! DAV XML parse error types.

use std::fmt;

/// Result type for DAV XML parsing.
pub type ParseResult<T> = Result<T, ParseError>;

/// An error that occurred during DAV XML parsing.
#[derive(Debug)]
pub struct ParseError {
    /// Error kind.
    pub kind: ParseErrorKind,
    /// Error message.
    pub message: String,
}

impl ParseError {
    /// Creates a new parse error.
    #[must_use]
    pub fn new(kind: ParseErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    /// Creates an XML error.
    #[must_use]
    pub fn xml(message: impl Into<String>) -> Self {
        Self::new(ParseErrorKind::XmlError, message)
    }

    /// Creates a missing element error.
    #[must_use]
    pub fn missing_element(name: &str) -> Self {
        Self::new(
            ParseErrorKind::MissingElement,
            format!("missing required element: {name}"),
        )
    }

    /// Creates an unexpected element error.
    #[must_use]
    pub fn unexpected_element(name: &str) -> Self {
        Self::new(
            ParseErrorKind::UnexpectedElement,
            format!("unexpected element: {name}"),
        )
    }

    /// Creates an invalid value error.
    #[must_use]
    pub fn invalid_value(message: impl Into<String>) -> Self {
        Self::new(ParseErrorKind::InvalidValue, message)
    }

    /// Creates a missing attribute error.
    #[must_use]
    pub fn missing_attribute(name: &str) -> Self {
        Self::new(
            ParseErrorKind::MissingAttribute,
            format!("missing required attribute: {name}"),
        )
    }

    /// Creates an unsupported namespace error.
    #[must_use]
    pub fn unsupported_namespace(ns: &str) -> Self {
        Self::new(
            ParseErrorKind::UnsupportedNamespace,
            format!("unsupported namespace: {ns}"),
        )
    }
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.kind, self.message)
    }
}

impl std::error::Error for ParseError {}

impl From<quick_xml::Error> for ParseError {
    fn from(err: quick_xml::Error) -> Self {
        Self::xml(err.to_string())
    }
}

impl From<quick_xml::events::attributes::AttrError> for ParseError {
    fn from(err: quick_xml::events::attributes::AttrError) -> Self {
        Self::xml(err.to_string())
    }
}

impl From<std::str::Utf8Error> for ParseError {
    fn from(err: std::str::Utf8Error) -> Self {
        Self::new(ParseErrorKind::EncodingError, err.to_string())
    }
}

impl From<quick_xml::encoding::EncodingError> for ParseError {
    fn from(err: quick_xml::encoding::EncodingError) -> Self {
        Self::new(ParseErrorKind::EncodingError, err.to_string())
    }
}

/// Parse error kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParseErrorKind {
    /// XML parsing error.
    XmlError,
    /// Missing required element.
    MissingElement,
    /// Unexpected element.
    UnexpectedElement,
    /// Invalid value.
    InvalidValue,
    /// Missing required attribute.
    MissingAttribute,
    /// Unsupported namespace.
    UnsupportedNamespace,
    /// Encoding error.
    EncodingError,
}

impl fmt::Display for ParseErrorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::XmlError => write!(f, "XML error"),
            Self::MissingElement => write!(f, "missing element"),
            Self::UnexpectedElement => write!(f, "unexpected element"),
            Self::InvalidValue => write!(f, "invalid value"),
            Self::MissingAttribute => write!(f, "missing attribute"),
            Self::UnsupportedNamespace => write!(f, "unsupported namespace"),
            Self::EncodingError => write!(f, "encoding error"),
        }
    }
}
