//! Content line folding for iCalendar (RFC 5545 §3.1).

/// Maximum line length in octets (not including CRLF).
const MAX_LINE_OCTETS: usize = 75;

/// Folds a content line to comply with the 75-octet limit.
///
/// Lines are folded by inserting CRLF followed by a single space.
/// Care is taken not to split UTF-8 multi-byte sequences.
#[must_use]
pub fn fold_line(line: &str) -> String {
    let bytes = line.as_bytes();
    
    if bytes.len() <= MAX_LINE_OCTETS {
        return format!("{line}\r\n");
    }

    let mut result = String::with_capacity(bytes.len() + (bytes.len() / MAX_LINE_OCTETS) * 3);
    let mut pos = 0;
    let mut first_line = true;

    while pos < bytes.len() {
        // Continuation lines have one less character available (the leading space)
        let max_len = if first_line {
            MAX_LINE_OCTETS
        } else {
            MAX_LINE_OCTETS - 1
        };

        let remaining = bytes.len() - pos;
        if remaining <= max_len {
            // Last segment
            if !first_line {
                result.push(' ');
            }
            result.push_str(&String::from_utf8_lossy(&bytes[pos..]));
            result.push_str("\r\n");
            break;
        }

        // Find a safe break point (not in the middle of a UTF-8 sequence)
        let mut end = pos + max_len;
        
        // Back up if we're in the middle of a UTF-8 character
        while end > pos && !is_char_boundary(bytes, end) {
            end -= 1;
        }

        if end == pos {
            // Pathological case: single character > max_len (shouldn't happen with valid UTF-8)
            // Just include the whole character
            end = pos + 1;
            while end < bytes.len() && !is_char_boundary(bytes, end) {
                end += 1;
            }
        }

        if !first_line {
            result.push(' ');
        }
        result.push_str(&String::from_utf8_lossy(&bytes[pos..end]));
        result.push_str("\r\n");

        pos = end;
        first_line = false;
    }

    result
}

/// Checks if the given position is a valid UTF-8 character boundary.
fn is_char_boundary(bytes: &[u8], pos: usize) -> bool {
    if pos >= bytes.len() {
        return true;
    }
    // UTF-8 continuation bytes start with 10xxxxxx
    (bytes[pos] & 0b1100_0000) != 0b1000_0000
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fold_short_line() {
        let line = "SUMMARY:Short";
        let result = fold_line(line);
        assert_eq!(result, "SUMMARY:Short\r\n");
    }

    #[test]
    fn fold_exactly_75() {
        // 75 characters exactly
        let line = "X".repeat(75);
        let result = fold_line(&line);
        assert_eq!(result, format!("{line}\r\n"));
    }

    #[test]
    fn fold_long_line() {
        // 150 characters
        let line = "X".repeat(150);
        let result = fold_line(&line);
        
        // Should have fold markers
        assert!(result.contains("\r\n "));
        
        // Unfold and verify content preserved
        let unfolded = result.replace("\r\n ", "").replace("\r\n", "");
        assert_eq!(unfolded, line);
    }

    #[test]
    fn fold_preserves_utf8() {
        // Create a line where naive splitting would break UTF-8
        // 日本語 is 3 bytes per character
        let prefix = "A".repeat(73);
        let line = format!("{prefix}日本語"); // 73 + 9 = 82 bytes
        
        let result = fold_line(&line);
        
        // Verify it can be unfolded to valid UTF-8
        let unfolded = result.replace("\r\n ", "").replace("\r\n", "");
        assert_eq!(unfolded, line);
        
        // Each line segment should be valid UTF-8
        for segment in result.split("\r\n") {
            if !segment.is_empty() {
                let trimmed = segment.strip_prefix(' ').unwrap_or(segment);
                assert!(std::str::from_utf8(trimmed.as_bytes()).is_ok());
            }
        }
    }

    #[test]
    fn fold_boundary_75_octets() {
        // First line should be exactly 75 bytes
        let line = "A".repeat(80);
        let result = fold_line(&line);
        
        let lines: Vec<&str> = result.split("\r\n").filter(|s| !s.is_empty()).collect();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].len(), 75);
        // Second line has leading space + remaining 5 chars
        assert_eq!(lines[1].len(), 6); // " " + 5 chars
    }
}
