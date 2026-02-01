#![allow(clippy::unused_async)]
//! Tests for UID validation and conflict handling.
//!
//! Verifies that PUT operations correctly handle missing UIDs and UID conflicts.

use salvo::http::StatusCode;

use super::helpers::*;

/// ## Summary
/// Test that PUT with missing UID in VEVENT returns 403 Forbidden with valid-calendar-data precondition.
#[test_log::test(tokio::test)]
async fn put_missing_uid_rejected() {
    let test_db = TestDb::new().await.expect("Failed to create test database");


    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let collection_id = test_db
        .seed_collection(principal_id, CollectionType::Calendar, "test-cal", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    // iCalendar without UID property
    let ical_no_uid = r"BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
DTSTART:20260201T100000Z
DTEND:20260201T110000Z
SUMMARY:Event Without UID
END:VEVENT
END:VCALENDAR";

    let response = TestRequest::put(&caldav_item_path("testuser", "test-cal", "no-uid.ics"))
        .icalendar_body(ical_no_uid)
        .send(&service)
        .await;

    // RFC 4791 §5.3.2: Invalid calendar data returns 403 with valid-calendar-data precondition
    #[expect(unused_must_use)]
    response.assert_status(StatusCode::FORBIDDEN);
}

/// ## Summary
/// Test that PUT with duplicate UID returns 403 Forbidden with no-uid-conflict precondition.
#[test_log::test(tokio::test)]
async fn put_uid_conflict_returns_409() {
    let test_db = TestDb::new().await.expect("Failed to create test database");


    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let collection_id = test_db
        .seed_collection(principal_id, CollectionType::Calendar, "test-cal", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    // Create first event with specific UID
    let ical1 = "BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:conflict@example.com
DTSTART:20240101T120000Z
DTEND:20240101T130000Z
SUMMARY:First Event
END:VEVENT
END:VCALENDAR";

    let response = TestRequest::put(&caldav_item_path("testuser", "test-cal", "event1.ics"))
        .icalendar_body(ical1)
        .send(&service)
        .await;

    #[expect(unused_must_use)]
    response.assert_status(StatusCode::CREATED);

    // Try to create second event with same UID
    let ical2 = r"BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:conflict@example.com
DTSTART:20260202T100000Z
DTEND:20260202T110000Z
SUMMARY:Second Event (Duplicate UID)
END:VEVENT
END:VCALENDAR";

    let response = TestRequest::put(&caldav_item_path("testuser", "test-cal", "event2.ics"))
        .icalendar_body(ical2)
        .send(&service)
        .await;

    // RFC 4791 §5.3.2.1: UID conflicts return 403 Forbidden with no-uid-conflict precondition
    let response = response.assert_status(StatusCode::FORBIDDEN);

    // Verify XML error body contains no-uid-conflict element
    let body = response.body_string();
    assert!(
        body.contains("no-uid-conflict"),
        "Response should contain no-uid-conflict precondition element"
    );
}

/// ## Summary
/// Test that PUT update with same UID on same resource succeeds.
#[test_log::test(tokio::test)]
async fn put_update_same_uid_succeeds() {
    let test_db = TestDb::new().await.expect("Failed to create test database");


    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let collection_id = test_db
        .seed_collection(principal_id, CollectionType::Calendar, "test-cal", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    // Create first event
    let ical1 = "BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:update@example.com
DTSTART:20240101T120000Z
DTEND:20240101T130000Z
SUMMARY:Original Event
END:VEVENT
END:VCALENDAR";

    let response = TestRequest::put(&caldav_item_path("testuser", "test-cal", "event.ics"))
        .icalendar_body(ical1)
        .send(&service)
        .await;

    #[expect(unused_must_use)]
    response.assert_status(StatusCode::CREATED);

    // Update same resource with same UID (should succeed)
    let ical2 = r"BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:update-uid@example.com
DTSTART:20260201T140000Z
DTEND:20260201T150000Z
SUMMARY:Updated Event
END:VEVENT
END:VCALENDAR";

    let response = TestRequest::put(&caldav_item_path("testuser", "test-cal", "event.ics"))
        .icalendar_body(ical2)
        .send(&service)
        .await;

    #[expect(unused_must_use)]
    response.assert_status(StatusCode::NO_CONTENT);
}

/// ## Summary
/// Test that PUT with VCALENDAR but no VEVENT returns 403 Forbidden with valid-calendar-object-resource precondition.
#[test_log::test(tokio::test)]
async fn put_vcalendar_without_vevent_rejected() {
    let test_db = TestDb::new().await.expect("Failed to create test database");


    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let collection_id = test_db
        .seed_collection(principal_id, CollectionType::Calendar, "test-cal", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    // VCALENDAR without VEVENT
    let ical_no_vevent = "BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
END:VCALENDAR";

    let response = TestRequest::put(&caldav_item_path("testuser", "test-cal", "no-vevent.ics"))
        .icalendar_body(ical_no_vevent)
        .send(&service)
        .await;

    // RFC 4791 §5.3.2: Invalid calendar object returns 403 with valid-calendar-object-resource precondition
    let response = response.assert_status(StatusCode::FORBIDDEN);

    let body = response.body_string();
    assert!(
        body.contains("valid-calendar-object-resource"),
        "Response should contain valid-calendar-object-resource precondition element"
    );
}
/// ## Summary
/// Test that PUT with METHOD property returns 403 Forbidden with valid-calendar-data precondition.
/// RFC 4791 §4.1: Calendar object resources MUST NOT contain METHOD property.
#[test_log::test(tokio::test)]
async fn put_method_property_rejected() {
    let test_db = TestDb::new().await.expect("Failed to create test database");


    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let collection_id = test_db
        .seed_collection(principal_id, CollectionType::Calendar, "test-cal", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    // iCalendar with METHOD property (not allowed in stored calendar objects)
    let ical_with_method = r"BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
METHOD:PUBLISH
BEGIN:VEVENT
UID:test-event-with-method@example.com
DTSTART:20260201T100000Z
DTEND:20260201T110000Z
SUMMARY:Event With METHOD
END:VEVENT
END:VCALENDAR";

    let response = TestRequest::put(&caldav_item_path("testuser", "test-cal", "with-method.ics"))
        .icalendar_body(ical_with_method)
        .send(&service)
        .await;

    // RFC 4791 §5.3.2.1: METHOD property not allowed returns 403 with valid-calendar-data
    let response = response.assert_status(StatusCode::FORBIDDEN);

    let body = response.body_string();
    assert!(
        body.contains("valid-calendar-data"),
        "Response should contain valid-calendar-data precondition element"
    );
}

/// ## Summary
/// Test that PUT with multiple component types returns 403 Forbidden.
/// RFC 4791 §4.1: Calendar object resources cannot contain multiple component types.
#[test_log::test(tokio::test)]
async fn put_multiple_component_types_rejected() {
    let test_db = TestDb::new().await.expect("Failed to create test database");


    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let collection_id = test_db
        .seed_collection(principal_id, CollectionType::Calendar, "test-cal", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    // iCalendar with both VEVENT and VTODO (not allowed)
    let ical_mixed = r"BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:test-event@example.com
DTSTART:20260201T100000Z
DTEND:20260201T110000Z
SUMMARY:An Event
END:VEVENT
BEGIN:VTODO
UID:test-todo@example.com
SUMMARY:A Task
END:VTODO
END:VCALENDAR";

    let response = TestRequest::put(&caldav_item_path("testuser", "test-cal", "mixed.ics"))
        .icalendar_body(ical_mixed)
        .send(&service)
        .await;

    // RFC 4791 §5.3.2.1: Multiple component types return 403 with valid-calendar-object-resource
    let response = response.assert_status(StatusCode::FORBIDDEN);

    let body = response.body_string();
    assert!(
        body.contains("valid-calendar-object-resource"),
        "Response should contain valid-calendar-object-resource precondition element"
    );
}

/// ## Summary
/// Test that PUT with unsupported Content-Type returns 403 Forbidden.
/// RFC 4791 §5.3.2.1: Resource MUST be supported calendar data format (text/calendar).
#[test_log::test(tokio::test)]
async fn put_unsupported_content_type_rejected() {
    let test_db = TestDb::new().await.expect("Failed to create test database");


    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let collection_id = test_db
        .seed_collection(principal_id, CollectionType::Calendar, "test-cal", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    // Valid iCalendar but with wrong Content-Type
    let ical = r"BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:test-event@example.com
DTSTART:20260201T100000Z
DTEND:20260201T110000Z
SUMMARY:Test Event
END:VEVENT
END:VCALENDAR";

    let response = TestRequest::put(&caldav_item_path("testuser", "test-cal", "wrong-type.ics"))
        .body(ical)
        .header("Content-Type", "application/json")
        .send(&service)
        .await;

    // RFC 4791 §5.3.2.1: Wrong Content-Type returns 403 with supported-calendar-data
    let response = response.assert_status(StatusCode::FORBIDDEN);

    let body = response.body_string();
    assert!(
        body.contains("supported-calendar-data"),
        "Response should contain supported-calendar-data precondition element"
    );
}
