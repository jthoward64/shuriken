//! vCard lexer for line unfolding and content line parsing.
//!
//! vCard uses the same folding/unfolding rules as iCalendar (RFC 5545 §3.1).

use super::error::{ParseError, ParseErrorKind, ParseResult};
use crate::rfc::vcard::core::VCardParameter;

/// Unfolds a vCard document by removing line continuations.
///
/// Line continuations are CRLF followed by a single space or tab.
/// Also handles bare LF for lenient parsing.
#[must_use]
pub fn unfold(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '\r' {
            if chars.peek() == Some(&'\n') {
                chars.next();
                // Check for continuation (space or tab)
                if matches!(chars.peek(), Some(' ' | '\t')) {
                    chars.next(); // Skip the whitespace, continue line
                } else {
                    result.push('\n'); // End of logical line
                }
            } else {
                result.push(c);
            }
        } else if c == '\n' {
            // Bare LF (lenient)
            if matches!(chars.peek(), Some(' ' | '\t')) {
                chars.next();
            } else {
                result.push('\n');
            }
        } else {
            result.push(c);
        }
    }

    result
}

/// Unfolds lines while preserving a single space at fold boundaries.
#[must_use]
pub fn unfold_with_space(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '\r' {
            if chars.peek() == Some(&'\n') {
                chars.next();
                if matches!(chars.peek(), Some(' ' | '\t')) {
                    chars.next();
                    result.push(' ');
                } else {
                    result.push('\n');
                }
            } else {
                result.push(c);
            }
        } else if c == '\n' {
            if matches!(chars.peek(), Some(' ' | '\t')) {
                chars.next();
                result.push(' ');
            } else {
                result.push('\n');
            }
        } else {
            result.push(c);
        }
    }

    result
}

/// Splits unfolded input into logical lines, merging folded continuations.
#[must_use]
pub fn split_lines(input: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();

    for line in input.lines() {
        if line.is_empty() {
            continue;
        }

        if line.starts_with([' ', '\t']) {
            let continuation = line.trim_start_matches([' ', '\t']);
            if let Some(prev) = lines.last_mut() {
                prev.push(' ');
                prev.push_str(continuation);
            } else {
                lines.push(continuation.to_string());
            }
        } else {
            lines.push(line.to_string());
        }
    }

    lines
}

/// A parsed content line before value interpretation.
#[derive(Debug, Clone)]
pub struct ContentLine {
    /// Property group (e.g., "item1" in "item1.TEL").
    pub group: Option<String>,
    /// Property name (uppercase).
    pub name: String,
    /// Parameters.
    pub params: Vec<VCardParameter>,
    /// Raw value string.
    pub value: String,
}

/// Parses a single content line into its components.
///
/// Format: `[group.]name[;param=value]*:value`
///
/// ## Errors
/// Returns an error if the line is malformed or missing the colon separator.
pub fn parse_content_line(line: &str, line_num: usize) -> ParseResult<ContentLine> {
    // Find the colon separating name/params from value
    let colon_pos = find_value_separator(line).ok_or_else(|| {
        ParseError::new(
            ParseErrorKind::InvalidPropertyName,
            line_num,
            "missing colon separator",
        )
    })?;

    let (name_params, value) = line.split_at(colon_pos);
    let value = &value[1..]; // Skip the colon

    // Parse group and name
    let (group, name_params) = parse_group(name_params);

    // Split name from parameters
    let (name, params_str) = if let Some(semi_pos) = name_params.find(';') {
        (&name_params[..semi_pos], Some(&name_params[semi_pos + 1..]))
    } else {
        (name_params, None)
    };

    // Validate property name
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(ParseError::new(
            ParseErrorKind::InvalidPropertyName,
            line_num,
            format!("invalid property name: {name}"),
        ));
    }

    // Parse parameters
    let params = if let Some(params_str) = params_str {
        parse_parameters(params_str, line_num)?
    } else {
        Vec::new()
    };

    Ok(ContentLine {
        group: group.map(String::from),
        name: name.to_ascii_uppercase(),
        params,
        value: value.to_string(),
    })
}

/// Finds the colon that separates name/params from value.
///
/// Must handle quoted parameter values that may contain colons.
fn find_value_separator(line: &str) -> Option<usize> {
    let mut in_quotes = false;

    for (i, c) in line.char_indices() {
        match c {
            '"' => in_quotes = !in_quotes,
            ':' if !in_quotes => return Some(i),
            _ => {}
        }
    }

    None
}

/// Parses optional group prefix.
fn parse_group(s: &str) -> (Option<&str>, &str) {
    if let Some(dot_pos) = s.find('.') {
        let potential_group = &s[..dot_pos];
        // Group must be alphanumeric + hyphen
        if !potential_group.is_empty()
            && potential_group
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-')
        {
            return (Some(potential_group), &s[dot_pos + 1..]);
        }
    }
    (None, s)
}

/// Parses parameter string into parameters.
fn parse_parameters(s: &str, line_num: usize) -> ParseResult<Vec<VCardParameter>> {
    let mut params = Vec::new();
    let mut remaining = s;

    while !remaining.is_empty() {
        let (param, rest) = parse_single_parameter(remaining, line_num)?;
        params.push(param);
        remaining = rest;
    }

    Ok(params)
}

/// Parses a single parameter and returns remaining string.
fn parse_single_parameter(s: &str, line_num: usize) -> ParseResult<(VCardParameter, &str)> {
    // Find parameter name
    let eq_pos = s.find('=').ok_or_else(|| {
        ParseError::new(
            ParseErrorKind::InvalidParameter,
            line_num,
            "missing = in parameter",
        )
    })?;

    let name = &s[..eq_pos];
    let after_eq = &s[eq_pos + 1..];

    // Parse value(s)
    let (values, remaining) = parse_param_values(after_eq);

    Ok((VCardParameter::multi(name, values), remaining))
}

/// Parses parameter values (comma-separated, possibly quoted).
#[expect(clippy::too_many_lines)]
fn parse_param_values(s: &str) -> (Vec<String>, &str) {
    let mut values = Vec::new();
    let mut chars = s.chars().peekable();
    let mut current_value = String::new();
    let mut in_quotes = false;
    let mut consumed = 0;

    while let Some(&c) = chars.peek() {
        consumed += c.len_utf8();

        match c {
            '"' => {
                chars.next();
                in_quotes = !in_quotes;
            }
            ',' if !in_quotes => {
                chars.next();
                values.push(std::mem::take(&mut current_value));
            }
            ';' if !in_quotes => {
                // Next parameter
                chars.next();
                if !current_value.is_empty() || !values.is_empty() {
                    values.push(current_value);
                }
                return (values, &s[consumed..]);
            }
            ':' if !in_quotes => {
                // End of all parameters (shouldn't happen in our parsing flow)
                if !current_value.is_empty() || !values.is_empty() {
                    values.push(current_value);
                }
                return (values, &s[consumed - 1..]);
            }
            '^' if !in_quotes => {
                // RFC 6868 caret encoding
                chars.next();
                if let Some(&next) = chars.peek() {
                    consumed += next.len_utf8();
                    chars.next();
                    match next {
                        'n' => current_value.push('\n'),
                        '\'' => current_value.push('"'),
                        '^' => current_value.push('^'),
                        _ => {
                            current_value.push('^');
                            current_value.push(next);
                        }
                    }
                } else {
                    current_value.push('^');
                }
            }
            _ => {
                chars.next();
                current_value.push(c);
            }
        }
    }

    // End of string
    if !current_value.is_empty() || !values.is_empty() {
        values.push(current_value);
    }

    (values, "")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unfold_crlf() {
        let input = "FN:John\r\n Doe";
        assert_eq!(unfold(input), "FN:JohnDoe");
    }

    #[test]
    fn unfold_bare_lf() {
        let input = "FN:John\n Doe";
        assert_eq!(unfold(input), "FN:JohnDoe");
    }

    #[test]
    fn unfold_tab() {
        let input = "FN:John\r\n\tDoe";
        assert_eq!(unfold(input), "FN:JohnDoe");
    }

    #[test]
    fn split_lines_filters_empty() {
        let input = "LINE1\n\nLINE2\n";
        let lines = split_lines(input);
        assert_eq!(lines, vec!["LINE1", "LINE2"]);
    }

    #[test]
    fn parse_simple_line() {
        let line = parse_content_line("FN:John Doe", 1).unwrap();
        assert!(line.group.is_none());
        assert_eq!(line.name, "FN");
        assert!(line.params.is_empty());
        assert_eq!(line.value, "John Doe");
    }

    #[test]
    fn parse_grouped_line() {
        let line = parse_content_line("item1.TEL:+1-555-555-5555", 1).unwrap();
        assert_eq!(line.group, Some("item1".to_string()));
        assert_eq!(line.name, "TEL");
    }

    #[test]
    fn parse_with_parameters() {
        let line = parse_content_line("TEL;TYPE=home,voice;PREF=1:+1-555-555-5555", 1).unwrap();
        assert_eq!(line.name, "TEL");
        assert_eq!(line.params.len(), 2);

        let type_param = &line.params[0];
        assert_eq!(type_param.name, "TYPE");
        assert_eq!(type_param.values, vec!["home", "voice"]);

        let pref_param = &line.params[1];
        assert_eq!(pref_param.name, "PREF");
        assert_eq!(pref_param.value(), Some("1"));
    }

    #[test]
    fn parse_quoted_param() {
        let line =
            parse_content_line("ADR;LABEL=\"123 Main St\\nAnytown\":;;123 Main St", 1).unwrap();
        assert_eq!(line.params.len(), 1);
    }

    #[test]
    fn parse_colon_in_value() {
        let line = parse_content_line("URL:https://example.com:8080/path", 1).unwrap();
        assert_eq!(line.value, "https://example.com:8080/path");
    }
}
