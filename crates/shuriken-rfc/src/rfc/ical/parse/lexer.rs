//! Content line lexer for iCalendar (RFC 5545 §3.1).
//!
//! Handles line unfolding and tokenization of content lines.

use super::error::{ParseError, ParseErrorKind, ParseResult};
use crate::rfc::ical::core::{ContentLine, Parameter};

/// Unfolds content lines by removing CRLF sequences followed by whitespace.
///
/// Per RFC 5545 §3.1:
/// - Lines are folded by inserting CRLF followed by whitespace (SPACE or HTAB)
/// - Unfolding removes the CRLF and the single whitespace character
/// - Folding may split UTF-8 sequences, so unfold at byte level before decoding
///
/// This function also normalizes bare LF to CRLF for lenient parsing.
#[must_use]
pub fn unfold(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        // Check for CRLF or bare LF
        if bytes[i] == b'\r' && i + 1 < len && bytes[i + 1] == b'\n' {
            // CRLF
            if i + 2 < len && (bytes[i + 2] == b' ' || bytes[i + 2] == b'\t') {
                // Fold: skip CRLF and the whitespace
                i += 3;
            } else {
                // Not a fold, preserve the line ending
                result.push('\r');
                result.push('\n');
                i += 2;
            }
        } else if bytes[i] == b'\n' {
            // Bare LF (lenient)
            if i + 1 < len && (bytes[i + 1] == b' ' || bytes[i + 1] == b'\t') {
                // Fold: skip LF and the whitespace
                i += 2;
            } else {
                // Not a fold, normalize to CRLF
                result.push('\r');
                result.push('\n');
                i += 1;
            }
        } else {
            // Regular character
            result.push(bytes[i] as char);
            i += 1;
        }
    }

    result
}

/// Unfolds content lines while preserving a single space at fold boundaries.
///
/// Useful for lenient parsing where human-authored content expects a space
/// between folded segments (e.g., long summary text).
#[must_use]
#[expect(dead_code)]
pub fn unfold_with_space(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        if bytes[i] == b'\r' && i + 1 < len && bytes[i + 1] == b'\n' {
            if i + 2 < len && (bytes[i + 2] == b' ' || bytes[i + 2] == b'\t') {
                result.push(' ');
                i += 3;
            } else {
                result.push('\r');
                result.push('\n');
                i += 2;
            }
        } else if bytes[i] == b'\n' {
            if i + 1 < len && (bytes[i + 1] == b' ' || bytes[i + 1] == b'\t') {
                result.push(' ');
                i += 2;
            } else {
                result.push('\r');
                result.push('\n');
                i += 1;
            }
        } else {
            result.push(bytes[i] as char);
            i += 1;
        }
    }

    result
}

/// Splits input into content lines, merging folded continuations.
///
/// Handles both CRLF and bare LF line endings. Lines starting with SP/HTAB are
/// treated as continuations of the previous line. Per RFC 5545 §3.1, unfolding
/// removes the CRLF and the whitespace character (no space is inserted).
#[must_use]
pub fn split_lines(input: &str) -> Vec<(usize, String)> {
    let mut lines: Vec<(usize, String)> = Vec::new();

    for (i, raw_line) in input.lines().enumerate() {
        let line = raw_line.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }

        if line.starts_with([' ', '\t']) {
            // RFC 5545 §3.1: remove CRLF + single whitespace character
            // Both space and tab are handled the same way (skip first character)
            // Safety: starts_with check guarantees line is not empty
            let continuation = &line[1..];
            if let Some((_, prev)) = lines.last_mut() {
                // RFC 5545 §3.1: unfold by removing CRLF + whitespace (no space added)
                prev.push_str(continuation);
            } else {
                lines.push((i + 1, continuation.to_string()));
            }
        } else if !line.contains(':') {
            // Lenient: treat lines without a colon as folded continuations.
            if let Some((_, prev)) = lines.last_mut() {
                prev.push_str(line);
            } else {
                lines.push((i + 1, line.to_string()));
            }
        } else {
            lines.push((i + 1, line.to_string()));
        }
    }

    lines
}

/// Parses a single content line.
///
/// Format: `name *(";" param) ":" value`
///
/// ## Errors
/// Returns an error if the line is malformed or contains invalid characters.
pub fn parse_content_line(line: &str, line_num: usize) -> ParseResult<ContentLine> {
    let mut chars = line.char_indices().peekable();
    let mut name_end = 0;
    let mut colon_pos = None;

    // Find the property name (ends at ';' or ':')
    while let Some(&(i, c)) = chars.peek() {
        if c == ';' || c == ':' {
            name_end = i;
            if c == ':' {
                colon_pos = Some(i);
            }
            break;
        }
        // Validate property name character
        if !c.is_ascii_alphanumeric() && c != '-' {
            return Err(ParseError::new(
                ParseErrorKind::InvalidPropertyName,
                line_num,
                i + 1,
            ));
        }
        chars.next();
    }

    if name_end == 0 {
        return Err(ParseError::new(
            ParseErrorKind::MissingPropertyName,
            line_num,
            1,
        ));
    }

    let name = line[..name_end].to_ascii_uppercase();

    // Parse parameters if we stopped at ';'
    let mut params = Vec::new();
    if colon_pos.is_none() {
        chars.next(); // consume the ';'
        loop {
            let (param, next_is_colon) = parse_parameter(&mut chars, line, line_num)?;
            params.push(param);
            if next_is_colon {
                // Find the colon position
                colon_pos = chars.peek().map(|&(i, _)| i - 1);
                break;
            }
        }
    }

    // The colon should be found now
    let colon_pos = colon_pos
        .ok_or_else(|| ParseError::new(ParseErrorKind::MissingColon, line_num, line.len()))?;

    // Value is everything after the colon
    let value = &line[colon_pos + 1..];

    Ok(ContentLine {
        name,
        params,
        raw_value: value.to_string(),
    })
}

/// Parses a single parameter from the character stream.
///
/// Returns the parameter and whether the next character is ':'.
#[expect(clippy::too_many_lines)]
fn parse_parameter(
    chars: &mut std::iter::Peekable<std::str::CharIndices<'_>>,
    line: &str,
    line_num: usize,
) -> ParseResult<(Parameter, bool)> {
    let start = chars.peek().map_or(line.len(), |&(i, _)| i);

    // Parse parameter name (up to '=')
    let mut name_end = start;
    while let Some(&(i, c)) = chars.peek() {
        if c == '=' {
            name_end = i;
            chars.next(); // consume '='
            break;
        }
        if !c.is_ascii_alphanumeric() && c != '-' {
            return Err(ParseError::new(
                ParseErrorKind::InvalidParameter,
                line_num,
                i + 1,
            ));
        }
        chars.next();
    }

    if name_end == start {
        return Err(ParseError::new(
            ParseErrorKind::InvalidParameter,
            line_num,
            start + 1,
        ));
    }

    let param_name = line[start..name_end].to_ascii_uppercase();

    // Parse parameter values (comma-separated, may be quoted)
    let mut values = Vec::new();
    loop {
        let value = parse_param_value(chars, line, line_num)?;
        values.push(value);

        // Check what comes next
        match chars.peek() {
            Some(&(_, ',')) => {
                chars.next(); // consume ','
            }
            Some(&(_, ';')) => {
                chars.next(); // consume ';'
                return Ok((Parameter::with_values(param_name, values), false));
            }
            Some(&(_, ':')) => {
                chars.next(); // consume ':'
                return Ok((Parameter::with_values(param_name, values), true));
            }
            Some(&(i, c)) => {
                return Err(
                    ParseError::new(ParseErrorKind::InvalidParameter, line_num, i + 1)
                        .with_context(format!("unexpected character '{c}'")),
                );
            }
            None => {
                return Err(ParseError::new(
                    ParseErrorKind::MissingColon,
                    line_num,
                    line.len(),
                ));
            }
        }
    }
}

/// Parses a parameter value (possibly quoted).
#[expect(clippy::too_many_lines)]
fn parse_param_value(
    chars: &mut std::iter::Peekable<std::str::CharIndices<'_>>,
    line: &str,
    line_num: usize,
) -> ParseResult<String> {
    let Some(&(start, first)) = chars.peek() else {
        return Err(ParseError::new(
            ParseErrorKind::InvalidParameter,
            line_num,
            line.len(),
        ));
    };

    if first == '"' {
        // Quoted value
        chars.next(); // consume opening quote
        let mut value = String::new();
        let mut closed = false;

        while let Some((_i, c)) = chars.next() {
            if c == '"' {
                closed = true;
                break;
            }
            // Handle caret encoding (RFC 6868)
            if c == '^' {
                if let Some(&(_, next)) = chars.peek() {
                    match next {
                        '^' => {
                            value.push('^');
                            chars.next();
                        }
                        'n' => {
                            value.push('\n');
                            chars.next();
                        }
                        '\'' => {
                            value.push('"');
                            chars.next();
                        }
                        _ => {
                            // Invalid caret escape, preserve as-is
                            value.push('^');
                        }
                    }
                } else {
                    value.push('^');
                }
            } else {
                value.push(c);
            }
        }

        if !closed {
            return Err(ParseError::new(
                ParseErrorKind::UnclosedQuote,
                line_num,
                start + 1,
            ));
        }

        Ok(value)
    } else {
        // Unquoted value (ends at ',' ';' or ':')
        let mut end = start;
        while let Some(&(i, c)) = chars.peek() {
            if c == ',' || c == ';' || c == ':' {
                break;
            }
            end = i + c.len_utf8();
            chars.next();
        }
        Ok(line[start..end].to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unfold_simple() {
        let input = "DESCRIPTION:This is a long description\r\n that continues here";
        let result = unfold(input);
        assert_eq!(
            result,
            "DESCRIPTION:This is a long descriptionthat continues here"
        );
    }

    #[test]
    fn unfold_multiple() {
        let input = "DESCRIPTION:First\r\n Second\r\n Third";
        let result = unfold(input);
        assert_eq!(result, "DESCRIPTION:FirstSecondThird");
    }

    #[test]
    fn unfold_bare_lf() {
        let input = "DESCRIPTION:First\n Second";
        let result = unfold(input);
        assert_eq!(result, "DESCRIPTION:FirstSecond");
    }

    #[test]
    fn unfold_preserves_newlines() {
        let input = "LINE1:Value1\r\nLINE2:Value2\r\n";
        let result = unfold(input);
        assert_eq!(result, "LINE1:Value1\r\nLINE2:Value2\r\n");
    }

    #[test]
    fn parse_simple_line() {
        let line = "SUMMARY:Team Meeting";
        let result = parse_content_line(line, 1).unwrap();
        assert_eq!(result.name, "SUMMARY");
        assert!(result.params.is_empty());
        assert_eq!(result.raw_value, "Team Meeting");
    }

    #[test]
    fn parse_line_with_params() {
        let line = "DTSTART;TZID=America/New_York:20260123T120000";
        let result = parse_content_line(line, 1).unwrap();
        assert_eq!(result.name, "DTSTART");
        assert_eq!(result.params.len(), 1);
        assert_eq!(result.params[0].name, "TZID");
        assert_eq!(result.params[0].value(), Some("America/New_York"));
        assert_eq!(result.raw_value, "20260123T120000");
    }

    #[test]
    fn parse_line_with_quoted_param() {
        let line = "ATTENDEE;CN=\"Doe, Jane\":mailto:jane@example.com";
        let result = parse_content_line(line, 1).unwrap();
        assert_eq!(result.params[0].value(), Some("Doe, Jane"));
    }

    #[test]
    fn parse_line_with_multiple_param_values() {
        let line = "ATTENDEE;ROLE=REQ-PARTICIPANT,OPT-PARTICIPANT:mailto:test@example.com";
        let result = parse_content_line(line, 1).unwrap();
        assert_eq!(result.params[0].values.len(), 2);
        assert_eq!(result.params[0].values[0], "REQ-PARTICIPANT");
        assert_eq!(result.params[0].values[1], "OPT-PARTICIPANT");
    }

    #[test]
    fn parse_line_with_caret_encoding() {
        let line = "ATTENDEE;CN=\"Test^nName\":mailto:test@example.com";
        let result = parse_content_line(line, 1).unwrap();
        assert_eq!(result.params[0].value(), Some("Test\nName"));
    }

    #[test]
    fn parse_line_unclosed_quote() {
        let line = "ATTENDEE;CN=\"Unclosed:mailto:test@example.com";
        let result = parse_content_line(line, 1);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.kind, ParseErrorKind::UnclosedQuote);
    }

    #[test]
    fn parse_line_missing_colon() {
        let line = "INVALID";
        let result = parse_content_line(line, 1);
        assert!(result.is_err());
    }
}
