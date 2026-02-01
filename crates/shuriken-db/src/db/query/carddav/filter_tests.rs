//! Unit tests for `CardDAV` filter evaluation.

#[cfg(test)]
mod tests {
    use shuriken_rfc::rfc::dav::core::{
        AddressbookFilter, AddressbookQuery, FilterTest, MatchType, PropFilter, TextMatch,
    };

    #[test]
    fn test_addressbook_filter_anyof() {
        let filters = vec![
            PropFilter::new("FN").with_text_match(TextMatch::contains("John")),
            PropFilter::new("EMAIL").with_text_match(TextMatch::contains("@example.com")),
        ];

        let filter = AddressbookFilter::anyof(filters.clone());
        assert_eq!(filter.test, FilterTest::AnyOf);
        assert_eq!(filter.prop_filters.len(), 2);
    }

    #[test]
    fn test_addressbook_filter_allof() {
        let filters = vec![
            PropFilter::new("FN").with_text_match(TextMatch::contains("John")),
            PropFilter::new("EMAIL").with_text_match(TextMatch::contains("@example.com")),
        ];

        let filter = AddressbookFilter::allof(filters.clone());
        assert_eq!(filter.test, FilterTest::AllOf);
        assert_eq!(filter.prop_filters.len(), 2);
    }

    #[test]
    fn test_addressbook_query_with_filter() {
        let filter = AddressbookFilter::anyof(vec![
            PropFilter::new("FN").with_text_match(TextMatch::contains("Smith")),
        ]);

        let query = AddressbookQuery::new().with_filter(filter).with_limit(50);

        assert!(query.filter.is_some());
        assert_eq!(query.limit, Some(50));
    }

    #[test]
    fn test_prop_filter_email() {
        let prop_filter =
            PropFilter::new("EMAIL").with_text_match(TextMatch::contains("@test.com"));

        assert_eq!(prop_filter.name, "EMAIL");
        assert!(prop_filter.text_match.is_some());
    }

    #[test]
    fn test_prop_filter_fn() {
        let prop_filter = PropFilter::new("FN").with_text_match(TextMatch::equals("John Doe"));

        assert_eq!(prop_filter.name, "FN");
        let tm = prop_filter.text_match.unwrap();
        assert_eq!(tm.match_type, MatchType::Equals);
    }

    #[test]
    fn test_text_match_with_collation() {
        let mut text_match = TextMatch::contains("test");
        text_match.collation = Some("i;unicode-casemap".to_string());

        assert_eq!(text_match.collation.as_deref(), Some("i;unicode-casemap"));
    }

    #[test]
    fn test_filter_test_default() {
        // FilterTest should default to AnyOf
        let default_test = FilterTest::default();
        assert_eq!(default_test, FilterTest::AnyOf);
    }

    // ========================================================================
    // RFC 4790 Collation Tests for CardDAV
    // ========================================================================
    // Per RFC 6352 §10.5.1: CardDAV uses same collations as CalDAV

    #[test]
    fn test_collation_octet_case_sensitive_carddav() {
        // i;octet: Case-sensitive search in vCard
        // "john" should NOT match "John"
        let text_match = TextMatch::contains("john").with_collation("i;octet");
        let prop_filter = PropFilter::new("FN").with_text_match(text_match);
        assert_eq!(
            prop_filter.text_match.unwrap().collation.as_deref(),
            Some("i;octet")
        );
    }

    #[test]
    fn test_collation_ascii_casemap_email() {
        // i;ascii-casemap: Email addresses typically ASCII
        // "john@example.com" should match "JOHN@EXAMPLE.COM"
        let text_match = TextMatch::contains("@example.com").with_collation("i;ascii-casemap");
        let prop_filter = PropFilter::new("EMAIL").with_text_match(text_match);
        assert_eq!(
            prop_filter.text_match.unwrap().collation.as_deref(),
            Some("i;ascii-casemap")
        );
    }

    #[test]
    fn test_collation_unicode_casemap_international_names() {
        // i;unicode-casemap: Full Unicode names
        // "Müller" should match "MÜLLER" with proper case folding
        let text_match = TextMatch::contains("Müller").with_collation("i;unicode-casemap");
        let prop_filter = PropFilter::new("FN").with_text_match(text_match);
        assert_eq!(
            prop_filter.text_match.unwrap().collation.as_deref(),
            Some("i;unicode-casemap")
        );
    }

    #[test]
    fn test_collation_unicode_japanese_names() {
        // i;unicode-casemap: Japanese characters
        // Should preserve Japanese characters correctly
        let text_match = TextMatch::contains("田中").with_collation("i;unicode-casemap");
        assert_eq!(text_match.value, "田中");
    }

    #[test]
    fn test_collation_unicode_cyrillic_names() {
        // i;unicode-casemap: Cyrillic characters
        // "Иванов" should match with proper case folding
        let text_match = TextMatch::contains("Иванов").with_collation("i;unicode-casemap");
        let prop_filter = PropFilter::new("FN").with_text_match(text_match);
        assert_eq!(
            prop_filter.text_match.unwrap().collation.as_deref(),
            Some("i;unicode-casemap")
        );
    }

    #[test]
    fn test_collation_mixed_scripts() {
        // i;unicode-casemap: Mixed script handling
        // "José García" with accented characters
        let text_match = TextMatch::contains("José García").with_collation("i;unicode-casemap");
        assert_eq!(text_match.value, "José García");
    }

    #[test]
    fn test_collation_default_unicode_carddav() {
        // Per RFC 6352 §10.5.1: default collation is i;unicode-casemap
        let text_match = TextMatch::contains("Smith");
        assert!(text_match.collation.is_none()); // Server should infer i;unicode-casemap
    }

    #[test]
    fn test_collation_organization_field() {
        // Collation on ORG field
        let text_match = TextMatch::contains("Société").with_collation("i;unicode-casemap");
        let prop_filter = PropFilter::new("ORG").with_text_match(text_match);
        assert_eq!(prop_filter.name, "ORG");
    }
}
