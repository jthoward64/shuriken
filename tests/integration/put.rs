#![allow(clippy::unused_async, unused_must_use)]
//! Tests for PUT method.
//!
//! Verifies resource creation/update, precondition handling, and side effects.

use salvo::http::StatusCode;

use super::helpers::*;

// ============================================================================
// Basic PUT Create Tests
// ============================================================================

/// ## Summary
/// Test that PUT creates a new calendar object.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn put_creates_calendar_object() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .truncate_all()
        .await
        .expect("Failed to truncate tables");

    let principal_id = test_db
        .seed_principal("user", "/principals/alice/", Some("Alice"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "testcal", Some("Personal"))
        .await
        .expect("Failed to seed collection");

    let service = create_test_service();

    let ical = sample_icalendar_event("new-event@example.com", "Test Event");
    let uri = format!("/api/caldav/{collection_id}/new-event.ics");

    let response = TestRequest::put(&uri)
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(service)
        .await;

    response.assert_status(StatusCode::CREATED);
}

/// ## Summary
/// Test that PUT creates a new vCard.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn put_creates_vcard() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .truncate_all()
        .await
        .expect("Failed to truncate tables");

    let principal_id = test_db
        .seed_principal("user", "/principals/bob/", Some("Bob"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(principal_id, "addressbook", "contacts", Some("Contacts"))
        .await
        .expect("Failed to seed collection");

    let service = create_test_service();

    let vcard = sample_vcard("new-contact@example.com", "Jane Doe", "jane@example.com");
    let uri = format!("/api/carddav/{collection_id}/new-contact.vcf");

    let response = TestRequest::put(&uri)
        .if_none_match("*")
        .vcard_body(&vcard)
        .send(service)
        .await;

    response.assert_status(StatusCode::CREATED);
}

// ============================================================================
// If-None-Match Precondition Tests
// ============================================================================

/// ## Summary
/// Test that PUT with If-None-Match:* succeeds when resource doesn't exist.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn put_create_if_none_match_star_ok() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .truncate_all()
        .await
        .expect("Failed to truncate tables");

    let principal_id = test_db
        .seed_principal("user", "/principals/alice/", Some("Alice"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "testcal", None)
        .await
        .expect("Failed to seed collection");

    let service = create_test_service();

    let ical = sample_icalendar_event("inm-test@example.com", "INM Test");
    let uri = format!("/api/caldav/{collection_id}/inm-test.ics");

    let response = TestRequest::put(&uri)
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(service)
        .await;

    response
        .assert_status(StatusCode::CREATED)
        .assert_header_exists("ETag");
}

/// ## Summary
/// Test that PUT with If-None-Match:* fails when resource exists.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn put_create_if_none_match_star_fails_when_exists() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .truncate_all()
        .await
        .expect("Failed to truncate tables");

    let principal_id = test_db
        .seed_principal("user", "/principals/alice/", Some("Alice"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "testcal", None)
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("icalendar", Some("existing@example.com"))
        .await
        .expect("Failed to seed entity");

    let uri = format!("/api/caldav/{collection_id}/existing.ics");
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            &uri,
            "text/calendar",
            "\"existing-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_test_service();

    let ical = sample_icalendar_event("existing@example.com", "Try Create Over Existing");

    let response = TestRequest::put(&uri)
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(service)
        .await;

    response.assert_status(StatusCode::PRECONDITION_FAILED);
}

// ============================================================================
// If-Match Precondition Tests
// ============================================================================

/// ## Summary
/// Test that PUT update with correct If-Match succeeds.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn put_update_if_match_success() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .truncate_all()
        .await
        .expect("Failed to truncate tables");

    let principal_id = test_db
        .seed_principal("user", "/principals/alice/", Some("Alice"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "testcal", None)
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("icalendar", Some("update-test@example.com"))
        .await
        .expect("Failed to seed entity");

    let uri = format!("/api/caldav/{collection_id}/update-test.ics");
    let etag = "\"update-etag-123\"";
    let _instance_id = test_db
        .seed_instance(collection_id, entity_id, &uri, "text/calendar", etag, 1)
        .await
        .expect("Failed to seed instance");

    let service = create_test_service();

    let ical = sample_icalendar_event("update-test@example.com", "Updated Event");

    let response = TestRequest::put(&uri)
        .if_match(etag)
        .icalendar_body(&ical)
        .send(service)
        .await;

    // Either 200 OK or 204 No Content for updates
    assert!(
        response.status == StatusCode::OK || response.status == StatusCode::NO_CONTENT,
        "Expected 200 or 204, got {}",
        response.status
    );
}

/// ## Summary
/// Test that PUT with mismatched If-Match returns 412.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn put_update_if_match_mismatch_412() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .truncate_all()
        .await
        .expect("Failed to truncate tables");

    let principal_id = test_db
        .seed_principal("user", "/principals/alice/", Some("Alice"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "testcal", None)
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("icalendar", Some("mismatch-test@example.com"))
        .await
        .expect("Failed to seed entity");

    let uri = format!("/api/caldav/{collection_id}/mismatch-test.ics");
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            &uri,
            "text/calendar",
            "\"actual-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_test_service();

    let ical = sample_icalendar_event("mismatch-test@example.com", "Try Update");

    let response = TestRequest::put(&uri)
        .if_match("\"wrong-etag\"")
        .icalendar_body(&ical)
        .send(service)
        .await;

    response.assert_status(StatusCode::PRECONDITION_FAILED);
}

// ============================================================================
// Content Validation Tests
// ============================================================================

/// ## Summary
/// Test that PUT with invalid iCalendar returns validation error.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn put_invalid_ical_rejected() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .truncate_all()
        .await
        .expect("Failed to truncate tables");

    let principal_id = test_db
        .seed_principal("user", "/principals/alice/", Some("Alice"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "testcal", None)
        .await
        .expect("Failed to seed collection");

    let service = create_test_service();

    let invalid_ical = "this is not valid icalendar data";
    let uri = format!("/api/caldav/{collection_id}/invalid.ics");

    let response = TestRequest::put(&uri)
        .if_none_match("*")
        .icalendar_body(invalid_ical)
        .send(service)
        .await;

    // Should return 403 Forbidden with valid-calendar-data precondition
    // or 400 Bad Request
    assert!(
        response.status == StatusCode::FORBIDDEN || response.status == StatusCode::BAD_REQUEST,
        "Expected 403 or 400 for invalid iCalendar, got {}",
        response.status
    );
}

/// ## Summary
/// Test that PUT with invalid vCard returns validation error.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn put_invalid_vcard_rejected() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .truncate_all()
        .await
        .expect("Failed to truncate tables");

    let principal_id = test_db
        .seed_principal("user", "/principals/bob/", Some("Bob"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(principal_id, "addressbook", "inv", None)
        .await
        .expect("Failed to seed collection");

    let service = create_test_service();

    let invalid_vcard = "this is not valid vcard data";
    let uri = format!("/api/carddav/{collection_id}/invalid.vcf");

    let response = TestRequest::put(&uri)
        .if_none_match("*")
        .vcard_body(invalid_vcard)
        .send(service)
        .await;

    // Should return 403 Forbidden with valid-address-data precondition
    // or 400 Bad Request
    assert!(
        response.status == StatusCode::FORBIDDEN || response.status == StatusCode::BAD_REQUEST,
        "Expected 403 or 400 for invalid vCard, got {}",
        response.status
    );
}

// ============================================================================
// UID Conflict Tests
// ============================================================================

/// ## Summary
/// Test that PUT with duplicate UID returns no-uid-conflict error.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn put_uid_conflict_rejected() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .truncate_all()
        .await
        .expect("Failed to truncate tables");

    let principal_id = test_db
        .seed_principal("user", "/principals/alice/", Some("Alice"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "testcal", None)
        .await
        .expect("Failed to seed collection");

    // Create an existing event with a specific UID
    let entity_id = test_db
        .seed_entity("icalendar", Some("duplicate-uid@example.com"))
        .await
        .expect("Failed to seed entity");

    let existing_uri = format!("/api/caldav/{collection_id}/existing-event.ics");
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            &existing_uri,
            "text/calendar",
            "\"existing\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_test_service();

    // Try to create a new event at a different URI with the same UID
    let ical = sample_icalendar_event("duplicate-uid@example.com", "Duplicate UID Event");
    let new_uri = format!("/api/caldav/{collection_id}/new-event-same-uid.ics");

    let response = TestRequest::put(&new_uri)
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(service)
        .await;

    // Should return 403 Forbidden with no-uid-conflict precondition
    response.assert_status(StatusCode::FORBIDDEN);
}

// ============================================================================
// Sync Token Tests
// ============================================================================

/// ## Summary
/// Test that PUT bumps collection sync token.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn put_bumps_synctoken() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .truncate_all()
        .await
        .expect("Failed to truncate tables");

    let principal_id = test_db
        .seed_principal("user", "/principals/alice/", Some("Alice"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "testcal", None)
        .await
        .expect("Failed to seed collection");

    // Get initial sync token
    let initial_synctoken = test_db
        .get_collection_synctoken(collection_id)
        .await
        .expect("Failed to get synctoken");

    let service = create_test_service();

    let ical = sample_icalendar_event("sync-test@example.com", "Sync Test Event");
    let uri = format!("/api/caldav/{collection_id}/sync-test.ics");

    let response = TestRequest::put(&uri)
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(service)
        .await;

    response.assert_status(StatusCode::CREATED);

    // Verify sync token increased
    let new_synctoken = test_db
        .get_collection_synctoken(collection_id)
        .await
        .expect("Failed to get synctoken");

    assert!(
        new_synctoken > initial_synctoken,
        "Sync token should increase after PUT"
    );
}

// ============================================================================
// ETag Response Tests
// ============================================================================

/// ## Summary
/// Test that PUT returns ETag in response.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn put_returns_etag() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .truncate_all()
        .await
        .expect("Failed to truncate tables");

    let principal_id = test_db
        .seed_principal("user", "/principals/alice/", Some("Alice"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "testcal", None)
        .await
        .expect("Failed to seed collection");

    let service = create_test_service();

    let ical = sample_icalendar_event("etag-response@example.com", "ETag Response Test");
    let uri = format!("/api/caldav/{collection_id}/etag-response.ics");

    let response = TestRequest::put(&uri)
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(service)
        .await;

    let response = response
        .assert_status(StatusCode::CREATED)
        .assert_header_exists("ETag");

    // Verify ETag format
    let etag = response.get_etag().expect("ETag should be present");
    assert!(
        etag.starts_with('"') && etag.ends_with('"'),
        "ETag should be a quoted string"
    );
}

/// ## Summary
/// Test that PUT updates ETag on modification.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn put_updates_etag() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .truncate_all()
        .await
        .expect("Failed to truncate tables");

    let principal_id = test_db
        .seed_principal("user", "/principals/alice/", Some("Alice"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "testcal", None)
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("icalendar", Some("etag-update@example.com"))
        .await
        .expect("Failed to seed entity");

    let uri = format!("/api/caldav/{collection_id}/etag-update.ics");
    let initial_etag = "\"initial-etag\"";
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            &uri,
            "text/calendar",
            initial_etag,
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_test_service();

    let ical = sample_icalendar_event("etag-update@example.com", "Updated Content");

    let response = TestRequest::put(&uri)
        .if_match(initial_etag)
        .icalendar_body(&ical)
        .send(service)
        .await;

    assert!(
        response.status == StatusCode::OK || response.status == StatusCode::NO_CONTENT,
        "Expected 200 or 204, got {}",
        response.status
    );

    // If ETag is returned, it should be different from initial
    if let Some(new_etag) = response.get_etag() {
        assert_ne!(
            new_etag, initial_etag,
            "ETag should change after content update"
        );
    }
}

// ============================================================================
// Status Code Tests
// ============================================================================

/// ## Summary
/// Test that PUT returns 201 for new resources and 204 for updates.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn put_status_codes() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .truncate_all()
        .await
        .expect("Failed to truncate tables");

    let principal_id = test_db
        .seed_principal("user", "/principals/alice/", Some("Alice"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "testcal", None)
        .await
        .expect("Failed to seed collection");

    let service = create_test_service();

    let uri = format!("/api/caldav/{collection_id}/status-test.ics");

    // Create new resource - should return 201
    let ical = sample_icalendar_event("status-test@example.com", "Status Test");
    let response = TestRequest::put(&uri)
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(service)
        .await;

    let response = response.assert_status(StatusCode::CREATED);

    // Get ETag for update
    let etag = response.get_etag().expect("ETag from create");

    // Update existing resource - should return 200 or 204
    let updated_ical = sample_icalendar_event("status-test@example.com", "Updated Status Test");
    let response = TestRequest::put(&uri)
        .if_match(etag)
        .icalendar_body(&updated_ical)
        .send(service)
        .await;

    assert!(
        response.status == StatusCode::OK || response.status == StatusCode::NO_CONTENT,
        "Update should return 200 or 204, got {}",
        response.status
    );
}

// ============================================================================
// Non-existent Collection Tests
// ============================================================================

/// ## Summary
/// Test that PUT to non-existent collection returns 404.
#[tokio::test]
async fn put_nonexistent_collection_404() {
    let service = create_test_service();

    let ical = sample_icalendar_event("orphan@example.com", "Orphan Event");
    let uri = "/api/caldav/00000000-0000-0000-0000-000000000000/orphan.ics";

    let response = TestRequest::put(uri)
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(service)
        .await;

    response.assert_status(StatusCode::NOT_FOUND);
}
