//! vCard line folding.

/// Maximum line length in octets (not characters) per RFC 6350.
const MAX_LINE_OCTETS: usize = 75;

/// Folds a line to the maximum length.
///
/// Lines longer than 75 octets are folded by inserting CRLF + space.
/// Folds at UTF-8 character boundaries.
#[must_use]
pub fn fold_line(line: &str) -> String {
    if line.len() <= MAX_LINE_OCTETS {
        return line.to_string();
    }

    let mut result = String::with_capacity(line.len() + line.len() / MAX_LINE_OCTETS * 3);
    let mut current_len = 0;
    let mut first_segment = true;

    for c in line.chars() {
        let char_len = c.len_utf8();

        // Account for continuation prefix on subsequent lines
        let effective_max = if first_segment {
            MAX_LINE_OCTETS
        } else {
            MAX_LINE_OCTETS - 1 // Account for the space prefix
        };

        if current_len + char_len > effective_max {
            result.push_str("\r\n ");
            current_len = 1; // The space
            first_segment = false;
        }

        result.push(c);
        current_len += char_len;
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_line_unchanged() {
        let line = "FN:John Doe";
        assert_eq!(fold_line(line), line);
    }

    #[test]
    fn fold_at_75_octets() {
        let line = "X".repeat(80);
        let folded = fold_line(&line);
        assert!(folded.contains("\r\n "));

        // First segment should be 75 chars
        let first_line: String = folded.chars().take_while(|&c| c != '\r').collect();
        assert_eq!(first_line.len(), 75);
    }

    #[test]
    fn fold_respects_utf8() {
        // 日 is 3 bytes in UTF-8
        let line = format!("NOTE:{}", "日".repeat(30)); // 5 + 90 bytes
        let folded = fold_line(&line);

        // Should not split a character
        for part in folded.split("\r\n ") {
            assert!(part.is_char_boundary(part.len()));
        }
    }

    #[test]
    fn fold_multiple_times() {
        let line = "X".repeat(200);
        let folded = fold_line(&line);

        // Count fold points
        let fold_count = folded.matches("\r\n ").count();
        assert!(fold_count >= 2);
    }
}
