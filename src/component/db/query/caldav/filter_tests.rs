//! Unit tests for `CalDAV` filter evaluation.

#[cfg(test)]
mod tests {
    use crate::component::rfc::dav::core::{
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
        let filter = CalendarFilter::vcalendar()
            .with_comp(CompFilter::new("VEVENT"));
        
        let query = CalendarQuery::new()
            .with_filter(filter)
            .with_limit(100);
        
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
}
