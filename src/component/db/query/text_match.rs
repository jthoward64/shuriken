//! Shared text-match evaluation for `CalDAV`/`CardDAV` filters.
//!
//! Provides RFC 4790 collation support and text matching utilities
//! used by both protocol implementations.

use icu::casemap::CaseMapper;

use crate::component::rfc::dav::core::PreconditionError;

/// Error type for collation operations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CollationError {
    /// The requested collation is not supported by the server.
    /// Per RFC 4791 §7.5.1, the server MUST respond with a
    /// `CALDAV:supported-collation` precondition error.
    UnsupportedCollation(String),
}

impl std::fmt::Display for CollationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnsupportedCollation(collation) => {
                write!(f, "unsupported collation: {collation}")
            }
        }
    }
}

impl std::error::Error for CollationError {}

impl CollationError {
    /// Converts this error to a `CalDAV` precondition error.
    ///
    /// Use this when the error occurred during `CalDAV` `calendar-query` processing.
    #[must_use]
    pub fn into_caldav_precondition(self) -> PreconditionError {
        match self {
            Self::UnsupportedCollation(collation) => {
                PreconditionError::CalendarSupportedCollation(collation)
            }
        }
    }

    /// Converts this error to a `CardDAV` precondition error.
    ///
    /// Use this when the error occurred during `CardDAV` `addressbook-query` processing.
    #[must_use]
    pub fn into_carddav_precondition(self) -> PreconditionError {
        match self {
            Self::UnsupportedCollation(collation) => {
                PreconditionError::CardSupportedCollation(collation)
            }
        }
    }
}

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
/// Unicode case folding per RFC 4790. For SQL compatibility with `UPPER()`, we
/// fold then uppercase. For `i;ascii-casemap`, uses simple uppercasing.
/// For `i;octet`, returns text as-is (case-sensitive).
///
/// Unicode case folding differs from simple lowercasing in important ways:
/// - German `ß` folds to `ss`
/// - Greek final sigma `ς` normalizes to `σ`
/// - Turkish dotted I is handled correctly
///
/// ## Errors
///
/// Returns [`CollationError::UnsupportedCollation`] if the requested collation
/// is not supported. Per RFC 4791 §7.5.1, the server MUST respond with a
/// `CALDAV:supported-collation` precondition error in this case.
pub fn normalize_for_sql_upper(
    text: &str,
    collation: Option<&String>,
) -> Result<CollationResult, CollationError> {
    match collation.map(std::string::String::as_str) {
        // i;octet means case-sensitive comparison
        Some("i;octet") => Ok(CollationResult {
            value: text.to_owned(),
            case_sensitive: true,
        }),
        // Use ICU case folding then uppercase for SQL UPPER() compatibility
        // Note: Full RFC 4790 compliance would require a pre-folded column in the DB
        Some("i;unicode-casemap") | None => {
            let folded = CaseMapper::new().fold_string(text);
            Ok(CollationResult {
                value: folded.to_uppercase(),
                case_sensitive: false,
            })
        }
        // ASCII casemap uses simple uppercasing
        Some("i;ascii-casemap") => Ok(CollationResult {
            value: text.to_uppercase(),
            case_sensitive: false,
        }),
        // Unsupported collation - return error per RFC 4791 §7.5.1
        Some(unsupported) => Err(CollationError::UnsupportedCollation(unsupported.to_owned())),
    }
}

/// ## Summary
/// Normalizes text based on collation using ICU case folding.
///
/// For `i;unicode-casemap` collation, uses ICU's `fold_string()` for proper
/// Unicode case folding per RFC 4790. This is suitable for ILIKE comparisons.
/// For `i;ascii-casemap`, uses simple lowercasing.
/// For `i;octet`, returns text as-is (case-sensitive).
///
/// ## Errors
///
/// Returns [`CollationError::UnsupportedCollation`] if the requested collation
/// is not supported. Per RFC 4791 §7.5.1, the server MUST respond with a
/// `CALDAV:supported-collation` precondition error in this case.
pub fn normalize_for_ilike(
    text: &str,
    collation: Option<&String>,
) -> Result<String, CollationError> {
    match collation.map(std::string::String::as_str) {
        // Use ICU case folding for proper Unicode collation
        Some("i;unicode-casemap") | None => Ok(CaseMapper::new().fold_string(text).into_owned()),
        // Simple ASCII lowercasing for ASCII-only comparison
        Some("i;ascii-casemap") => Ok(text.to_lowercase()),
        // Case-sensitive: return as-is
        Some("i;octet") => Ok(text.to_owned()),
        // Unsupported collation - return error per RFC 4791 §7.5.1
        Some(unsupported) => Err(CollationError::UnsupportedCollation(unsupported.to_owned())),
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
        let result = normalize_for_sql_upper("Straße", collation.as_ref()).unwrap();
        // German ß folds to ss, then uppercased to SS
        assert_eq!(result.value, "STRASSE");
        assert!(!result.case_sensitive);
    }

    #[test]
    fn test_normalize_for_sql_upper_greek_sigma() {
        let collation = Some("i;unicode-casemap".to_string());
        // Final sigma and regular sigma should normalize to same value
        let final_sigma = normalize_for_sql_upper("ς", collation.as_ref()).unwrap();
        let regular_sigma = normalize_for_sql_upper("σ", collation.as_ref()).unwrap();
        assert_eq!(final_sigma.value, regular_sigma.value);
    }

    #[test]
    fn test_normalize_for_sql_upper_octet() {
        let collation = Some("i;octet".to_string());
        let result = normalize_for_sql_upper("Hello World", collation.as_ref()).unwrap();
        // Preserved exactly, case-sensitive
        assert_eq!(result.value, "Hello World");
        assert!(result.case_sensitive);
    }

    #[test]
    fn test_normalize_for_sql_upper_unsupported() {
        let collation = Some("i;unknown-collation".to_string());
        let result = normalize_for_sql_upper("Hello", collation.as_ref());
        assert!(matches!(
            result,
            Err(CollationError::UnsupportedCollation(c)) if c == "i;unknown-collation"
        ));
    }

    #[test]
    fn test_normalize_for_ilike_unicode() {
        let collation = Some("i;unicode-casemap".to_string());
        let result = normalize_for_ilike("Straße", collation.as_ref()).unwrap();
        // German ß folds to ss (lowercase)
        assert_eq!(result, "strasse");
    }

    #[test]
    fn test_normalize_for_ilike_default() {
        // None should default to unicode-casemap
        let result = normalize_for_ilike("HELLO", None).unwrap();
        assert_eq!(result, "hello");
    }

    #[test]
    fn test_normalize_for_ilike_unsupported() {
        let collation = Some("i;custom-collation".to_string());
        let result = normalize_for_ilike("Hello", collation.as_ref());
        assert!(matches!(
            result,
            Err(CollationError::UnsupportedCollation(c)) if c == "i;custom-collation"
        ));
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
        assert_eq!(build_like_pattern("100%", &MatchType::Contains), "%100\\%%");
    }
}
