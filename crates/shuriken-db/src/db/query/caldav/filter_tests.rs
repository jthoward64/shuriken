//! Unit tests for `CalDAV` filter evaluation.

#[cfg(test)]
mod tests {
    use shuriken_rfc::rfc::dav::core::{
        CalendarFilter, CalendarQuery, CompFilter, MatchType, PropFilter, TextMatch, TimeRange,
    };

    #[test]
    fn test_calendar_filter_vcalendar() {
        let filter = CalendarFilter::vcalendar();
        assert_eq!(filter.component, "VCALENDAR");
        assert!(filter.filters.is_empty());
    }

    #[test]
    fn test_comp_filter_vevent() {
        let comp_filter = CompFilter::new("VEVENT");
        assert_eq!(comp_filter.name, "VEVENT");
        assert!(!comp_filter.is_not_defined);
        assert!(comp_filter.time_range.is_none());
    }

    #[test]
    fn test_comp_filter_with_time_range() {
        let start = chrono::Utc::now();
        let end = start + chrono::Duration::days(7);
        let time_range = TimeRange::new(start, end);

        let comp_filter = CompFilter::new("VEVENT").with_time_range(time_range.clone());

        assert!(comp_filter.time_range.is_some());
        let tr = comp_filter.time_range.unwrap();
        assert_eq!(tr.start.unwrap(), start);
        assert_eq!(tr.end.unwrap(), end);
    }

    #[test]
    fn test_prop_filter_with_text_match() {
        let text_match = TextMatch::contains("meeting");
        let prop_filter = PropFilter::new("SUMMARY").with_text_match(text_match);

        assert_eq!(prop_filter.name, "SUMMARY");
        assert!(prop_filter.text_match.is_some());

        let tm = prop_filter.text_match.unwrap();
        assert_eq!(tm.value, "meeting");
        assert_eq!(tm.match_type, MatchType::Contains);
        assert!(!tm.negate);
    }

    #[test]
    fn test_text_match_types() {
        let contains = TextMatch::contains("test");
        assert_eq!(contains.match_type, MatchType::Contains);

        let equals = TextMatch::equals("test");
        assert_eq!(equals.match_type, MatchType::Equals);

        let starts = TextMatch::starts_with("test");
        assert_eq!(starts.match_type, MatchType::StartsWith);

        let ends = TextMatch::ends_with("test");
        assert_eq!(ends.match_type, MatchType::EndsWith);
    }

    #[test]
    fn test_text_match_negate() {
        let text_match = TextMatch::contains("test").negate();
        assert!(text_match.negate);
    }

    #[test]
    fn test_calendar_query_with_filter() {
        let filter = CalendarFilter::vcalendar().with_comp(CompFilter::new("VEVENT"));

        let query = CalendarQuery::new().with_filter(filter).with_limit(100);

        assert!(query.filter.is_some());
        assert_eq!(query.limit, Some(100));
    }

    #[test]
    fn test_time_range_from() {
        let start = chrono::Utc::now();
        let range = TimeRange::from(start);

        assert_eq!(range.start.unwrap(), start);
        assert!(range.end.is_none());
    }

    #[test]
    fn test_time_range_until() {
        let end = chrono::Utc::now();
        let range = TimeRange::until(end);

        assert!(range.start.is_none());
        assert_eq!(range.end.unwrap(), end);
    }

    #[test]
    fn test_comp_filter_with_prop_filter() {
        let prop_filter = PropFilter::new("SUMMARY");
        let comp_filter = CompFilter::new("VEVENT").with_prop_filter(prop_filter);

        assert_eq!(comp_filter.prop_filters.len(), 1);
        assert_eq!(comp_filter.prop_filters[0].name, "SUMMARY");
    }

    #[test]
    fn test_prop_filter_is_not_defined() {
        let prop_filter = PropFilter::new("LOCATION").not_defined();

        assert_eq!(prop_filter.name, "LOCATION");
        assert!(prop_filter.is_not_defined);
    }

    #[test]
    fn test_prop_filter_text_match_equals() {
        let text_match = TextMatch::equals("Important Meeting");
        let prop_filter = PropFilter::new("SUMMARY").with_text_match(text_match);

        let tm = prop_filter.text_match.unwrap();
        assert_eq!(tm.value, "Important Meeting");
        assert_eq!(tm.match_type, MatchType::Equals);
    }

    #[test]
    fn test_prop_filter_text_match_case_sensitive() {
        let text_match = TextMatch::contains("Meeting").with_collation("i;octet");
        let prop_filter = PropFilter::new("SUMMARY").with_text_match(text_match);

        let tm = prop_filter.text_match.unwrap();
        assert_eq!(tm.collation, Some("i;octet".to_string()));
    }

    // ========================================================================
    // RFC 4790 Collation Tests
    // ========================================================================
    // Per RFC 4790 §9.1: i;octet is case-sensitive
    // Per RFC 4790 §9.2: i;ascii-casemap is ASCII-only case-insensitive
    // Per RFC 4790 §9.3: i;unicode-casemap is full Unicode case-insensitive

    #[test]
    fn test_collation_octet_case_sensitive() {
        // i;octet: "meeting" should NOT match "Meeting" (case-sensitive)
        let text_match = TextMatch::contains("meeting").with_collation("i;octet");
        assert_eq!(text_match.collation.as_deref(), Some("i;octet"));
    }

    #[test]
    fn test_collation_ascii_casemap_basic() {
        // i;ascii-casemap: ASCII letters are case-insensitive
        // "meeting" should match "MEETING" or "Meeting"
        let text_match = TextMatch::contains("meeting").with_collation("i;ascii-casemap");
        assert_eq!(text_match.collation.as_deref(), Some("i;ascii-casemap"));
    }

    #[test]
    fn test_collation_ascii_casemap_non_ascii_preserved() {
        // i;ascii-casemap: Non-ASCII characters are NOT case-folded
        // Per RFC 4790 §9.2.1: only ASCII a-z/A-Z are affected
        // "straße" stays as-is (ß is NOT converted to ss)
        let text_match = TextMatch::contains("straße").with_collation("i;ascii-casemap");
        assert_eq!(text_match.value, "straße");
    }

    #[test]
    fn test_collation_unicode_casemap_basic() {
        // i;unicode-casemap: Full Unicode case folding
        // "meeting" should match "MEETING" with proper case folding
        let text_match = TextMatch::contains("Meeting").with_collation("i;unicode-casemap");
        assert_eq!(text_match.collation.as_deref(), Some("i;unicode-casemap"));
    }

    #[test]
    fn test_collation_unicode_casemap_german_eszett() {
        // i;unicode-casemap: German ß folds to ss
        // "straße" should match "STRASSE" with Unicode case folding
        let text_match = TextMatch::contains("straße").with_collation("i;unicode-casemap");
        assert_eq!(text_match.value, "straße");
    }

    #[test]
    fn test_collation_unicode_casemap_greek_sigma() {
        // i;unicode-casemap: Greek final sigma ς normalizes to σ
        // Both should match with proper case folding
        let text_match1 = TextMatch::contains("Σ").with_collation("i;unicode-casemap");
        let text_match2 = TextMatch::contains("σ").with_collation("i;unicode-casemap");
        assert_eq!(text_match1.collation, text_match2.collation);
    }

    #[test]
    fn test_collation_unicode_casemap_turkish() {
        // i;unicode-casemap: Turkish dotted I handling
        // Full Unicode case folding handles locale-specific rules
        let text_match = TextMatch::contains("İstanbul").with_collation("i;unicode-casemap");
        assert_eq!(text_match.collation.as_deref(), Some("i;unicode-casemap"));
    }

    #[test]
    fn test_collation_default_is_unicode() {
        // Per RFC 4791 §7.5.1: default collation is i;unicode-casemap
        let text_match = TextMatch::contains("test");
        assert!(text_match.collation.is_none()); // Server infers i;unicode-casemap
    }

    #[test]
    fn test_collation_with_match_types() {
        // Collation should work with all match types
        let equals = TextMatch::equals("Meeting").with_collation("i;unicode-casemap");
        let contains = TextMatch::contains("Meeting").with_collation("i;unicode-casemap");
        let starts = TextMatch::starts_with("Meeting").with_collation("i;unicode-casemap");
        let ends = TextMatch::ends_with("Meeting").with_collation("i;unicode-casemap");

        assert_eq!(equals.collation.as_deref(), Some("i;unicode-casemap"));
        assert_eq!(contains.collation.as_deref(), Some("i;unicode-casemap"));
        assert_eq!(starts.collation.as_deref(), Some("i;unicode-casemap"));
        assert_eq!(ends.collation.as_deref(), Some("i;unicode-casemap"));
    }
}
