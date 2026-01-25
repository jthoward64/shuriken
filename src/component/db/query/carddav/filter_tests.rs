//! Unit tests for CardDAV filter evaluation.

#[cfg(test)]
mod tests {
    use crate::component::rfc::dav::core::{
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
        
        let query = AddressbookQuery::new()
            .with_filter(filter)
            .with_limit(50);
        
        assert!(query.filter.is_some());
        assert_eq!(query.limit, Some(50));
    }

    #[test]
    fn test_prop_filter_email() {
        let prop_filter = PropFilter::new("EMAIL")
            .with_text_match(TextMatch::contains("@test.com"));
        
        assert_eq!(prop_filter.name, "EMAIL");
        assert!(prop_filter.text_match.is_some());
    }

    #[test]
    fn test_prop_filter_fn() {
        let prop_filter = PropFilter::new("FN")
            .with_text_match(TextMatch::equals("John Doe"));
        
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
}
