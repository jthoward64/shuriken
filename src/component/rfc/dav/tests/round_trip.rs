//! Round-trip tests for DAV XML parsing and serialization.
//!
//! These tests verify that multistatus responses can be serialized and maintain
//! structural integrity.

use crate::component::rfc::dav::build::serialize_multistatus;
use crate::component::rfc::dav::core::{
    DavProperty, Multistatus, Propstat, PropstatResponse, QName, Status,
};

/// Create a simple multistatus response for testing
fn create_test_multistatus() -> Multistatus {
    let mut ms = Multistatus::new();
    ms.add_response(PropstatResponse::ok(
        "/test/resource",
        vec![DavProperty::text(
            QName::dav("displayname"),
            "Test Resource",
        )],
    ));
    ms
}

/// Create a multistatus with multiple responses
fn create_multi_response_multistatus() -> Multistatus {
    let mut ms = Multistatus::new();
    ms.add_response(PropstatResponse::ok(
        "/resource1",
        vec![
            DavProperty::text(QName::dav("displayname"), "Resource 1"),
            DavProperty::text(QName::dav("getetag"), "\"etag1\""),
        ],
    ));
    ms.add_response(PropstatResponse::ok(
        "/resource2",
        vec![DavProperty::text(QName::dav("displayname"), "Resource 2")],
    ));
    ms
}

/// Create a multistatus with mixed statuses (200 and 404)
fn create_mixed_status_multistatus() -> Multistatus {
    let mut ms = Multistatus::new();
    ms.add_response(PropstatResponse::with_found_and_not_found(
        "/resource",
        vec![DavProperty::text(QName::dav("displayname"), "Resource")],
        vec![DavProperty::not_found(QName::dav("getcontentlanguage"))],
    ));
    ms
}

/// Create a multistatus with sync-token
fn create_sync_multistatus() -> Multistatus {
    let mut ms = Multistatus::new();
    ms.add_response(PropstatResponse::ok(
        "/collection/item",
        vec![DavProperty::text(QName::dav("getetag"), "\"etag123\"")],
    ));
    ms.set_sync_token("http://example.com/sync/token123");
    ms
}

/// Create a `CalDAV` multistatus with calendar-data
fn create_caldav_multistatus() -> Multistatus {
    let mut ms = Multistatus::new();
    ms.add_response(PropstatResponse::ok(
        "/calendars/user/calendar/event.ics",
        vec![
            DavProperty::text(QName::dav("getetag"), "\"etag-value\""),
            DavProperty::text(
                QName::caldav("calendar-data"),
                "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:test@example.com\r\nSUMMARY:Test Event\r\nEND:VEVENT\r\nEND:VCALENDAR",
            ),
        ],
    ));
    ms
}

/// Create a `CardDAV` multistatus with address-data
fn create_carddav_multistatus() -> Multistatus {
    let mut ms = Multistatus::new();
    ms.add_response(PropstatResponse::ok(
        "/addressbooks/user/contacts/card.vcf",
        vec![
            DavProperty::text(QName::dav("getetag"), "\"etag-value\""),
            DavProperty::text(
                QName::carddav("address-data"),
                "BEGIN:VCARD\r\nVERSION:4.0\r\nFN:John Doe\r\nEND:VCARD",
            ),
        ],
    ));
    ms
}

#[test]
fn serialize_simple_multistatus() {
    let multistatus = create_test_multistatus();
    let xml = serialize_multistatus(&multistatus).expect("should serialize");

    assert!(xml.contains("multistatus"));
    assert!(xml.contains("response"));
    assert!(xml.contains("/test/resource"));
    assert!(xml.contains("displayname"));
    assert!(xml.contains("Test Resource"));
    assert!(xml.contains("200"));
}

#[test]
fn serialize_multi_response() {
    let multistatus = create_multi_response_multistatus();
    let xml = serialize_multistatus(&multistatus).expect("should serialize");

    assert!(xml.contains("/resource1"));
    assert!(xml.contains("/resource2"));
    assert!(xml.contains("Resource 1"));
    assert!(xml.contains("Resource 2"));
    assert!(xml.contains("getetag"));
}

#[test]
fn serialize_mixed_status() {
    let multistatus = create_mixed_status_multistatus();
    let xml = serialize_multistatus(&multistatus).expect("should serialize");

    assert!(xml.contains("200"));
    assert!(xml.contains("404"));
    assert!(xml.contains("displayname"));
    assert!(xml.contains("getcontentlanguage"));
}

#[test]
fn serialize_with_sync_token() {
    let multistatus = create_sync_multistatus();
    let xml = serialize_multistatus(&multistatus).expect("should serialize");

    assert!(xml.contains("sync-token"));
    assert!(xml.contains("http://example.com/sync/token123"));
}

#[test]
fn serialize_caldav_response() {
    let multistatus = create_caldav_multistatus();
    let xml = serialize_multistatus(&multistatus).expect("should serialize");

    assert!(xml.contains("calendar-data"));
    assert!(xml.contains("VCALENDAR"));
    assert!(xml.contains("VEVENT"));
}

#[test]
fn serialize_carddav_response() {
    let multistatus = create_carddav_multistatus();
    let xml = serialize_multistatus(&multistatus).expect("should serialize");

    assert!(xml.contains("address-data"));
    assert!(xml.contains("VCARD"));
    assert!(xml.contains("John Doe"));
}

#[test]
fn serialize_empty_multistatus() {
    let multistatus = Multistatus::new();
    let xml = serialize_multistatus(&multistatus).expect("should serialize");

    assert!(xml.contains("multistatus"));
    // Empty multistatus should not contain response elements
    assert!(!xml.contains("<D:response>"));
}

#[test]
fn serialize_preserves_href_encoding() {
    let mut ms = Multistatus::new();
    let mut resp = PropstatResponse::new("/path/with spaces/test");
    resp.add_propstat(Propstat::new(Status::Ok, vec![]));
    ms.add_response(resp);

    let xml = serialize_multistatus(&ms).expect("should serialize");

    // The XML should contain the href
    assert!(xml.contains("href"));
    assert!(xml.contains("/path/with"));
}

#[test]
fn serialize_unicode_content() {
    let mut ms = Multistatus::new();
    ms.add_response(PropstatResponse::ok(
        "/日本語/パス",
        vec![DavProperty::text(QName::dav("displayname"), "日本語の名前")],
    ));

    let xml = serialize_multistatus(&ms).expect("should serialize");

    assert!(xml.contains("日本語"));
}

#[test]
fn serialize_collection_resourcetype() {
    let mut ms = Multistatus::new();
    ms.add_response(PropstatResponse::ok(
        "/collection/",
        vec![DavProperty::collection_resourcetype(vec![QName::dav(
            "collection",
        )])],
    ));

    let xml = serialize_multistatus(&ms).expect("should serialize");

    assert!(xml.contains("resourcetype"));
    assert!(xml.contains("collection"));
}

#[test]
fn serialize_calendar_collection() {
    let mut ms = Multistatus::new();
    ms.add_response(PropstatResponse::ok(
        "/calendars/user/work/",
        vec![DavProperty::collection_resourcetype(vec![
            QName::dav("collection"),
            QName::caldav("calendar"),
        ])],
    ));

    let xml = serialize_multistatus(&ms).expect("should serialize");

    assert!(xml.contains("resourcetype"));
    assert!(xml.contains("collection"));
    assert!(xml.contains("calendar"));
}

#[test]
fn serialize_addressbook_collection() {
    let mut ms = Multistatus::new();
    ms.add_response(PropstatResponse::ok(
        "/addressbooks/user/contacts/",
        vec![DavProperty::collection_resourcetype(vec![
            QName::dav("collection"),
            QName::carddav("addressbook"),
        ])],
    ));

    let xml = serialize_multistatus(&ms).expect("should serialize");

    assert!(xml.contains("resourcetype"));
    assert!(xml.contains("collection"));
    assert!(xml.contains("addressbook"));
}

#[test]
fn status_line_formatting() {
    assert_eq!(Status::Ok.status_line(), "HTTP/1.1 200 OK");
    assert_eq!(Status::NotFound.status_line(), "HTTP/1.1 404 Not Found");
    assert_eq!(Status::Forbidden.status_line(), "HTTP/1.1 403 Forbidden");
    assert_eq!(
        Status::PreconditionFailed.status_line(),
        "HTTP/1.1 412 Precondition Failed"
    );
}

#[test]
fn status_from_code() {
    assert_eq!(Status::from(200), Status::Ok);
    assert_eq!(Status::from(404), Status::NotFound);
    assert_eq!(Status::from(999), Status::Custom(999));
}
