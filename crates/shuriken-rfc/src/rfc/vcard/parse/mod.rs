//! vCard parsing (RFC 6350).
//!
//! This module provides parsing functionality for vCard documents.
//!
//! ## Usage
//!
//! ```rust
//! use shuriken_rfc::rfc::vcard::parse;
//!
//! let input = "\
//! BEGIN:VCARD\r\n\
//! VERSION:4.0\r\n\
//! FN:John Doe\r\n\
//! EMAIL:john@example.com\r\n\
//! END:VCARD\r\n";
//!
//! let cards = parse::parse(input).unwrap();
//! assert_eq!(cards[0].formatted_name(), Some("John Doe"));
//! ```
//!
//! ## Features
//!
//! - Supports vCard 3.0 and 4.0
//! - Handles line folding/unfolding
//! - Parses property groups (item1.TEL)
//! - Parses structured values (N, ADR, ORG)
//! - Parses partial/truncated dates
//! - RFC 6868 caret encoding for parameters

mod error;
mod lexer;
mod parser;
mod values;

#[cfg(test)]
mod error_tests;

pub use error::{ParseError, ParseErrorKind, ParseResult};
pub use lexer::{ContentLine, parse_content_line, split_lines, unfold};
pub use parser::{parse, parse_single};
pub use values::{
    parse_address, parse_date, parse_date_and_or_time, parse_gender, parse_organization,
    parse_structured_name, parse_time, parse_utc_offset, split_component, split_structured,
    unescape_text,
};
