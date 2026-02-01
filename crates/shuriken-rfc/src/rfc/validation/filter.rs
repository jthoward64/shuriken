//! ## Summary
//! Filter validation for CalDAV and CardDAV queries.
//!
//! RFC 4791 §7.8 requires returning `supported-filter` precondition (403) when
//! a REPORT request uses unsupported components, properties, or parameters.
//!
//! This module provides validation to check if filters only reference
//! components, properties, and parameters the server supports.

use crate::rfc::dav::core::{CalendarFilter, CompFilter, PropFilter};

/// ## Summary
/// Result of filter validation.
///
/// Contains information about unsupported elements if validation fails.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FilterValidationResult {
    /// Filter is valid - all elements are supported
    Valid,
    /// Filter is invalid - contains unsupported component
    UnsupportedComponent(String),
    /// Filter is invalid - contains unsupported property
    UnsupportedProperty(String),
    /// Filter is invalid - contains unsupported parameter
    UnsupportedParameter(String),
}

impl FilterValidationResult {
    /// Returns true if filter is valid
    #[must_use]
    pub fn is_valid(&self) -> bool {
        matches!(self, Self::Valid)
    }

    /// Returns error message if invalid
    #[must_use]
    pub fn error_message(&self) -> Option<String> {
        match self {
            Self::Valid => None,
            Self::UnsupportedComponent(name) => {
                Some(format!("Unsupported component in filter: {name}"))
            }
            Self::UnsupportedProperty(name) => {
                Some(format!("Unsupported property in filter: {name}"))
            }
            Self::UnsupportedParameter(name) => {
                Some(format!("Unsupported parameter in filter: {name}"))
            }
        }
    }
}

/// ## Summary
/// Standard CalDAV components that support querying.
///
/// Per RFC 4791 §7.8, servers MUST support querying these standard components:
/// - VEVENT: Calendar events
/// - VTODO: Calendar tasks
/// - VJOURNAL: Journal entries
/// - VFREEBUSY: Free/busy data
/// - VAVAILABILITY: Availability information
/// - VTIMEZONE: Timezone definitions (typically parent context only)
///
/// Additionally, VCALENDAR is the root component for calendar queries.
const SUPPORTED_CALENDAR_COMPONENTS: &[&str] = &[
    "VCALENDAR", // Root container
    "VEVENT",    // Events (RFC 5545 §3.6.1)
    "VTODO",     // Tasks (RFC 5545 §3.6.2)
    "VJOURNAL",  // Journal entries (RFC 5545 §3.6.3)
    "VFREEBUSY", // Free/busy info (RFC 5545 §3.6.4)
    "VTIMEZONE", // Timezone definitions (RFC 5545 §3.6.5)
];

/// ## Summary
/// Standard CalDAV properties that support querying.
///
/// Per RFC 4791 §9.7.2, these properties can be filtered in queries.
/// This is a curated list of commonly filtered properties.
const SUPPORTED_CALENDAR_PROPERTIES: &[&str] = &[
    // Event/Task properties
    "UID",           // Unique identifier (RFC 5545)
    "DTSTART",       // Start date/time
    "DTEND",         // End date/time
    "DUE",           // Due date/time (for VTODO)
    "SUMMARY",       // Event/task summary
    "DESCRIPTION",   // Event/task description
    "LOCATION",      // Event location
    "CATEGORIES",    // Event categories
    "STATUS",        // Event/task status
    "CLASS",         // Confidentiality class (PUBLIC, PRIVATE, CONFIDENTIAL)
    "CREATED",       // Creation date
    "LAST-MODIFIED", // Last modification date
    "ATTENDEE",      // Attendee information
    "ORGANIZER",     // Event organizer
    "RRULE",         // Recurrence rule
    "RDATE",         // Recurrence date
    "EXDATE",        // Exception date
    "EXRULE",        // Exception rule
    "TRANSP",        // Transparency (OPAQUE, TRANSPARENT)
    "ATTACH",        // Attachment
    "RELATED-TO",    // Related to other components
    "COMMENT",       // Comments
    "CONTACT",       // Contact information
    "SEQUENCE",      // Sequence number
    "ALARM",         // Alarms/notifications
];

/// ## Summary
/// Standard CalDAV parameters that support querying.
///
/// Per RFC 4791 §9.7.3, these parameters can be filtered in queries.
const SUPPORTED_CALENDAR_PARAMETERS: &[&str] = &[
    "TZID",     // Timezone identifier
    "VALUE",    // Value type (DATE, DATE-TIME, etc.)
    "ROLE",     // Attendee role (REQ-PARTICIPANT, OPT-PARTICIPANT, etc.)
    "PARTSTAT", // Participant status (NEEDS-ACTION, ACCEPTED, DECLINED, etc.)
    "CN",       // Common name
    "EMAIL",    // Email address
    "RSVP",     // RSVP expected (TRUE, FALSE)
    "RELATED",  // Related to (PARENT, CHILD)
    "X-*",      // Custom parameters (any starting with X-)
];

/// ## Summary
/// Validates a CalDAV filter for supported components and properties.
///
/// Returns `Valid` if the filter only references supported components,
/// properties, and parameters. Returns specific error types for unsupported elements.
///
/// ## RFC References
/// - RFC 4791 §7.8: Calendar-query preconditions
/// - RFC 4791 §9.7: Filter syntax
#[must_use]
pub fn validate_calendar_filter(filter: &CalendarFilter) -> FilterValidationResult {
    // Validate root component (must be VCALENDAR)
    if !is_supported_component(&filter.component) {
        return FilterValidationResult::UnsupportedComponent(filter.component.clone());
    }

    // Validate nested comp-filters
    for comp_filter in &filter.filters {
        if let FilterValidationResult::Valid = validate_comp_filter(comp_filter, &filter.component)
        {
            // Component is valid, continue
        } else {
            // Return the error from comp_filter validation
            return validate_comp_filter(comp_filter, &filter.component);
        }
    }

    FilterValidationResult::Valid
}

/// ## Summary
/// Validates a component filter, including nested filters.
///
/// Checks that:
/// - Component name is supported
/// - Property filters reference supported properties
/// - Nested component filters are valid recursively
#[must_use]
fn validate_comp_filter(
    comp_filter: &CompFilter,
    _parent_component: &str,
) -> FilterValidationResult {
    // Validate component name is supported
    if !is_supported_component(&comp_filter.name) {
        return FilterValidationResult::UnsupportedComponent(comp_filter.name.clone());
    }

    // Validate nested property filters
    for prop_filter in &comp_filter.prop_filters {
        if let FilterValidationResult::Valid = validate_prop_filter(prop_filter) {
            // Property is valid, continue
        } else {
            // Return the error from prop_filter validation
            return validate_prop_filter(prop_filter);
        }
    }

    // Recursively validate nested component filters
    for nested_comp_filter in &comp_filter.comp_filters {
        if let FilterValidationResult::Valid =
            validate_comp_filter(nested_comp_filter, &comp_filter.name)
        {
            // Nested component is valid, continue
        } else {
            // Return the error from nested validation
            return validate_comp_filter(nested_comp_filter, &comp_filter.name);
        }
    }

    FilterValidationResult::Valid
}

/// ## Summary
/// Validates a property filter.
///
/// Checks that:
/// - Property name is supported
/// - Parameter filters reference supported parameters
#[must_use]
fn validate_prop_filter(prop_filter: &PropFilter) -> FilterValidationResult {
    // Validate property name is supported
    if !is_supported_property(&prop_filter.name) {
        return FilterValidationResult::UnsupportedProperty(prop_filter.name.clone());
    }

    // Validate parameter filters
    for param_filter in &prop_filter.param_filters {
        if !is_supported_parameter(&param_filter.name) {
            return FilterValidationResult::UnsupportedParameter(param_filter.name.clone());
        }
    }

    FilterValidationResult::Valid
}

/// ## Summary
/// Checks if a component name is supported.
///
/// Supports standard CalDAV components as defined in RFC 5545 and RFC 4791.
#[must_use]
fn is_supported_component(name: &str) -> bool {
    SUPPORTED_CALENDAR_COMPONENTS
        .iter()
        .any(|c| c.eq_ignore_ascii_case(name))
}

/// ## Summary
/// Checks if a property name is supported.
///
/// Supports standard CalDAV queryable properties.
#[must_use]
fn is_supported_property(name: &str) -> bool {
    SUPPORTED_CALENDAR_PROPERTIES
        .iter()
        .any(|p| p.eq_ignore_ascii_case(name))
}

/// ## Summary
/// Checks if a parameter name is supported.
///
/// Supports standard CalDAV queryable parameters, plus custom X-* parameters.
#[must_use]
fn is_supported_parameter(name: &str) -> bool {
    let name_upper = name.to_uppercase();

    // Check standard parameters
    if SUPPORTED_CALENDAR_PARAMETERS
        .iter()
        .any(|p| p.eq_ignore_ascii_case(name))
    {
        return true;
    }

    // Allow custom X-* parameters (vendor extensions)
    if name_upper.starts_with("X-") {
        return true;
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rfc::dav::core::ParamFilter;

    #[test]
    fn validate_empty_vcalendar_filter() {
        let filter = CalendarFilter::vcalendar();
        assert_eq!(
            validate_calendar_filter(&filter),
            FilterValidationResult::Valid
        );
    }

    #[test]
    fn validate_vevent_filter() {
        let mut filter = CalendarFilter::vcalendar();
        filter.filters.push(CompFilter::new("VEVENT"));
        assert_eq!(
            validate_calendar_filter(&filter),
            FilterValidationResult::Valid
        );
    }

    #[test]
    fn reject_unsupported_component() {
        let mut filter = CalendarFilter::vcalendar();
        filter.filters.push(CompFilter::new("VUNDEFINED")); // Not a real component
        match validate_calendar_filter(&filter) {
            FilterValidationResult::UnsupportedComponent(name) => {
                assert_eq!(name, "VUNDEFINED");
            }
            _ => panic!("Expected UnsupportedComponent error"),
        }
    }

    #[test]
    fn validate_supported_property() {
        let mut filter = CalendarFilter::vcalendar();
        let mut vevent = CompFilter::new("VEVENT");
        vevent.prop_filters.push(PropFilter::new("SUMMARY"));
        filter.filters.push(vevent);
        assert_eq!(
            validate_calendar_filter(&filter),
            FilterValidationResult::Valid
        );
    }

    #[test]
    fn reject_unsupported_property() {
        let mut filter = CalendarFilter::vcalendar();
        let mut vevent = CompFilter::new("VEVENT");
        vevent.prop_filters.push(PropFilter::new("NONEXISTENT"));
        filter.filters.push(vevent);
        match validate_calendar_filter(&filter) {
            FilterValidationResult::UnsupportedProperty(name) => {
                assert_eq!(name, "NONEXISTENT");
            }
            _ => panic!("Expected UnsupportedProperty error"),
        }
    }

    #[test]
    fn allow_custom_x_parameters() {
        let mut filter = CalendarFilter::vcalendar();
        let mut vevent = CompFilter::new("VEVENT");
        let mut summary_filter = PropFilter::new("SUMMARY");
        summary_filter.param_filters.push(ParamFilter {
            name: "X-CUSTOM-PARAM".to_string(),
            is_not_defined: false,
            text_match: None,
        });
        vevent.prop_filters.push(summary_filter);
        filter.filters.push(vevent);
        assert_eq!(
            validate_calendar_filter(&filter),
            FilterValidationResult::Valid
        );
    }
}
