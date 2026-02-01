//! Shared text-match evaluation for `CalDAV`/`CardDAV` filters.
//!
//! Provides RFC 4790 collation support and text matching utilities
//! used by both protocol implementations.

use icu::casemap::CaseMapper;

use shuriken_rfc::rfc::dav::core::PreconditionError;

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
    /// The casemap mode implied by the collation.
    pub casemap: Casemap,
}

/// Supported casemap modes for text matching.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Casemap {
    /// Case-sensitive (i;octet).
    Octet,
    /// ASCII-only casemap (i;ascii-casemap).
    Ascii,
    /// Unicode casemap (i;unicode-casemap).
    Unicode,
}

impl Casemap {
    /// Converts a collation string to a Casemap enum.
    ///
    /// ## Errors
    /// Returns [`CollationError::UnsupportedCollation`] if the collation is unknown.
    pub fn from_collation(collation: Option<&String>) -> Result<Self, CollationError> {
        match collation.map(std::string::String::as_str) {
            Some("i;octet") => Ok(Self::Octet),
            Some("i;unicode-casemap") | None => Ok(Self::Unicode),
            Some("i;ascii-casemap") => Ok(Self::Ascii),
            Some(unsupported) => Err(CollationError::UnsupportedCollation(unsupported.to_owned())),
        }
    }

    /// Returns whether this casemap mode is case-sensitive.
    #[must_use]
    pub const fn is_case_sensitive(self) -> bool {
        matches!(self, Self::Octet)
    }
}

/// ## Summary
/// Normalizes text for comparison against casemap-specific stored columns.
///
/// For `i;unicode-casemap`, uses ICU case folding (lowercase) to align with
/// `unicode_casemap_nfc()` generated columns. For `i;ascii-casemap`, uses
/// ASCII-only lowercasing to align with `ascii_casemap()` generated columns.
/// For `i;octet`, returns text as-is and marks comparison as case-sensitive.
///
/// ## Errors
/// Returns [`CollationError::UnsupportedCollation`] if the collation is unknown.
pub fn normalize_for_folded_compare(
    text: &str,
    collation: Option<&String>,
) -> Result<CollationResult, CollationError> {
    match collation.map(std::string::String::as_str) {
        Some("i;octet") => Ok(CollationResult {
            value: text.to_owned(),
            case_sensitive: true,
            casemap: Casemap::Octet,
        }),
        Some("i;unicode-casemap") | None => Ok(CollationResult {
            value: CaseMapper::new().fold_string(text).into_owned(),
            case_sensitive: false,
            casemap: Casemap::Unicode,
        }),
        Some("i;ascii-casemap") => Ok(CollationResult {
            value: text.to_ascii_lowercase(),
            case_sensitive: false,
            casemap: Casemap::Ascii,
        }),
        Some(unsupported) => Err(CollationError::UnsupportedCollation(unsupported.to_owned())),
    }
}

/// ## Summary
/// Normalizes text based on collation using ICU case folding.
///
/// For `i;unicode-casemap` collation, uses ICU's `fold_string()` for proper
/// Unicode case folding per RFC 4790. For SQL compatibility with `UPPER()`, we
/// fold then uppercase. For `i;ascii-casemap`, uses ASCII-only uppercasing per
/// RFC 4790 §9.2.1 (only converts ASCII letters a-z to A-Z, leaves non-ASCII unchanged).
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
            casemap: Casemap::Octet,
        }),
        // Use ICU case folding then uppercase for SQL UPPER() compatibility
        // Note: Full RFC 4790 compliance would require a pre-folded column in the DB
        Some("i;unicode-casemap") | None => {
            let folded = CaseMapper::new().fold_string(text);
            Ok(CollationResult {
                value: folded.to_uppercase(),
                case_sensitive: false,
                casemap: Casemap::Unicode,
            })
        }
        // RFC 4790 §9.2.1: ASCII casemap converts ONLY ASCII letters (a-z) to uppercase
        // Non-ASCII characters MUST be left unchanged (e.g., ß stays as ß, not SS)
        Some("i;ascii-casemap") => Ok(CollationResult {
            value: text.to_ascii_uppercase(),
            case_sensitive: false,
            casemap: Casemap::Ascii,
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
/// For `i;ascii-casemap`, uses ASCII-only lowercasing per RFC 4790 §9.2.1
/// (only converts ASCII letters A-Z to a-z, leaves non-ASCII unchanged).
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
        // RFC 4790 §9.2.1: ASCII casemap converts ONLY ASCII letters (A-Z) to lowercase
        // Non-ASCII characters MUST be left unchanged (e.g., ß stays as ß, not ss)
        Some("i;ascii-casemap") => Ok(text.to_ascii_lowercase()),
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
    match_type: &shuriken_rfc::rfc::dav::core::MatchType,
) -> String {
    use shuriken_rfc::rfc::dav::core::MatchType;

    let escaped = escape_like_pattern(value);
    match match_type {
        MatchType::Contains => format!("%{escaped}%"),
        MatchType::Equals => escaped,
        MatchType::StartsWith => format!("{escaped}%"),
        MatchType::EndsWith => format!("%{escaped}"),
    }
}

/// ## Summary
/// Wraps a SQL string literal with the appropriate `PostgreSQL` normalization function.
///
/// Returns SQL like `unicode_casemap_nfc('value')` or `ascii_casemap('value')`.
/// For i;octet, returns the value as-is (no normalization function).
#[must_use]
pub fn wrap_with_normalization_function(sql_literal: &str, casemap: Casemap) -> String {
    match casemap {
        Casemap::Octet => sql_literal.to_owned(),
        Casemap::Unicode => format!("unicode_casemap_nfc({sql_literal})"),
        Casemap::Ascii => format!("ascii_casemap({sql_literal})"),
    }
}

/// ## Summary
/// Determines the fold column name for case-insensitive comparisons.
///
/// Returns `None` for i;octet (case-sensitive), or the appropriate fold column
/// for i;ascii-casemap and i;unicode-casemap.
#[must_use]
pub const fn get_fold_column(casemap: Casemap) -> Option<&'static str> {
    match casemap {
        Casemap::Octet => None,
        Casemap::Unicode => Some("value_text_unicode_fold"),
        Casemap::Ascii => Some("value_text_ascii_fold"),
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
        use shuriken_rfc::rfc::dav::core::MatchType;

        assert_eq!(build_like_pattern("test", &MatchType::Contains), "%test%");
        assert_eq!(build_like_pattern("test", &MatchType::Equals), "test");
        assert_eq!(build_like_pattern("test", &MatchType::StartsWith), "test%");
        assert_eq!(build_like_pattern("test", &MatchType::EndsWith), "%test");

        // With special chars
        assert_eq!(build_like_pattern("100%", &MatchType::Contains), "%100\\%%");
    }
}
