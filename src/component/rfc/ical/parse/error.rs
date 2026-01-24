//! iCalendar parsing error types.

use std::fmt;

/// Result type for iCalendar parsing operations.
pub type ParseResult<T> = Result<T, ParseError>;

/// Error type for iCalendar parsing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    /// Kind of error.
    pub kind: ParseErrorKind,
    /// Line number where the error occurred (1-based).
    pub line: usize,
    /// Column number where the error occurred (1-based).
    pub column: usize,
    /// Additional context about the error.
    pub context: Option<String>,
}

impl ParseError {
    /// Creates a new parse error.
    #[must_use]
    pub fn new(kind: ParseErrorKind, line: usize, column: usize) -> Self {
        Self {
            kind,
            line,
            column,
            context: None,
        }
    }

    /// Adds context to this error.
    #[must_use]
    pub fn with_context(mut self, context: impl Into<String>) -> Self {
        self.context = Some(context.into());
        self
    }
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} at line {}, column {}", self.kind, self.line, self.column)?;
        if let Some(ref ctx) = self.context {
            write!(f, ": {ctx}")?;
        }
        Ok(())
    }
}

impl std::error::Error for ParseError {}

/// Kinds of parse errors.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParseErrorKind {
    /// Unexpected end of input.
    UnexpectedEof,
    /// Invalid content line format.
    InvalidContentLine,
    /// Missing property name.
    MissingPropertyName,
    /// Invalid property name character.
    InvalidPropertyName,
    /// Missing colon separator.
    MissingColon,
    /// Invalid parameter format.
    InvalidParameter,
    /// Unclosed quoted string.
    UnclosedQuote,
    /// Invalid escape sequence.
    InvalidEscape,
    /// Invalid date format.
    InvalidDate,
    /// Invalid time format.
    InvalidTime,
    /// Invalid date-time format.
    InvalidDateTime,
    /// Invalid duration format.
    InvalidDuration,
    /// Invalid recurrence rule.
    InvalidRRule,
    /// Invalid UTC offset format.
    InvalidUtcOffset,
    /// Missing BEGIN line.
    MissingBegin,
    /// Missing END line.
    MissingEnd,
    /// Mismatched BEGIN/END.
    MismatchedComponent,
    /// Invalid component nesting.
    InvalidNesting,
    /// Missing required property.
    MissingRequiredProperty,
    /// Invalid property value.
    InvalidValue,
    /// Invalid boolean value.
    InvalidBoolean,
    /// Invalid integer value.
    InvalidInteger,
    /// Invalid float value.
    InvalidFloat,
    /// Invalid period format.
    InvalidPeriod,
    /// Invalid frequency.
    InvalidFrequency,
    /// Invalid weekday.
    InvalidWeekday,
    /// UNTIL and COUNT are mutually exclusive.
    UntilCountConflict,
}

impl fmt::Display for ParseErrorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnexpectedEof => write!(f, "unexpected end of input"),
            Self::InvalidContentLine => write!(f, "invalid content line format"),
            Self::MissingPropertyName => write!(f, "missing property name"),
            Self::InvalidPropertyName => write!(f, "invalid property name"),
            Self::MissingColon => write!(f, "missing colon separator"),
            Self::InvalidParameter => write!(f, "invalid parameter format"),
            Self::UnclosedQuote => write!(f, "unclosed quoted string"),
            Self::InvalidEscape => write!(f, "invalid escape sequence"),
            Self::InvalidDate => write!(f, "invalid date format"),
            Self::InvalidTime => write!(f, "invalid time format"),
            Self::InvalidDateTime => write!(f, "invalid date-time format"),
            Self::InvalidDuration => write!(f, "invalid duration format"),
            Self::InvalidRRule => write!(f, "invalid recurrence rule"),
            Self::InvalidUtcOffset => write!(f, "invalid UTC offset format"),
            Self::MissingBegin => write!(f, "missing BEGIN line"),
            Self::MissingEnd => write!(f, "missing END line"),
            Self::MismatchedComponent => write!(f, "mismatched BEGIN/END"),
            Self::InvalidNesting => write!(f, "invalid component nesting"),
            Self::MissingRequiredProperty => write!(f, "missing required property"),
            Self::InvalidValue => write!(f, "invalid property value"),
            Self::InvalidBoolean => write!(f, "invalid boolean value"),
            Self::InvalidInteger => write!(f, "invalid integer value"),
            Self::InvalidFloat => write!(f, "invalid float value"),
            Self::InvalidPeriod => write!(f, "invalid period format"),
            Self::InvalidFrequency => write!(f, "invalid frequency"),
            Self::InvalidWeekday => write!(f, "invalid weekday"),
            Self::UntilCountConflict => write!(f, "UNTIL and COUNT are mutually exclusive"),
        }
    }
}

#[cfg(test)]
#[path = "error_tests.rs"]
mod tests;
