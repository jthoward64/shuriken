//! iCalendar text escaping utilities.

/// Escapes text for iCalendar TEXT values (RFC 5545 §3.3.11).
///
/// Escapes: backslash, comma, semicolon, and newlines.
#[must_use]
pub fn escape_text(s: &str) -> String {
    let mut result = String::with_capacity(s.len() + 10);
    for c in s.chars() {
        match c {
            '\\' => result.push_str("\\\\"),
            ',' => result.push_str("\\,"),
            ';' => result.push_str("\\;"),
            '\n' => result.push_str("\\n"),
            '\r' => {} // Skip CR, we'll add CRLF as \n
            _ => result.push(c),
        }
    }
    result
}

/// Escapes a parameter value if needed.
///
/// Returns the value quoted if it contains special characters.
#[must_use]
pub fn escape_param_value(s: &str) -> String {
    if needs_quoting(s) {
        // Use caret encoding for special chars inside quotes (RFC 6868)
        let mut result = String::with_capacity(s.len() + 10);
        result.push('"');
        for c in s.chars() {
            match c {
                '^' => result.push_str("^^"),
                '\n' => result.push_str("^n"),
                '"' => result.push_str("^'"),
                _ => result.push(c),
            }
        }
        result.push('"');
        result
    } else {
        s.to_string()
    }
}

/// Checks if a parameter value needs quoting.
fn needs_quoting(s: &str) -> bool {
    s.chars().any(|c| matches!(c, ':' | ';' | ',' | '"' | '\n'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escape_text_basic() {
        assert_eq!(escape_text("hello, world"), "hello\\, world");
        assert_eq!(escape_text("line1\nline2"), "line1\\nline2");
        assert_eq!(escape_text("back\\slash"), "back\\\\slash");
        assert_eq!(escape_text("semi;colon"), "semi\\;colon");
    }

    #[test]
    fn escape_param_value_simple() {
        assert_eq!(escape_param_value("Simple"), "Simple");
    }

    #[test]
    fn escape_param_value_quoted() {
        assert_eq!(escape_param_value("Doe, Jane"), "\"Doe, Jane\"");
        assert_eq!(escape_param_value("Has;semi"), "\"Has;semi\"");
    }

    #[test]
    fn escape_param_value_caret() {
        assert_eq!(escape_param_value("Line1\nLine2"), "\"Line1^nLine2\"");
        assert_eq!(escape_param_value("Has\"quote"), "\"Has^'quote\"");
    }
}
