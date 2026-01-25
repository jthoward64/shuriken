//! REPORT request types for `CalDAV` and `CardDAV`.

use super::href::Href;
use super::property::PropertyName;

/// A REPORT request.
#[derive(Debug, Clone)]
pub struct ReportRequest {
    /// The type of report.
    pub report_type: ReportType,
    /// Properties to return.
    pub properties: Vec<PropertyName>,
}

impl ReportRequest {
    /// Creates a `calendar-query` report.
    #[must_use]
    pub fn calendar_query(query: CalendarQuery, properties: Vec<PropertyName>) -> Self {
        Self {
            report_type: ReportType::CalendarQuery(query),
            properties,
        }
    }

    /// Creates a `calendar-multiget` report.
    #[must_use]
    pub fn calendar_multiget(hrefs: Vec<Href>, properties: Vec<PropertyName>) -> Self {
        Self {
            report_type: ReportType::CalendarMultiget(CalendarMultiget { hrefs }),
            properties,
        }
    }

    /// Creates an `addressbook-query` report.
    #[must_use]
    pub fn addressbook_query(query: AddressbookQuery, properties: Vec<PropertyName>) -> Self {
        Self {
            report_type: ReportType::AddressbookQuery(query),
            properties,
        }
    }

    /// Creates an `addressbook-multiget` report.
    #[must_use]
    pub fn addressbook_multiget(hrefs: Vec<Href>, properties: Vec<PropertyName>) -> Self {
        Self {
            report_type: ReportType::AddressbookMultiget(AddressbookMultiget { hrefs }),
            properties,
        }
    }

    /// Creates a `sync-collection` report.
    #[must_use]
    pub fn sync_collection(sync: SyncCollection, properties: Vec<PropertyName>) -> Self {
        Self {
            report_type: ReportType::SyncCollection(sync),
            properties,
        }
    }
}

/// The type of REPORT.
#[derive(Debug, Clone)]
pub enum ReportType {
    /// `CalDAV` `calendar-query` (RFC 4791 §7.8).
    CalendarQuery(CalendarQuery),
    /// `CalDAV` `calendar-multiget` (RFC 4791 §7.9).
    CalendarMultiget(CalendarMultiget),
    /// `CalDAV` `free-busy-query` (RFC 4791 §7.10).
    FreeBusyQuery(FreeBusyQuery),
    /// `CardDAV` `addressbook-query` (RFC 6352 §8.6).
    AddressbookQuery(AddressbookQuery),
    /// `CardDAV` `addressbook-multiget` (RFC 6352 §8.7).
    AddressbookMultiget(AddressbookMultiget),
    /// `WebDAV` `sync-collection` (RFC 6578).
    SyncCollection(SyncCollection),
    /// `expand-property` report.
    ExpandProperty(ExpandProperty),
    /// Principal property search.
    PrincipalPropertySearch(PrincipalPropertySearch),
}

/// Recurrence expansion mode for calendar-query.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecurrenceExpansion {
    /// Return separate responses for each occurrence within the range.
    /// Removes RRULE properties from expanded instances.
    Expand,
    /// Limit occurrence generation to the range but return master event.
    /// Keeps RRULE properties.
    LimitRecurrenceSet,
}

/// `CalDAV` `calendar-query` filter.
#[derive(Debug, Clone, Default)]
pub struct CalendarQuery {
    /// Filter element.
    pub filter: Option<CalendarFilter>,
    /// Time range for expansion/limiting (with expansion mode).
    pub expand: Option<(TimeRange, RecurrenceExpansion)>,
    /// Limit results.
    pub limit: Option<u32>,
}

impl CalendarQuery {
    /// Creates an empty query.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the component filter.
    #[must_use]
    pub fn with_filter(mut self, filter: CalendarFilter) -> Self {
        self.filter = Some(filter);
        self
    }

    /// Sets the expand range.
    #[must_use]
    pub fn with_expand(mut self, range: TimeRange) -> Self {
        self.expand = Some((range, RecurrenceExpansion::Expand));
        self
    }

    /// Sets the limit-recurrence-set range.
    #[must_use]
    pub fn with_limit_recurrence_set(mut self, range: TimeRange) -> Self {
        self.expand = Some((range, RecurrenceExpansion::LimitRecurrenceSet));
        self
    }

    /// Sets the limit.
    #[must_use]
    pub fn with_limit(mut self, limit: u32) -> Self {
        self.limit = Some(limit);
        self
    }
}

/// `CalDAV` component filter.
#[derive(Debug, Clone)]
pub struct CalendarFilter {
    /// Component name to filter (VCALENDAR, VEVENT, VTODO, etc.).
    pub component: String,
    /// Nested filters.
    pub filters: Vec<CompFilter>,
    /// Time range filter.
    pub time_range: Option<TimeRange>,
}

impl CalendarFilter {
    /// Creates a filter for VCALENDAR.
    #[must_use]
    pub fn vcalendar() -> Self {
        Self {
            component: "VCALENDAR".to_string(),
            filters: Vec::new(),
            time_range: None,
        }
    }

    /// Adds a component filter (e.g., VEVENT).
    #[must_use]
    pub fn with_comp(mut self, filter: CompFilter) -> Self {
        self.filters.push(filter);
        self
    }
}

/// Component filter.
#[derive(Debug, Clone)]
pub struct CompFilter {
    /// Component name.
    pub name: String,
    /// Is-not-defined test.
    pub is_not_defined: bool,
    /// Time range filter.
    pub time_range: Option<TimeRange>,
    /// Property filters.
    pub prop_filters: Vec<PropFilter>,
    /// Nested component filters.
    pub comp_filters: Vec<CompFilter>,
}

impl CompFilter {
    /// Creates a filter for a component.
    #[must_use]
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            is_not_defined: false,
            time_range: None,
            prop_filters: Vec::new(),
            comp_filters: Vec::new(),
        }
    }

    /// Sets is-not-defined.
    #[must_use]
    pub fn not_defined(mut self) -> Self {
        self.is_not_defined = true;
        self
    }

    /// Sets time range.
    #[must_use]
    pub fn with_time_range(mut self, range: TimeRange) -> Self {
        self.time_range = Some(range);
        self
    }

    /// Adds a property filter.
    #[must_use]
    pub fn with_prop_filter(mut self, filter: PropFilter) -> Self {
        self.prop_filters.push(filter);
        self
    }
}

/// Property filter for queries.
#[derive(Debug, Clone)]
pub struct PropFilter {
    /// Property name.
    pub name: String,
    /// Is-not-defined test.
    pub is_not_defined: bool,
    /// Text match filter.
    pub text_match: Option<TextMatch>,
    /// Time range filter (for date properties).
    pub time_range: Option<TimeRange>,
    /// Parameter filters.
    pub param_filters: Vec<ParamFilter>,
}

impl PropFilter {
    /// Creates a property filter.
    #[must_use]
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            is_not_defined: false,
            text_match: None,
            time_range: None,
            param_filters: Vec::new(),
        }
    }

    /// Sets is-not-defined test.
    #[must_use]
    pub fn not_defined(mut self) -> Self {
        self.is_not_defined = true;
        self
    }

    /// Sets text match.
    #[must_use]
    pub fn with_text_match(mut self, match_: TextMatch) -> Self {
        self.text_match = Some(match_);
        self
    }
}

/// Parameter filter.
#[derive(Debug, Clone)]
pub struct ParamFilter {
    /// Parameter name.
    pub name: String,
    /// Is-not-defined test.
    pub is_not_defined: bool,
    /// Text match.
    pub text_match: Option<TextMatch>,
}

/// Text matching criteria.
#[derive(Debug, Clone)]
pub struct TextMatch {
    /// The text to match.
    pub value: String,
    /// Collation to use.
    pub collation: Option<String>,
    /// Match type.
    pub match_type: MatchType,
    /// Negate the match.
    pub negate: bool,
}

impl TextMatch {
    /// Creates a contains match.
    #[must_use]
    pub fn contains(value: impl Into<String>) -> Self {
        Self {
            value: value.into(),
            collation: None,
            match_type: MatchType::Contains,
            negate: false,
        }
    }

    /// Creates an equals match.
    #[must_use]
    pub fn equals(value: impl Into<String>) -> Self {
        Self {
            value: value.into(),
            collation: None,
            match_type: MatchType::Equals,
            negate: false,
        }
    }

    /// Creates a starts-with match.
    #[must_use]
    pub fn starts_with(value: impl Into<String>) -> Self {
        Self {
            value: value.into(),
            collation: None,
            match_type: MatchType::StartsWith,
            negate: false,
        }
    }

    /// Creates an ends-with match.
    #[must_use]
    pub fn ends_with(value: impl Into<String>) -> Self {
        Self {
            value: value.into(),
            collation: None,
            match_type: MatchType::EndsWith,
            negate: false,
        }
    }

    /// Negates the match.
    #[must_use]
    pub fn negate(mut self) -> Self {
        self.negate = true;
        self
    }

    /// Sets collation.
    #[must_use]
    pub fn with_collation(mut self, collation: impl Into<String>) -> Self {
        self.collation = Some(collation.into());
        self
    }
}

/// Match type for text matching.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum MatchType {
    /// Contains the text.
    #[default]
    Contains,
    /// Equals the text.
    Equals,
    /// Starts with the text.
    StartsWith,
    /// Ends with the text.
    EndsWith,
}

/// Time range for filtering.
#[derive(Debug, Clone)]
pub struct TimeRange {
    /// Start of range (inclusive).
    pub start: Option<chrono::DateTime<chrono::Utc>>,
    /// End of range (exclusive).
    pub end: Option<chrono::DateTime<chrono::Utc>>,
}

impl TimeRange {
    /// Creates a time range with start and end.
    #[must_use]
    pub fn new(start: chrono::DateTime<chrono::Utc>, end: chrono::DateTime<chrono::Utc>) -> Self {
        Self {
            start: Some(start),
            end: Some(end),
        }
    }

    /// Creates a range starting from a time.
    #[must_use]
    pub fn from(start: chrono::DateTime<chrono::Utc>) -> Self {
        Self {
            start: Some(start),
            end: None,
        }
    }

    /// Creates a range ending at a time.
    #[must_use]
    pub fn until(end: chrono::DateTime<chrono::Utc>) -> Self {
        Self {
            start: None,
            end: Some(end),
        }
    }
}

/// `CalDAV` multiget request.
#[derive(Debug, Clone)]
pub struct CalendarMultiget {
    /// Resource hrefs to retrieve.
    pub hrefs: Vec<Href>,
}

/// `CalDAV` free-busy query.
#[derive(Debug, Clone)]
pub struct FreeBusyQuery {
    /// Time range for free-busy.
    pub time_range: TimeRange,
}

/// `CardDAV` `addressbook-query` filter.
#[derive(Debug, Clone, Default)]
pub struct AddressbookQuery {
    /// Filter element.
    pub filter: Option<AddressbookFilter>,
    /// Limit results.
    pub limit: Option<u32>,
}

impl AddressbookQuery {
    /// Creates an empty query.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the filter.
    #[must_use]
    pub fn with_filter(mut self, filter: AddressbookFilter) -> Self {
        self.filter = Some(filter);
        self
    }

    /// Sets the limit.
    #[must_use]
    pub fn with_limit(mut self, limit: u32) -> Self {
        self.limit = Some(limit);
        self
    }
}

/// `CardDAV` addressbook filter.
#[derive(Debug, Clone)]
pub struct AddressbookFilter {
    /// Property filters.
    pub prop_filters: Vec<PropFilter>,
    /// Filter test (anyof/allof).
    pub test: FilterTest,
}

impl AddressbookFilter {
    /// Creates a new filter with anyof test.
    #[must_use]
    pub fn anyof(filters: Vec<PropFilter>) -> Self {
        Self {
            prop_filters: filters,
            test: FilterTest::AnyOf,
        }
    }

    /// Creates a new filter with allof test.
    #[must_use]
    pub fn allof(filters: Vec<PropFilter>) -> Self {
        Self {
            prop_filters: filters,
            test: FilterTest::AllOf,
        }
    }
}

/// Filter test type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum FilterTest {
    /// Any filter must match.
    #[default]
    AnyOf,
    /// All filters must match.
    AllOf,
}

/// `CardDAV` multiget request.
#[derive(Debug, Clone)]
pub struct AddressbookMultiget {
    /// Resource hrefs to retrieve.
    pub hrefs: Vec<Href>,
}

/// `Sync-collection` report (RFC 6578).
#[derive(Debug, Clone)]
pub struct SyncCollection {
    /// Sync token from previous sync (empty for initial).
    pub sync_token: String,
    /// Sync level.
    pub sync_level: SyncLevel,
    /// Limit on results.
    pub limit: Option<u32>,
}

impl SyncCollection {
    /// Creates an initial sync request.
    #[must_use]
    pub fn initial() -> Self {
        Self {
            sync_token: String::new(),
            sync_level: SyncLevel::One,
            limit: None,
        }
    }

    /// Creates a sync request with a token.
    #[must_use]
    pub fn with_token(token: impl Into<String>) -> Self {
        Self {
            sync_token: token.into(),
            sync_level: SyncLevel::One,
            limit: None,
        }
    }

    /// Sets the sync level.
    #[must_use]
    pub fn with_level(mut self, level: SyncLevel) -> Self {
        self.sync_level = level;
        self
    }

    /// Sets the limit.
    #[must_use]
    pub fn with_limit(mut self, limit: u32) -> Self {
        self.limit = Some(limit);
        self
    }
}

/// Sync level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SyncLevel {
    /// Sync level 1 (immediate children).
    #[default]
    One,
    /// Sync level infinity.
    Infinity,
}

/// Expand-property report.
#[derive(Debug, Clone)]
pub struct ExpandProperty {
    /// Properties to expand.
    pub properties: Vec<ExpandPropertyItem>,
}

/// A property to expand.
#[derive(Debug, Clone)]
pub struct ExpandPropertyItem {
    /// Property name.
    pub name: PropertyName,
    /// Nested properties to include.
    pub properties: Vec<ExpandPropertyItem>,
}

/// Principal property search.
#[derive(Debug, Clone)]
pub struct PrincipalPropertySearch {
    /// Property searches.
    pub property_searches: Vec<PropertySearch>,
    /// Properties to return.
    pub properties: Vec<PropertyName>,
    /// Apply to principal collection set.
    pub apply_to_principal_collection_set: bool,
}

/// A property search within principal-property-search.
#[derive(Debug, Clone)]
pub struct PropertySearch {
    /// Property to search.
    pub prop: PropertyName,
    /// Match criteria.
    pub match_: TextMatch,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calendar_query_with_filter() {
        let filter = CalendarFilter::vcalendar().with_comp(CompFilter::new("VEVENT"));

        let query = CalendarQuery::new().with_filter(filter);

        assert!(query.filter.is_some());
    }

    #[test]
    fn calendar_multiget() {
        let hrefs = vec![
            Href::new("/calendars/user/cal/event1.ics"),
            Href::new("/calendars/user/cal/event2.ics"),
        ];

        let report = ReportRequest::calendar_multiget(hrefs.clone(), Vec::new());

        match report.report_type {
            ReportType::CalendarMultiget(mg) => {
                assert_eq!(mg.hrefs.len(), 2);
            }
            _ => panic!("wrong report type"),
        }
    }

    #[test]
    fn sync_collection_initial() {
        let sync = SyncCollection::initial();
        assert!(sync.sync_token.is_empty());
    }

    #[test]
    fn text_match_contains() {
        let m = TextMatch::contains("test").negate();
        assert!(m.negate);
        assert_eq!(m.match_type, MatchType::Contains);
    }
}
