#![allow(clippy::unused_async)]
//! Tests for UID validation and conflict handling.
//!
//! Verifies that PUT operations correctly handle missing UIDs and UID conflicts.

use salvo::http::StatusCode;

use super::helpers::*;

/// ## Summary
/// Test that PUT with missing UID in VEVENT returns 400 Bad Request.
#[test_log::test(tokio::test)]
async fn put_missing_uid_rejected() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

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

    #[expect(unused_must_use)]
    response.assert_status(StatusCode::BAD_REQUEST);
}

/// ## Summary
/// Test that PUT with duplicate UID returns 409 Conflict (not 403).
#[test_log::test(tokio::test)]
async fn put_uid_conflict_returns_409() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

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

    // Should return 409 Conflict per RFC 4791 §5.3.2.1

    #[expect(unused_must_use)]
    response.assert_status(StatusCode::CONFLICT);
}

/// ## Summary
/// Test that PUT update with same UID on same resource succeeds.
#[test_log::test(tokio::test)]
async fn put_update_same_uid_succeeds() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

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
/// Test that PUT with VCALENDAR but no VEVENT returns 400.
#[test_log::test(tokio::test)]
async fn put_vcalendar_without_vevent_rejected() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

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

    #[expect(unused_must_use)]
    response.assert_status(StatusCode::BAD_REQUEST);
}
