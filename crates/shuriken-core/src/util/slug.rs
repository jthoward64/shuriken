//! Slug generation utilities for human-readable resource identifiers.
//!
//! ## Summary
//! Generates stable, URL-safe slugs from resource names. Slugs are lowercase,
//! alphanumeric with hyphens, and don't change even if the resource name changes.

/// Generate a URL-safe slug from a name.
///
/// Converts to lowercase, replaces spaces and special characters with hyphens,
/// collapses multiple hyphens, and trims edge hyphens.
///
/// Examples:
/// - "My Calendar" -> "my-calendar"
/// - "John Doe's Contacts" -> "john-doe-s-contacts"
/// - "Email & Tasks" -> "email-tasks"
#[must_use]
pub fn generate_slug(name: &str) -> String {
    let slug = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    // If slug is a valid uuid, prepend "res-" to avoid conflicts
    if uuid::Uuid::parse_str(&slug).is_ok() {
        format!("res-{slug}")
    } else {
        slug
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_name() {
        assert_eq!(generate_slug("calendar"), "calendar");
    }

    #[test]
    fn test_with_spaces() {
        assert_eq!(generate_slug("My Calendar"), "my-calendar");
    }

    #[test]
    fn test_with_special_chars() {
        assert_eq!(generate_slug("John's Events"), "john-s-events");
    }

    #[test]
    fn test_multiple_spaces() {
        assert_eq!(generate_slug("My  Calendar"), "my-calendar");
    }

    #[test]
    fn test_leading_trailing() {
        assert_eq!(generate_slug("  calendar  "), "calendar");
    }

    #[test]
    fn test_complex() {
        assert_eq!(
            generate_slug("Work & Personal @ Home"),
            "work-personal-home"
        );
    }

    #[test]
    fn test_uuid_name() {
        let uuid_str = "550e8400-e29b-41d4-a716-446655440000";
        assert_eq!(generate_slug(uuid_str), format!("res-{uuid_str}"));
    }
}
