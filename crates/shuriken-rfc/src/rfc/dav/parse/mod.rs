//! `WebDAV` XML parsing.
//!
//! This module provides parsing for `WebDAV` XML request bodies
//! using the `quick-xml` crate.

mod error;
mod mkcol;
pub mod propfind;
mod proppatch;
pub mod report;

#[cfg(test)]
mod error_tests;

pub use error::{ParseError, ParseResult};
pub use mkcol::{MkcolRequest, parse_mkcol};
pub use propfind::parse_propfind;
pub use proppatch::parse_proppatch;
pub use report::parse_report;

pub(crate) fn validate_numeric_char_refs(xml: &[u8]) -> ParseResult<()> {
    let mut i = 0;
    while i + 2 < xml.len() {
        if xml[i] == b'&' && xml[i + 1] == b'#' {
            let mut j = i + 2;
            let mut is_hex = false;
            if j < xml.len() && (xml[j] == b'x' || xml[j] == b'X') {
                is_hex = true;
                j += 1;
            }

            let start = j;
            while j < xml.len() && xml[j] != b';' {
                j += 1;
            }

            if j >= xml.len() {
                return Err(ParseError::invalid_value(
                    "unterminated numeric character reference",
                ));
            }

            let digits = std::str::from_utf8(&xml[start..j])?;
            if digits.is_empty() {
                return Err(ParseError::invalid_value(
                    "empty numeric character reference",
                ));
            }

            let value = if is_hex {
                u32::from_str_radix(digits, 16)
            } else {
                digits.parse::<u32>()
            }
            .map_err(|err| {
                tracing::warn!(error = ?err, value = %digits, "Invalid numeric character reference");
                ParseError::invalid_value("invalid numeric character reference")
            })?;

            if !is_valid_xml_char(value) {
                return Err(ParseError::invalid_value(
                    "invalid XML numeric character reference",
                ));
            }

            i = j + 1;
            continue;
        }
        i += 1;
    }

    Ok(())
}

#[must_use]
fn is_valid_xml_char(value: u32) -> bool {
    matches!(
        value,
        0x9 | 0xA | 0xD | 0x20..=0xD7FF | 0xE000..=0xFFFD | 0x0001_0000..=0x0010_FFFF
    )
}
