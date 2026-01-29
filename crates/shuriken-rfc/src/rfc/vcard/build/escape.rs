//! vCard text escaping.

/// Escapes a text value for vCard serialization.
///
/// Escapes backslash, newline, comma, and semicolon.
#[must_use]
pub fn escape_text(s: &str) -> String {
    let mut result = String::with_capacity(s.len());

    for c in s.chars() {
        match c {
            '\\' => result.push_str("\\\\"),
            '\n' => result.push_str("\\n"),
            ',' => result.push_str("\\,"),
            ';' => result.push_str("\\;"),
            '\r' => {} // Skip CR (use \n for newlines)
            _ => result.push(c),
        }
    }

    result
}

/// Escapes a parameter value for vCard serialization.
///
/// Uses RFC 6868 caret encoding for special characters.
/// Returns `(value, needs_quotes)`.
#[must_use]
pub fn escape_param_value(s: &str) -> (String, bool) {
    let mut result = String::with_capacity(s.len());
    let mut needs_quotes = false;

    for c in s.chars() {
        match c {
            '^' => result.push_str("^^"),
            '\n' => result.push_str("^n"),
            '"' => {
                result.push_str("^'");
                needs_quotes = true;
            }
            ':' | ';' | ',' => {
                result.push(c);
                needs_quotes = true;
            }
            _ if c.is_control() => {
                // Skip other control characters
            }
            _ => result.push(c),
        }
    }

    (result, needs_quotes)
}

/// Escapes a component of a structured value (comma-separated).
#[must_use]
pub fn escape_component(s: &str) -> String {
    let mut result = String::with_capacity(s.len());

    for c in s.chars() {
        match c {
            '\\' => result.push_str("\\\\"),
            '\n' => result.push_str("\\n"),
            ',' => result.push_str("\\,"),
            ';' => result.push_str("\\;"),
            '\r' => {}
            _ => result.push(c),
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escape_text_basic() {
        assert_eq!(escape_text("hello"), "hello");
    }

    #[test]
    fn escape_text_newline() {
        assert_eq!(escape_text("line1\nline2"), "line1\\nline2");
    }

    #[test]
    fn escape_text_special() {
        assert_eq!(escape_text("a,b;c\\d"), "a\\,b\\;c\\\\d");
    }

    #[test]
    fn escape_param_no_quotes() {
        let (val, needs_quotes) = escape_param_value("simple");
        assert_eq!(val, "simple");
        assert!(!needs_quotes);
    }

    #[test]
    fn escape_param_with_colon() {
        let (val, needs_quotes) = escape_param_value("value:with:colons");
        assert_eq!(val, "value:with:colons");
        assert!(needs_quotes);
    }

    #[test]
    fn escape_param_with_newline() {
        let (val, _) = escape_param_value("line1\nline2");
        assert_eq!(val, "line1^nline2");
    }

    #[test]
    fn escape_param_with_quote() {
        let (val, needs_quotes) = escape_param_value("say \"hello\"");
        assert_eq!(val, "say ^'hello^'");
        assert!(needs_quotes);
    }

    #[test]
    fn escape_param_with_caret() {
        let (val, _) = escape_param_value("a^b");
        assert_eq!(val, "a^^b");
    }
}
