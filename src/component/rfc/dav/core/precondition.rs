//! `WebDAV`, `CalDAV`, and `CardDAV` precondition and postcondition codes.
//!
//! RFC 4918 §16 defines a mechanism for returning machine-readable error codes
//! via XML elements in error response bodies. This module provides a comprehensive
//! enum of all precondition/postcondition codes defined in:
//!
//! - RFC 4918 (`WebDAV`)
//! - RFC 4791 (`CalDAV`)
//! - RFC 6352 (`CardDAV`)
//! - RFC 5689 (Extended MKCOL)
//! - RFC 6578 (`WebDAV` Sync)
//! - RFC 6638 (`CalDAV` Scheduling)

use salvo::http::StatusCode;
use thiserror::Error;

/// Namespace constants for precondition XML elements.
pub mod ns {
    /// `DAV:` namespace URI.
    pub const DAV: &str = "DAV:";
    /// `CalDAV` namespace URI.
    pub const CALDAV: &str = "urn:ietf:params:xml:ns:caldav";
    /// `CardDAV` namespace URI.
    pub const CARDDAV: &str = "urn:ietf:params:xml:ns:carddav";
}

/// A `WebDAV`/`CalDAV`/`CardDAV` precondition or postcondition error.
///
/// Each variant corresponds to a specific precondition or postcondition code
/// defined in the relevant RFC. The error carries the appropriate HTTP status
/// code and can serialize to an RFC-compliant XML error body.
#[derive(Error, Debug, Clone, PartialEq, Eq)]
pub enum PreconditionError {
    // =========================================================================
    // RFC 4918 (WebDAV) Preconditions
    // =========================================================================
    /// `DAV:lock-token-matches-request-uri` (409 Conflict)
    ///
    /// The Lock-Token header does not identify a lock on the Request-URI.
    #[error("Lock token does not match request URI")]
    LockTokenMatchesRequestUri,

    /// `DAV:lock-token-submitted` (423 Locked)
    ///
    /// A lock token should have been submitted. Contains URLs of locked resources.
    #[error("Lock token required for locked resource(s)")]
    LockTokenSubmitted(Vec<String>),

    /// `DAV:no-conflicting-lock` (423 Locked)
    ///
    /// A LOCK request failed due to an existing conflicting lock.
    #[error("Conflicting lock exists")]
    NoConflictingLock(Option<String>),

    /// `DAV:no-external-entities` (403 Forbidden)
    ///
    /// The request body contains an external entity that the server rejects.
    #[error("External entities not allowed in request body")]
    NoExternalEntities,

    /// `DAV:preserved-live-properties` (409 Conflict)
    ///
    /// Server cannot maintain live properties with the same behavior at destination.
    #[error("Cannot preserve live properties at destination")]
    PreservedLiveProperties,

    /// `DAV:propfind-finite-depth` (403 Forbidden)
    ///
    /// Server does not allow infinite-depth PROPFIND on collections.
    #[error("Infinite-depth PROPFIND not allowed")]
    PropfindFiniteDepth,

    /// `DAV:cannot-modify-protected-property` (403 Forbidden)
    ///
    /// Client attempted to modify a protected property.
    #[error("Cannot modify protected property")]
    CannotModifyProtectedProperty,

    /// `DAV:resource-must-be-null` (409 Conflict)
    ///
    /// A resource must not exist at the Request-URI (e.g., for MKCOL/MKCALENDAR).
    #[error("Resource already exists at target URI")]
    ResourceMustBeNull,

    /// `DAV:needs-privilege` (403 Forbidden)
    ///
    /// The required privilege is not granted to the current user.
    #[error("Insufficient privileges")]
    NeedsPrivilege,

    /// `DAV:number-of-matches-within-limits` (507 Insufficient Storage)
    ///
    /// The result set exceeds server-defined limits.
    #[error("Result set exceeds server limits")]
    NumberOfMatchesWithinLimits,

    // =========================================================================
    // RFC 5689 (Extended MKCOL) Preconditions
    // =========================================================================
    /// `DAV:valid-resourcetype` (403 Forbidden)
    ///
    /// The server does not support the specified resourcetype.
    #[error("Unsupported resource type")]
    ValidResourcetype,

    // =========================================================================
    // RFC 6578 (WebDAV Sync) Preconditions
    // =========================================================================
    /// `DAV:valid-sync-token` (403 Forbidden)
    ///
    /// The sync-token is invalid or has been invalidated by the server.
    #[error("Invalid or expired sync token")]
    ValidSyncToken,

    /// `DAV:sync-traversal-supported` (403 Forbidden)
    ///
    /// Server is unwilling to report results for child collection in infinite sync.
    #[error("Sync traversal not supported for child collection")]
    SyncTraversalSupported,

    /// `DAV:supported-report` (403 Forbidden)
    ///
    /// The report is not supported on the target resource.
    #[error("Report not supported on this resource")]
    SupportedReport,

    // =========================================================================
    // RFC 4791 (CalDAV) Preconditions
    // =========================================================================
    /// `CALDAV:calendar-collection-location-ok` (403 Forbidden)
    ///
    /// The Request-URI does not identify a valid location for a calendar collection.
    #[error("Invalid location for calendar collection")]
    CalendarCollectionLocationOk,

    /// `CALDAV:valid-calendar-data` (403 Forbidden)
    ///
    /// The resource is not valid iCalendar data.
    #[error("Invalid iCalendar data: {0}")]
    ValidCalendarData(String),

    /// `CALDAV:valid-calendar-object-resource` (403 Forbidden)
    ///
    /// The resource does not obey CalDAV restrictions (e.g., multiple component types).
    #[error("Invalid calendar object resource: {0}")]
    ValidCalendarObjectResource(String),

    /// `CALDAV:supported-calendar-component` (403 Forbidden)
    ///
    /// The calendar component type is not supported in the target collection.
    #[error("Unsupported calendar component: {0}")]
    SupportedCalendarComponent(String),

    /// `CALDAV:supported-calendar-data` (403 Forbidden)
    ///
    /// The media type is not supported for calendar object resources.
    #[error("Unsupported calendar data format")]
    SupportedCalendarData,

    /// `CALDAV:no-uid-conflict` (403 Forbidden)
    ///
    /// A calendar object with the same UID already exists. Contains conflicting href.
    #[error("UID conflict with existing resource")]
    CalendarNoUidConflict(Option<String>),

    /// `CALDAV:max-resource-size` (403 Forbidden)
    ///
    /// The resource exceeds the maximum allowed size.
    #[error("Calendar resource exceeds maximum size")]
    CalendarMaxResourceSize,

    /// `CALDAV:min-date-time` (403 Forbidden)
    ///
    /// A date/time value is before the minimum allowed.
    #[error("Date/time before minimum allowed")]
    MinDateTime,

    /// `CALDAV:max-date-time` (403 Forbidden)
    ///
    /// A date/time value exceeds the maximum allowed.
    #[error("Date/time exceeds maximum allowed")]
    MaxDateTime,

    /// `CALDAV:max-instances` (403 Forbidden)
    ///
    /// The number of recurrence instances exceeds the maximum allowed.
    #[error("Too many recurrence instances")]
    MaxInstances,

    /// `CALDAV:max-attendees-per-instance` (403 Forbidden)
    ///
    /// The number of attendees exceeds the maximum allowed.
    #[error("Too many attendees per instance")]
    MaxAttendeesPerInstance,

    /// `CALDAV:supported-filter` (403 Forbidden)
    ///
    /// The filter uses unsupported components/properties/parameters.
    #[error("Unsupported filter element")]
    CalendarSupportedFilter,

    /// `CALDAV:supported-collation` (403 Forbidden)
    ///
    /// The specified collation is not supported. Contains the unsupported collation name.
    #[error("Unsupported collation: {0}")]
    CalendarSupportedCollation(String),

    /// `CALDAV:valid-timezone` (403 Forbidden)  
    ///
    /// The timezone data is not valid.
    #[error("Invalid timezone data")]
    ValidTimezone,

    // =========================================================================
    // RFC 6638 (CalDAV Scheduling) Preconditions
    // =========================================================================
    /// `CALDAV:unique-scheduling-object-resource` (403 Forbidden)
    ///
    /// A scheduling object with the same UID exists in another calendar.
    #[error("Scheduling object UID conflict")]
    UniqueSchedulingObjectResource(Option<String>),

    /// `CALDAV:same-organizer-in-all-components` (403 Forbidden)
    ///
    /// All components must have the same ORGANIZER value.
    #[error("Inconsistent organizer across components")]
    SameOrganizerInAllComponents,

    /// `CALDAV:allowed-organizer-scheduling-object-change` (403 Forbidden)
    ///
    /// The organizer's modification is not allowed.
    #[error("Organizer modification not allowed")]
    AllowedOrganizerSchedulingObjectChange,

    /// `CALDAV:allowed-attendee-scheduling-object-change` (403 Forbidden)
    ///
    /// The attendee's modification is not allowed.
    #[error("Attendee modification not allowed")]
    AllowedAttendeeSchedulingObjectChange,

    /// `CALDAV:valid-scheduling-message` (403 Forbidden)
    ///
    /// The scheduling message is not valid iTIP.
    #[error("Invalid scheduling message")]
    ValidSchedulingMessage,

    /// `CALDAV:valid-organizer` (403 Forbidden)
    ///
    /// The organizer is not valid for scheduling.
    #[error("Invalid organizer for scheduling")]
    ValidOrganizer,

    // =========================================================================
    // RFC 6352 (CardDAV) Preconditions
    // =========================================================================
    /// `CARDDAV:addressbook-collection-location-ok` (403 Forbidden)
    ///
    /// The Request-URI does not identify a valid location for an addressbook.
    #[error("Invalid location for addressbook collection")]
    AddressbookCollectionLocationOk,

    /// `CARDDAV:valid-address-data` (403 Forbidden)
    ///
    /// The resource is not valid vCard data.
    #[error("Invalid vCard data: {0}")]
    ValidAddressData(String),

    /// `CARDDAV:supported-address-data` (403 Forbidden)
    ///
    /// The media type is not supported for address object resources.
    #[error("Unsupported address data format")]
    SupportedAddressData,

    /// `CARDDAV:supported-address-data-conversion` (403 Forbidden)
    ///
    /// The server cannot convert to the requested address data format.
    #[error("Address data conversion not supported")]
    SupportedAddressDataConversion,

    /// `CARDDAV:no-uid-conflict` (403 Forbidden)
    ///
    /// A vCard with the same UID already exists. Contains conflicting href.
    #[error("UID conflict with existing vCard")]
    CardNoUidConflict(Option<String>),

    /// `CARDDAV:max-resource-size` (403 Forbidden)
    ///
    /// The resource exceeds the maximum allowed size.
    #[error("Address resource exceeds maximum size")]
    CardMaxResourceSize,

    /// `CARDDAV:supported-filter` (403 Forbidden)
    ///
    /// The filter uses unsupported properties/parameters.
    #[error("Unsupported filter element")]
    CardSupportedFilter,

    /// `CARDDAV:supported-collation` (403 Forbidden)
    ///
    /// The specified collation is not supported. Contains the unsupported collation name.
    #[error("Unsupported collation: {0}")]
    CardSupportedCollation(String),
}

impl PreconditionError {
    /// Returns the HTTP status code for this precondition error.
    #[must_use]
    pub fn status_code(&self) -> StatusCode {
        match self {
            // 403 Forbidden
            Self::NoExternalEntities
            | Self::PropfindFiniteDepth
            | Self::CannotModifyProtectedProperty
            | Self::NeedsPrivilege
            | Self::ValidResourcetype
            | Self::ValidSyncToken
            | Self::SyncTraversalSupported
            | Self::SupportedReport
            | Self::CalendarCollectionLocationOk
            | Self::ValidCalendarData(_)
            | Self::ValidCalendarObjectResource(_)
            | Self::SupportedCalendarComponent(_)
            | Self::SupportedCalendarData
            | Self::CalendarNoUidConflict(_)
            | Self::CalendarMaxResourceSize
            | Self::MinDateTime
            | Self::MaxDateTime
            | Self::MaxInstances
            | Self::MaxAttendeesPerInstance
            | Self::CalendarSupportedFilter
            | Self::CalendarSupportedCollation(_)
            | Self::ValidTimezone
            | Self::UniqueSchedulingObjectResource(_)
            | Self::SameOrganizerInAllComponents
            | Self::AllowedOrganizerSchedulingObjectChange
            | Self::AllowedAttendeeSchedulingObjectChange
            | Self::ValidSchedulingMessage
            | Self::ValidOrganizer
            | Self::AddressbookCollectionLocationOk
            | Self::ValidAddressData(_)
            | Self::SupportedAddressData
            | Self::SupportedAddressDataConversion
            | Self::CardNoUidConflict(_)
            | Self::CardMaxResourceSize
            | Self::CardSupportedFilter
            | Self::CardSupportedCollation(_) => StatusCode::FORBIDDEN,

            // 409 Conflict
            Self::LockTokenMatchesRequestUri
            | Self::PreservedLiveProperties
            | Self::ResourceMustBeNull => StatusCode::CONFLICT,

            // 423 Locked
            Self::LockTokenSubmitted(_) | Self::NoConflictingLock(_) => StatusCode::LOCKED,

            // 507 Insufficient Storage
            Self::NumberOfMatchesWithinLimits => StatusCode::INSUFFICIENT_STORAGE,
        }
    }

    /// Returns the XML element name for this precondition.
    #[must_use]
    pub fn element_name(&self) -> &'static str {
        match self {
            // DAV: namespace
            Self::LockTokenMatchesRequestUri => "lock-token-matches-request-uri",
            Self::LockTokenSubmitted(_) => "lock-token-submitted",
            Self::NoConflictingLock(_) => "no-conflicting-lock",
            Self::NoExternalEntities => "no-external-entities",
            Self::PreservedLiveProperties => "preserved-live-properties",
            Self::PropfindFiniteDepth => "propfind-finite-depth",
            Self::CannotModifyProtectedProperty => "cannot-modify-protected-property",
            Self::ResourceMustBeNull => "resource-must-be-null",
            Self::NeedsPrivilege => "needs-privilege",
            Self::NumberOfMatchesWithinLimits => "number-of-matches-within-limits",
            Self::ValidResourcetype => "valid-resourcetype",
            Self::ValidSyncToken => "valid-sync-token",
            Self::SyncTraversalSupported => "sync-traversal-supported",
            Self::SupportedReport => "supported-report",

            // CALDAV: namespace
            Self::CalendarCollectionLocationOk => "calendar-collection-location-ok",
            Self::ValidCalendarData(_) => "valid-calendar-data",
            Self::ValidCalendarObjectResource(_) => "valid-calendar-object-resource",
            Self::SupportedCalendarComponent(_) => "supported-calendar-component",
            Self::SupportedCalendarData => "supported-calendar-data",
            Self::CalendarNoUidConflict(_) => "no-uid-conflict",
            Self::CalendarMaxResourceSize => "max-resource-size",
            Self::MinDateTime => "min-date-time",
            Self::MaxDateTime => "max-date-time",
            Self::MaxInstances => "max-instances",
            Self::MaxAttendeesPerInstance => "max-attendees-per-instance",
            Self::CalendarSupportedFilter => "supported-filter",
            Self::CalendarSupportedCollation(_) => "supported-collation",
            Self::ValidTimezone => "valid-calendar-data",
            Self::UniqueSchedulingObjectResource(_) => "unique-scheduling-object-resource",
            Self::SameOrganizerInAllComponents => "same-organizer-in-all-components",
            Self::AllowedOrganizerSchedulingObjectChange => {
                "allowed-organizer-scheduling-object-change"
            }
            Self::AllowedAttendeeSchedulingObjectChange => {
                "allowed-attendee-scheduling-object-change"
            }
            Self::ValidSchedulingMessage => "valid-scheduling-message",
            Self::ValidOrganizer => "valid-organizer",

            // CARDDAV: namespace
            Self::AddressbookCollectionLocationOk => "addressbook-collection-location-ok",
            Self::ValidAddressData(_) => "valid-address-data",
            Self::SupportedAddressData => "supported-address-data",
            Self::SupportedAddressDataConversion => "supported-address-data-conversion",
            Self::CardNoUidConflict(_) => "no-uid-conflict",
            Self::CardMaxResourceSize => "max-resource-size",
            Self::CardSupportedFilter => "supported-filter",
            Self::CardSupportedCollation(_) => "supported-collation",
        }
    }

    /// Returns the XML namespace URI for this precondition element.
    #[must_use]
    pub fn namespace(&self) -> &'static str {
        match self {
            // DAV: namespace elements
            Self::LockTokenMatchesRequestUri
            | Self::LockTokenSubmitted(_)
            | Self::NoConflictingLock(_)
            | Self::NoExternalEntities
            | Self::PreservedLiveProperties
            | Self::PropfindFiniteDepth
            | Self::CannotModifyProtectedProperty
            | Self::ResourceMustBeNull
            | Self::NeedsPrivilege
            | Self::NumberOfMatchesWithinLimits
            | Self::ValidResourcetype
            | Self::ValidSyncToken
            | Self::SyncTraversalSupported
            | Self::SupportedReport => ns::DAV,

            // CalDAV namespace elements
            Self::CalendarCollectionLocationOk
            | Self::ValidCalendarData(_)
            | Self::ValidCalendarObjectResource(_)
            | Self::SupportedCalendarComponent(_)
            | Self::SupportedCalendarData
            | Self::CalendarNoUidConflict(_)
            | Self::CalendarMaxResourceSize
            | Self::MinDateTime
            | Self::MaxDateTime
            | Self::MaxInstances
            | Self::MaxAttendeesPerInstance
            | Self::CalendarSupportedFilter
            | Self::CalendarSupportedCollation(_)
            | Self::ValidTimezone
            | Self::UniqueSchedulingObjectResource(_)
            | Self::SameOrganizerInAllComponents
            | Self::AllowedOrganizerSchedulingObjectChange
            | Self::AllowedAttendeeSchedulingObjectChange
            | Self::ValidSchedulingMessage
            | Self::ValidOrganizer => ns::CALDAV,

            // CardDAV namespace elements
            Self::AddressbookCollectionLocationOk
            | Self::ValidAddressData(_)
            | Self::SupportedAddressData
            | Self::SupportedAddressDataConversion
            | Self::CardNoUidConflict(_)
            | Self::CardMaxResourceSize
            | Self::CardSupportedFilter
            | Self::CardSupportedCollation(_) => ns::CARDDAV,
        }
    }

    /// Returns the namespace prefix to use in XML serialization.
    #[must_use]
    pub fn namespace_prefix(&self) -> &'static str {
        match self.namespace() {
            ns::DAV => "D",
            ns::CALDAV => "C",
            ns::CARDDAV => "CARD",
            _ => "X",
        }
    }

    /// Serializes the precondition to an RFC 4918 §16 compliant XML error body.
    ///
    /// The format is:
    /// ```xml
    /// <?xml version="1.0" encoding="utf-8"?>
    /// <D:error xmlns:D="DAV:" xmlns:C="...">
    ///   <C:precondition-element>
    ///     <!-- optional child elements like href -->
    ///   </C:precondition-element>
    /// </D:error>
    /// ```
    #[must_use]
    pub fn to_xml(&self) -> String {
        let prefix = self.namespace_prefix();
        let element = self.element_name();

        // Build namespace declarations
        let mut ns_decls = String::from("xmlns:D=\"DAV:\"");
        if self.namespace() == ns::CALDAV {
            ns_decls.push_str(" xmlns:C=\"urn:ietf:params:xml:ns:caldav\"");
        } else if self.namespace() == ns::CARDDAV {
            ns_decls.push_str(" xmlns:CARD=\"urn:ietf:params:xml:ns:carddav\"");
        }

        // Build the inner content based on variant
        let inner = self.inner_xml();

        if inner.is_empty() {
            format!(
                "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<D:error {ns_decls}>\n  <{prefix}:{element}/>\n</D:error>"
            )
        } else {
            format!(
                "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<D:error {ns_decls}>\n  <{prefix}:{element}>\n    {inner}\n  </{prefix}:{element}>\n</D:error>"
            )
        }
    }

    /// Returns the inner XML content for variants that have child elements.
    fn inner_xml(&self) -> String {
        match self {
            Self::LockTokenSubmitted(hrefs) => hrefs
                .iter()
                .map(|h| format!("<D:href>{h}</D:href>"))
                .collect::<Vec<_>>()
                .join("\n    "),

            Self::NoConflictingLock(Some(href))
            | Self::CalendarNoUidConflict(Some(href))
            | Self::CardNoUidConflict(Some(href))
            | Self::UniqueSchedulingObjectResource(Some(href)) => {
                format!("<D:href>{href}</D:href>")
            }

            Self::CalendarSupportedCollation(collation)
            | Self::CardSupportedCollation(collation) => {
                // Return supported collations per RFC 4791 §7.5.1
                format!(
                    "<C:supported-collation>i;ascii-casemap</C:supported-collation>\n    \
                     <C:supported-collation>i;octet</C:supported-collation>\n    \
                     <C:supported-collation>i;unicode-casemap</C:supported-collation>\n    \
                     <!-- Requested: {collation} -->"
                )
            }

            _ => String::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_status_codes() {
        assert_eq!(
            PreconditionError::ValidCalendarData("test".into()).status_code(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            PreconditionError::ResourceMustBeNull.status_code(),
            StatusCode::CONFLICT
        );
        assert_eq!(
            PreconditionError::LockTokenSubmitted(vec![]).status_code(),
            StatusCode::LOCKED
        );
        assert_eq!(
            PreconditionError::NumberOfMatchesWithinLimits.status_code(),
            StatusCode::INSUFFICIENT_STORAGE
        );
    }

    #[test]
    fn test_element_names() {
        assert_eq!(
            PreconditionError::ValidCalendarData("test".into()).element_name(),
            "valid-calendar-data"
        );
        assert_eq!(
            PreconditionError::CalendarSupportedCollation("bad".into()).element_name(),
            "supported-collation"
        );
        assert_eq!(
            PreconditionError::CardNoUidConflict(None).element_name(),
            "no-uid-conflict"
        );
    }

    #[test]
    fn test_namespaces() {
        assert_eq!(PreconditionError::ResourceMustBeNull.namespace(), ns::DAV);
        assert_eq!(
            PreconditionError::ValidCalendarData("test".into()).namespace(),
            ns::CALDAV
        );
        assert_eq!(
            PreconditionError::ValidAddressData("test".into()).namespace(),
            ns::CARDDAV
        );
    }

    #[test]
    fn test_xml_empty_element() {
        let err = PreconditionError::PropfindFiniteDepth;
        let xml = err.to_xml();
        assert!(xml.contains("<D:propfind-finite-depth/>"));
        assert!(xml.contains("xmlns:D=\"DAV:\""));
    }

    #[test]
    fn test_xml_caldav_with_detail() {
        let err = PreconditionError::CalendarSupportedCollation("i;unknown".into());
        let xml = err.to_xml();
        assert!(xml.contains("xmlns:C=\"urn:ietf:params:xml:ns:caldav\""));
        assert!(xml.contains("<C:supported-collation>"));
        assert!(xml.contains("i;ascii-casemap"));
    }

    #[test]
    fn test_xml_with_href() {
        let err = PreconditionError::CalendarNoUidConflict(Some("/calendars/event.ics".into()));
        let xml = err.to_xml();
        assert!(xml.contains("<D:href>/calendars/event.ics</D:href>"));
    }

    #[test]
    fn test_xml_lock_token_submitted() {
        let err =
            PreconditionError::LockTokenSubmitted(vec!["/locked/a".into(), "/locked/b".into()]);
        let xml = err.to_xml();
        assert!(xml.contains("<D:href>/locked/a</D:href>"));
        assert!(xml.contains("<D:href>/locked/b</D:href>"));
    }

    #[test]
    fn test_display_trait() {
        let err = PreconditionError::CalendarSupportedCollation("i;unknown".into());
        assert_eq!(err.to_string(), "Unsupported collation: i;unknown");
    }
}
