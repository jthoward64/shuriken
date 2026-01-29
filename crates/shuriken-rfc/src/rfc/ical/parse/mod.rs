//! iCalendar parsing primitives (RFC 5545).
//!
//! This module provides parsers for iCalendar content:
//! - Lexer: Content line parsing with unfolding
//! - Values: Value type parsing (DATE, DATE-TIME, DURATION, etc.)
//! - Parser: Full document parsing into typed structures

mod error;
mod lexer;
mod parser;
mod values;

pub use error::{ParseError, ParseErrorKind, ParseResult};
pub use lexer::{parse_content_line, split_lines, unfold};
pub use parser::parse;
pub use values::{
    parse_boolean, parse_date, parse_datetime, parse_duration, parse_float, parse_integer,
    parse_period, parse_rrule, parse_time, parse_utc_offset, unescape_text,
};
