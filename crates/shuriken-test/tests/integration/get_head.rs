#![allow(clippy::unused_async, unused_must_use)]
//! Tests for GET and HEAD methods.
//!
//! Verifies resource retrieval, ETag handling, and conditional requests.

use salvo::http::StatusCode;

use super::helpers::*;

// ============================================================================
// Basic GET Tests
// ============================================================================

/// ## Summary
/// Test that GET on a calendar object returns correct Content-Type.
#[test_log::test(tokio::test)]
async fn get_calendar_object_content_type() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    // Seed test data
    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let collection_id = test_db
        .seed_collection(
            principal_id,
            CollectionType::Calendar,
            "testcal",
            Some("Personal"),
        )
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let entity_id = test_db
        .seed_entity("icalendar", Some("event-123@example.com"))
        .await
        .expect("Failed to seed entity");

    test_db
        .seed_minimal_icalendar_event(entity_id, "event-123@example.com", "Test Event")
        .await
        .expect("Failed to seed event components");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "event-123",
            "text/calendar",
            "\"abc123\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    let uri = caldav_item_path("testuser", "testcal", "event-123.ics");
    let response = TestRequest::get(&uri).send(&service).await;

    // Expect 200 OK with correct content type
    response
        .assert_status(StatusCode::OK)
        .assert_header_contains("Content-Type", "text/calendar");
}

/// ## Summary
/// Test that GET on a vcard returns correct Content-Type.
#[test_log::test(tokio::test)]
async fn get_vcard_content_type() {
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
        .seed_collection(
            principal_id,
            CollectionType::Addressbook,
            "contacts",
            Some("Contacts"),
        )
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "addressbook")
        .await
        .expect("Failed to seed collection owner");

    let entity_id = test_db
        .seed_entity("vcard", Some("contact-456@example.com"))
        .await
        .expect("Failed to seed entity");

    test_db
        .seed_minimal_vcard(entity_id, "contact-456@example.com", "Test Person")
        .await
        .expect("Failed to seed vcard components");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "contact-456",
            "text/vcard",
            "\"def456\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    let uri = carddav_item_path("testuser", "contacts", "contact-456.vcf");
    let response = TestRequest::get(&uri).send(&service).await;

    response
        .assert_status(StatusCode::OK)
        .assert_header_contains("Content-Type", "text/vcard");
}

// ============================================================================
// Component Tree Serialization Tests
// ============================================================================

/// ## Summary
/// Test that GET serializes calendar content from the component tree.
#[test_log::test(tokio::test)]
async fn get_calendar_object_uses_component_tree() {
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
        .seed_collection(
            principal_id,
            CollectionType::Calendar,
            "treecal",
            Some("Tree Calendar"),
        )
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let entity_id = test_db
        .seed_entity("icalendar", Some("tree-event-001@example.com"))
        .await
        .expect("Failed to seed entity");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "tree-event",
            "text/calendar",
            "\"tree-etag-001\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let calendar_root = test_db
        .seed_component(entity_id, None, "VCALENDAR", 0)
        .await
        .expect("Failed to seed VCALENDAR component");

    let event_component = test_db
        .seed_component(entity_id, Some(calendar_root), "VEVENT", 0)
        .await
        .expect("Failed to seed VEVENT component");

    test_db
        .seed_property(calendar_root, "VERSION", Some("2.0"), 0)
        .await
        .expect("Failed to seed VERSION property");
    test_db
        .seed_property(calendar_root, "PRODID", Some("-//Shuriken//EN"), 1)
        .await
        .expect("Failed to seed PRODID property");

    test_db
        .seed_property(
            event_component,
            "UID",
            Some("tree-event-001@example.com"),
            0,
        )
        .await
        .expect("Failed to seed UID property");
    test_db
        .seed_property(event_component, "DTSTAMP", Some("20240101T120000Z"), 1)
        .await
        .expect("Failed to seed DTSTAMP property");
    test_db
        .seed_property(event_component, "DTSTART", Some("20240115T140000Z"), 2)
        .await
        .expect("Failed to seed DTSTART property");
    test_db
        .seed_property(event_component, "DTEND", Some("20240115T150000Z"), 3)
        .await
        .expect("Failed to seed DTEND property");
    test_db
        .seed_property(event_component, "SUMMARY", Some("Tree Meeting"), 4)
        .await
        .expect("Failed to seed SUMMARY property");

    let service = create_db_test_service(&test_db.url()).await;

    let uri = caldav_item_path("testuser", "treecal", "tree-event.ics");
    let response = TestRequest::get(&uri).send(&service).await;

    let response = response.assert_status(StatusCode::OK);

    let expected = concat!(
        "BEGIN:VCALENDAR\r\n",
        "VERSION:2.0\r\n",
        "PRODID:-//Shuriken//EN\r\n",
        "BEGIN:VEVENT\r\n",
        "UID:tree-event-001@example.com\r\n",
        "DTSTAMP:20240101T120000Z\r\n",
        "DTSTART:20240115T140000Z\r\n",
        "DTEND:20240115T150000Z\r\n",
        "SUMMARY:Tree Meeting\r\n",
        "END:VEVENT\r\n",
        "END:VCALENDAR\r\n",
    );

    assert_eq!(response.body_string(), expected);
}

/// ## Summary
/// Test that GET serializes vCard content from the component tree.
#[test_log::test(tokio::test)]
async fn get_vcard_uses_component_tree() {
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
        .seed_collection(
            principal_id,
            CollectionType::Addressbook,
            "treebook",
            Some("Tree Book"),
        )
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "addressbook")
        .await
        .expect("Failed to seed collection owner");

    let entity_id = test_db
        .seed_entity("vcard", Some("tree-contact-001@example.com"))
        .await
        .expect("Failed to seed entity");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "tree-contact",
            "text/vcard",
            "\"tree-vcard-etag-001\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let vcard_root = test_db
        .seed_component(entity_id, None, "VCARD", 0)
        .await
        .expect("Failed to seed VCARD component");

    test_db
        .seed_property(vcard_root, "VERSION", Some("4.0"), 0)
        .await
        .expect("Failed to seed VERSION property");
    test_db
        .seed_property(vcard_root, "N", Some("Doe;Jane;;;"), 1)
        .await
        .expect("Failed to seed N property");
    test_db
        .seed_property(vcard_root, "FN", Some("Jane Doe"), 2)
        .await
        .expect("Failed to seed FN property");
    test_db
        .seed_property(vcard_root, "EMAIL", Some("jane@example.com"), 3)
        .await
        .expect("Failed to seed EMAIL property");
    test_db
        .seed_property(vcard_root, "UID", Some("tree-contact-001@example.com"), 4)
        .await
        .expect("Failed to seed UID property");

    let service = create_db_test_service(&test_db.url()).await;

    let uri = carddav_item_path("testuser", "treebook", "tree-contact.vcf");
    let response = TestRequest::get(&uri).send(&service).await;

    let response = response.assert_status(StatusCode::OK);

    let expected = concat!(
        "BEGIN:VCARD\r\n",
        "VERSION:4.0\r\n",
        "FN:Jane Doe\r\n",
        "N:Doe;Jane;;;\r\n",
        "EMAIL:jane@example.com\r\n",
        "UID:tree-contact-001@example.com\r\n",
        "END:VCARD\r\n",
    );

    assert_eq!(response.body_string(), expected);
}

/// ## Summary
/// Test that GET on non-existent resource returns 404.
#[test_log::test(tokio::test)]
async fn get_nonexistent_404() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    let service = create_db_test_service(&test_db.url()).await;

    let uri = caldav_item_path(
        "nonexistent-owner",
        "nonexistent-collection",
        "nonexistent.ics",
    );
    let response = TestRequest::get(&uri).send(&service).await;

    response.assert_status(StatusCode::NOT_FOUND);
}

// ============================================================================
// HEAD Tests
// ============================================================================

/// ## Summary
/// Test that HEAD returns same headers as GET without body.
#[test_log::test(tokio::test)]
async fn head_matches_get_headers() {
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
        .seed_collection(
            principal_id,
            CollectionType::Calendar,
            "testcal",
            Some("Personal"),
        )
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let entity_id = test_db
        .seed_entity("icalendar", Some("event-789@example.com"))
        .await
        .expect("Failed to seed entity");

    test_db
        .seed_minimal_icalendar_event(entity_id, "event-789@example.com", "Test Event")
        .await
        .expect("Failed to seed event components");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "event-789",
            "text/calendar",
            "\"xyz789\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    let uri = caldav_item_path("testuser", "testcal", "event-789.ics");

    // Send GET request
    let get_response = TestRequest::get(&uri).send(&service).await;

    // Send HEAD request
    let head_response = TestRequest::head(&uri).send(&service).await;

    // Status should match
    assert_eq!(
        get_response.status, head_response.status,
        "GET and HEAD should return same status"
    );

    // Content-Type should match
    assert_eq!(
        get_response.get_content_type(),
        head_response.get_content_type(),
        "GET and HEAD should return same Content-Type"
    );

    // ETag should match
    assert_eq!(
        get_response.get_etag(),
        head_response.get_etag(),
        "GET and HEAD should return same ETag"
    );

    // HEAD body should be empty
    head_response.assert_body_empty();
}

/// ## Summary
/// Test that HEAD on non-existent resource returns 404.
#[test_log::test(tokio::test)]
async fn head_nonexistent_404() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    let service = create_db_test_service(&test_db.url()).await;

    let uri = caldav_item_path(
        "nonexistent-owner",
        "nonexistent-collection",
        "nonexistent.ics",
    );
    let response = TestRequest::head(&uri).send(&service).await;

    response.assert_status(StatusCode::NOT_FOUND);
}

// ============================================================================
// ETag Tests
// ============================================================================

/// ## Summary
/// Test that GET returns strong ETag.
#[test_log::test(tokio::test)]
async fn get_etag_present_and_strong() {
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
        .seed_collection(principal_id, CollectionType::Calendar, "testcal", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let entity_id = test_db
        .seed_entity("icalendar", Some("etag-test@example.com"))
        .await
        .expect("Failed to seed entity");

    test_db
        .seed_minimal_icalendar_event(entity_id, "etag-test@example.com", "Test Event")
        .await
        .expect("Failed to seed event components");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "etag-test",
            "text/calendar",
            "\"strong-etag-123\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    let uri = caldav_item_path("testuser", "testcal", "etag-test.ics");
    let response = TestRequest::get(&uri).send(&service).await;

    let response = response
        .assert_status(StatusCode::OK)
        .assert_header_exists("ETag");

    // Verify ETag is strong (not weak)
    let etag = response.get_etag().expect("ETag should be present");
    assert!(
        !etag.starts_with("W/"),
        "ETag should be strong (not start with W/)"
    );
    assert!(
        etag.starts_with('"') && etag.ends_with('"'),
        "ETag should be a quoted string"
    );
}

// ============================================================================
// Conditional Request Tests
// ============================================================================

/// ## Summary
/// Test that If-None-Match with matching ETag returns 304.
#[test_log::test(tokio::test)]
async fn get_if_none_match_304() {
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
        .seed_collection(principal_id, CollectionType::Calendar, "testcal", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let entity_id = test_db
        .seed_entity("icalendar", Some("cond-test@example.com"))
        .await
        .expect("Failed to seed entity");

    test_db
        .seed_minimal_icalendar_event(entity_id, "cond-test@example.com", "Conditional Test Event")
        .await
        .expect("Failed to seed event components");

    let etag = "\"cond-etag-456\"";
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "cond-test",
            "text/calendar",
            etag,
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    let uri = caldav_item_path("testuser", "testcal", "cond-test.ics");

    // First GET to verify resource exists
    let response = TestRequest::get(&uri).send(&service).await;
    response.assert_status(StatusCode::OK);

    // Second GET with If-None-Match
    let response = TestRequest::get(&uri)
        .if_none_match(etag)
        .send(&service)
        .await;

    response.assert_status(StatusCode::NOT_MODIFIED);
}

/// ## Summary
/// Test that If-None-Match with non-matching ETag returns 200.
#[test_log::test(tokio::test)]
async fn get_if_none_match_different_etag_returns_200() {
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
        .seed_collection(principal_id, CollectionType::Calendar, "testcal", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let entity_id = test_db
        .seed_entity("icalendar", Some("cond-test-2@example.com"))
        .await
        .expect("Failed to seed entity");
    test_db
        .seed_minimal_icalendar_event(entity_id, "cond-test@example.com", "Test Event")
        .await
        .expect("Failed to seed event components");
    test_db
        .seed_minimal_icalendar_event(entity_id, "cond-test-2@example.com", "Test Event")
        .await
        .expect("Failed to seed event components");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "cond-test-2",
            "text/calendar",
            "\"actual-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    let uri = caldav_item_path("testuser", "testcal", "cond-test-2.ics");

    // GET with different ETag should return 200
    let response = TestRequest::get(&uri)
        .if_none_match("\"different-etag\"")
        .send(&service)
        .await;

    response.assert_status(StatusCode::OK);
}

/// ## Summary
/// Test that If-Match with mismatched ETag returns 412.
#[test_log::test(tokio::test)]
async fn get_if_match_412() {
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
        .seed_collection(principal_id, CollectionType::Calendar, "testcal", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let entity_id = test_db
        .seed_entity("icalendar", Some("match-test@example.com"))
        .await
        .expect("Failed to seed entity");
    test_db
        .seed_minimal_icalendar_event(entity_id, "match-test-2@example.com", "Test Event")
        .await
        .expect("Failed to seed event components");
    test_db
        .seed_minimal_icalendar_event(entity_id, "match-test@example.com", "Test Event")
        .await
        .expect("Failed to seed event components");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "match-test",
            "text/calendar",
            "\"real-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    let uri = caldav_item_path("testuser", "testcal", "match-test.ics");

    // GET with wrong If-Match should return 412
    let response = TestRequest::get(&uri)
        .if_match("\"wrong-etag\"")
        .send(&service)
        .await;

    response.assert_status(StatusCode::PRECONDITION_FAILED);
}

/// ## Summary
/// Test that If-Match with matching ETag returns 200.
#[test_log::test(tokio::test)]
async fn get_if_match_success() {
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
        .seed_collection(principal_id, CollectionType::Calendar, "testcal", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let entity_id = test_db
        .seed_entity("icalendar", Some("match-test-2@example.com"))
        .await
        .expect("Failed to seed entity");

    test_db
        .seed_minimal_icalendar_event(entity_id, "match-test-2@example.com", "Match Test Event")
        .await
        .expect("Failed to seed event components");

    let etag = "\"correct-etag\"";
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "match-test-2",
            "text/calendar",
            etag,
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    let uri = caldav_item_path("testuser", "testcal", "match-test-2.ics");

    // GET with correct If-Match should return 200
    let response = TestRequest::get(&uri).if_match(etag).send(&service).await;

    response.assert_status(StatusCode::OK);
}

// ============================================================================
// Collection GET Tests
// ============================================================================

/// ## Summary
/// Test that GET on collection may return 405 or directory listing.
#[test_log::test(tokio::test)]
async fn get_on_collection_path() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    let service = create_db_test_service(&test_db.url()).await;

    // GET on a collection path that doesn't exist
    let uri = caldav_collection_path("nonexistent-owner", "nonexistent-collection");
    let response = TestRequest::get(&uri).send(&service).await;

    // Either 405 Method Not Allowed or some form of listing is acceptable
    // Document the actual behavior
    assert!(
        response.status == StatusCode::METHOD_NOT_ALLOWED
            || response.status == StatusCode::OK
            || response.status == StatusCode::NOT_FOUND,
        "Expected 405, 200, or 404 for GET on collection, got {}",
        response.status
    );
}

// ============================================================================
// Last-Modified Tests
// ============================================================================

/// ## Summary
/// Test that Last-Modified header is present.
#[test_log::test(tokio::test)]
async fn get_last_modified_header() {
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
        .seed_collection(principal_id, CollectionType::Calendar, "testcal", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let entity_id = test_db
        .seed_entity("icalendar", Some("lm-test@example.com"))
        .await
        .expect("Failed to seed entity");

    test_db
        .seed_minimal_icalendar_event(entity_id, "lm-test@example.com", "Test Event")
        .await
        .expect("Failed to seed event components");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "lm-test",
            "text/calendar",
            "\"lm-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    let uri = caldav_item_path("testuser", "testcal", "lm-test.ics");
    let response = TestRequest::get(&uri).send(&service).await;

    response
        .assert_status(StatusCode::OK)
        .assert_header_exists("Last-Modified");
}

/// ## Summary
/// Test that Content-Length header matches actual body length.
#[test_log::test(tokio::test)]
async fn get_content_length_accurate() {
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
        .seed_collection(principal_id, CollectionType::Calendar, "testcal", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let entity_id = test_db
        .seed_entity("icalendar", Some("cl-test@example.com"))
        .await
        .expect("Failed to seed entity");

    test_db
        .seed_minimal_icalendar_event(entity_id, "cl-test@example.com", "Test Event")
        .await
        .expect("Failed to seed event components");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "cl-test",
            "text/calendar",
            "\"cl-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    let uri = caldav_item_path("testuser", "testcal", "cl-test.ics");
    let response = TestRequest::get(&uri).send(&service).await;

    let response = response.assert_status(StatusCode::OK);

    // If Content-Length is present, it should match body length
    if let Some(content_length) = response.get_header("Content-Length") {
        let expected_length: usize = content_length.parse().expect("Valid Content-Length");
        assert_eq!(
            response.body.len(),
            expected_length,
            "Content-Length should match actual body length"
        );
    }
}
