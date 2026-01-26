//! Shared text-match evaluation for `CalDAV`/`CardDAV` filters.
//!
//! Provides RFC 4790 collation support and text matching utilities
//! used by both protocol implementations.

use icu::casemap::CaseMapper;

/// Result of normalizing text for collation.
pub struct CollationResult {
    /// The normalized text value.
    pub value: String,
    /// Whether the comparison should be case-sensitive.
    pub case_sensitive: bool,
}

/// ## Summary
/// Normalizes text based on collation using ICU case folding.
///
/// For `i;unicode-casemap` collation, uses ICU's `fold_string()` for proper
/// Unicode case folding per RFC 4790. For SQL compatibility with UPPER(), we
/// fold then uppercase. For `i;ascii-casemap`, uses simple uppercasing.
/// For `i;octet`, returns text as-is (case-sensitive).
///
/// Unicode case folding differs from simple lowercasing in important ways:
/// - German `ß` folds to `ss`
/// - Greek final sigma `ς` normalizes to `σ`
/// - Turkish dotted I is handled correctly
#[must_use]
pub fn normalize_for_sql_upper(text: &str, collation: Option<&String>) -> CollationResult {
    match collation.map(std::string::String::as_str) {
        // i;octet means case-sensitive comparison
        Some("i;octet") => CollationResult {
            value: text.to_owned(),
            case_sensitive: true,
        },
        // Use ICU case folding then uppercase for SQL UPPER() compatibility
        // Note: Full RFC 4790 compliance would require a pre-folded column in the DB
        Some("i;unicode-casemap") | None => {
            let folded = CaseMapper::new().fold_string(text);
            CollationResult {
                value: folded.to_uppercase(),
                case_sensitive: false,
            }
        }
        // ASCII casemap uses simple uppercasing
        Some("i;ascii-casemap") => CollationResult {
            value: text.to_uppercase(),
            case_sensitive: false,
        },
        // Unknown collation - treat as case-insensitive
        _ => CollationResult {
            value: text.to_uppercase(),
            case_sensitive: false,
        },
    }
}

/// ## Summary
/// Normalizes text based on collation using ICU case folding.
///
/// For `i;unicode-casemap` collation, uses ICU's `fold_string()` for proper
/// Unicode case folding per RFC 4790. This is suitable for ILIKE comparisons.
/// For `i;ascii-casemap`, uses simple lowercasing.
/// For `i;octet` or unknown collations, returns text as-is.
#[must_use]
pub fn normalize_for_ilike(text: &str, collation: Option<&String>) -> String {
    match collation.map(std::string::String::as_str) {
        // Use ICU case folding for proper Unicode collation
        Some("i;unicode-casemap") | None => CaseMapper::new().fold_string(text).into_owned(),
        // Simple ASCII lowercasing for ASCII-only comparison
        Some("i;ascii-casemap") => text.to_lowercase(),
        // Case-sensitive: return as-is
        _ => text.to_owned(),
    }
}

/// ## Summary
/// Escapes special SQL LIKE/ILIKE pattern characters.
///
/// Escapes `%`, `_`, and `\` so they match literally.
#[must_use]
pub fn escape_like_pattern(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '%' | '_' | '\\' => {
                result.push('\\');
                result.push(c);
            }
            _ => result.push(c),
        }
    }
    result
}

/// ## Summary
/// Builds a SQL LIKE pattern based on match type.
#[must_use]
pub fn build_like_pattern(
    value: &str,
    match_type: &crate::component::rfc::dav::core::MatchType,
) -> String {
    use crate::component::rfc::dav::core::MatchType;

    let escaped = escape_like_pattern(value);
    match match_type {
        MatchType::Contains => format!("%{escaped}%"),
        MatchType::Equals => escaped,
        MatchType::StartsWith => format!("{escaped}%"),
        MatchType::EndsWith => format!("%{escaped}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_for_sql_upper_unicode_casemap() {
        let collation = Some("i;unicode-casemap".to_string());
        let result = normalize_for_sql_upper("Straße", collation.as_ref());
        // German ß folds to ss, then uppercased to SS
        assert_eq!(result.value, "STRASSE");
        assert!(!result.case_sensitive);
    }

    #[test]
    fn test_normalize_for_sql_upper_greek_sigma() {
        let collation = Some("i;unicode-casemap".to_string());
        // Final sigma and regular sigma should normalize to same value
        let final_sigma = normalize_for_sql_upper("ς", collation.as_ref());
        let regular_sigma = normalize_for_sql_upper("σ", collation.as_ref());
        assert_eq!(final_sigma.value, regular_sigma.value);
    }

    #[test]
    fn test_normalize_for_sql_upper_octet() {
        let collation = Some("i;octet".to_string());
        let result = normalize_for_sql_upper("Hello World", collation.as_ref());
        // Preserved exactly, case-sensitive
        assert_eq!(result.value, "Hello World");
        assert!(result.case_sensitive);
    }

    #[test]
    fn test_normalize_for_ilike_unicode() {
        let collation = Some("i;unicode-casemap".to_string());
        let result = normalize_for_ilike("Straße", collation.as_ref());
        // German ß folds to ss (lowercase)
        assert_eq!(result, "strasse");
    }

    #[test]
    fn test_normalize_for_ilike_default() {
        // None should default to unicode-casemap
        let result = normalize_for_ilike("HELLO", None);
        assert_eq!(result, "hello");
    }

    #[test]
    fn test_escape_like_pattern() {
        assert_eq!(escape_like_pattern("100%"), "100\\%");
        assert_eq!(escape_like_pattern("test_value"), "test\\_value");
        assert_eq!(escape_like_pattern("a\\b"), "a\\\\b");
        assert_eq!(escape_like_pattern("normal"), "normal");
    }

    #[test]
    fn test_build_like_pattern() {
        use crate::component::rfc::dav::core::MatchType;

        assert_eq!(build_like_pattern("test", &MatchType::Contains), "%test%");
        assert_eq!(build_like_pattern("test", &MatchType::Equals), "test");
        assert_eq!(build_like_pattern("test", &MatchType::StartsWith), "test%");
        assert_eq!(build_like_pattern("test", &MatchType::EndsWith), "%test");

        // With special chars
        assert_eq!(
            build_like_pattern("100%", &MatchType::Contains),
            "%100\\%%"
        );
    }
}
