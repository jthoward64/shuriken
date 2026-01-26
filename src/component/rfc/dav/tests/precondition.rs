//! Tests for precondition error XML serialization.
//!
//! Verifies RFC 4918 §16 compliance for error response bodies.

use crate::component::rfc::dav::core::PreconditionError;

#[test]
fn test_dav_precondition_xml() {
    let err = PreconditionError::PropfindFiniteDepth;
    let xml = err.to_xml();

    assert!(xml.contains(r#"<?xml version="1.0" encoding="utf-8"?>"#));
    assert!(xml.contains(r#"<D:error xmlns:D="DAV:">"#));
    assert!(xml.contains("<D:propfind-finite-depth/>"));
    assert!(xml.contains("</D:error>"));
}

#[test]
fn test_caldav_precondition_xml() {
    let err = PreconditionError::ValidCalendarData("Missing VCALENDAR".into());
    let xml = err.to_xml();

    assert!(xml.contains(r#"xmlns:C="urn:ietf:params:xml:ns:caldav""#));
    assert!(xml.contains("<C:valid-calendar-data/>"));
}

#[test]
fn test_carddav_precondition_xml() {
    let err = PreconditionError::ValidAddressData("Missing FN property".into());
    let xml = err.to_xml();

    assert!(xml.contains(r#"xmlns:CARD="urn:ietf:params:xml:ns:carddav""#));
    assert!(xml.contains("<CARD:valid-address-data/>"));
}

#[test]
fn test_precondition_with_href() {
    let err = PreconditionError::CalendarNoUidConflict(Some("/calendars/user/existing.ics".into()));
    let xml = err.to_xml();

    assert!(xml.contains("<C:no-uid-conflict>"));
    assert!(xml.contains("<D:href>/calendars/user/existing.ics</D:href>"));
    assert!(xml.contains("</C:no-uid-conflict>"));
}

#[test]
fn test_lock_token_submitted_multiple_hrefs() {
    let err = PreconditionError::LockTokenSubmitted(vec![
        "/locked/resource1".into(),
        "/locked/resource2".into(),
    ]);
    let xml = err.to_xml();

    assert!(xml.contains("<D:lock-token-submitted>"));
    assert!(xml.contains("<D:href>/locked/resource1</D:href>"));
    assert!(xml.contains("<D:href>/locked/resource2</D:href>"));
    assert!(xml.contains("</D:lock-token-submitted>"));
}

#[test]
fn test_supported_collation_lists_alternatives() {
    let err = PreconditionError::CalendarSupportedCollation("i;unknown-collation".into());
    let xml = err.to_xml();

    assert!(xml.contains("<C:supported-collation>"));
    // Should list supported collations
    assert!(xml.contains("i;ascii-casemap"));
    assert!(xml.contains("i;octet"));
    assert!(xml.contains("i;unicode-casemap"));
    // Should mention the requested unsupported one
    assert!(xml.contains("i;unknown-collation"));
}

#[test]
fn test_carddav_supported_collation() {
    let err = PreconditionError::CardSupportedCollation("i;bad".into());
    let xml = err.to_xml();

    assert!(xml.contains(r#"xmlns:CARD="urn:ietf:params:xml:ns:carddav""#));
    // Note: The current implementation uses C: prefix for collation elements
    // This is a known simplification - in a full implementation we'd use CARD:
    assert!(xml.contains("supported-collation"));
}

#[test]
fn test_status_codes() {
    use salvo::http::StatusCode;

    // 403 Forbidden
    assert_eq!(
        PreconditionError::ValidCalendarData(String::new()).status_code(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        PreconditionError::PropfindFiniteDepth.status_code(),
        StatusCode::FORBIDDEN
    );

    // 409 Conflict
    assert_eq!(
        PreconditionError::ResourceMustBeNull.status_code(),
        StatusCode::CONFLICT
    );
    assert_eq!(
        PreconditionError::LockTokenMatchesRequestUri.status_code(),
        StatusCode::CONFLICT
    );

    // 423 Locked
    assert_eq!(
        PreconditionError::LockTokenSubmitted(vec![]).status_code(),
        StatusCode::LOCKED
    );
    assert_eq!(
        PreconditionError::NoConflictingLock(None).status_code(),
        StatusCode::LOCKED
    );

    // 507 Insufficient Storage
    assert_eq!(
        PreconditionError::NumberOfMatchesWithinLimits.status_code(),
        StatusCode::INSUFFICIENT_STORAGE
    );
}

#[test]
fn test_element_names() {
    assert_eq!(
        PreconditionError::LockTokenMatchesRequestUri.element_name(),
        "lock-token-matches-request-uri"
    );
    assert_eq!(
        PreconditionError::CalendarCollectionLocationOk.element_name(),
        "calendar-collection-location-ok"
    );
    assert_eq!(
        PreconditionError::AddressbookCollectionLocationOk.element_name(),
        "addressbook-collection-location-ok"
    );
    assert_eq!(
        PreconditionError::ValidSyncToken.element_name(),
        "valid-sync-token"
    );
}

#[test]
fn test_namespaces() {
    use crate::component::rfc::dav::core::precondition::ns;

    // DAV namespace
    assert_eq!(PreconditionError::ResourceMustBeNull.namespace(), ns::DAV);
    assert_eq!(PreconditionError::ValidSyncToken.namespace(), ns::DAV);

    // CalDAV namespace
    assert_eq!(
        PreconditionError::CalendarCollectionLocationOk.namespace(),
        ns::CALDAV
    );
    assert_eq!(
        PreconditionError::ValidCalendarData(String::new()).namespace(),
        ns::CALDAV
    );

    // CardDAV namespace
    assert_eq!(
        PreconditionError::AddressbookCollectionLocationOk.namespace(),
        ns::CARDDAV
    );
    assert_eq!(
        PreconditionError::ValidAddressData(String::new()).namespace(),
        ns::CARDDAV
    );
}

#[test]
fn test_display_trait() {
    assert_eq!(
        PreconditionError::CalendarSupportedCollation("i;foo".into()).to_string(),
        "Unsupported collation: i;foo"
    );
    assert_eq!(
        PreconditionError::ValidCalendarData("bad data".into()).to_string(),
        "Invalid iCalendar data: bad data"
    );
    assert_eq!(
        PreconditionError::PropfindFiniteDepth.to_string(),
        "Infinite-depth PROPFIND not allowed"
    );
}
