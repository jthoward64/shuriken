#![allow(clippy::unused_async)]
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
#[tokio::test]
#[ignore = "requires database seeding"]
async fn get_calendar_object_content_type() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .truncate_all()
        .await
        .expect("Failed to truncate tables");

    // Seed test data
    let principal_id = test_db
        .seed_principal("user", "/principals/alice/", Some("Alice"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(
            principal_id,
            "calendar",
            "testcal",
            Some("Personal"),
        )
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("icalendar", Some("event-123@example.com"))
        .await
        .expect("Failed to seed entity");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            &format!("/api/caldav/{collection_id}/event-123.ics"),
            "text/calendar",
            "\"abc123\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_test_service();

    let response = TestRequest::get(&format!("/api/caldav/{collection_id}/event-123.ics"))
        .send(service)
        .await;

    // Expect 200 OK with correct content type
    response
        .assert_status(StatusCode::OK)
        .assert_header_contains("Content-Type", "text/calendar");
}

/// ## Summary
/// Test that GET on a vcard returns correct Content-Type.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn get_vcard_content_type() {
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
        .seed_collection(
            principal_id,
            "addressbook",
            "/addressbooks/bob/contacts/",
            Some("Contacts"),
        )
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("vcard", Some("contact-456@example.com"))
        .await
        .expect("Failed to seed entity");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            &format!("/api/carddav/{collection_id}/contact-456.vcf"),
            "text/vcard",
            "\"def456\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_test_service();

    let response = TestRequest::get(&format!("/api/carddav/{collection_id}/contact-456.vcf"))
        .send(service)
        .await;

    response
        .assert_status(StatusCode::OK)
        .assert_header_contains("Content-Type", "text/vcard");
}

/// ## Summary
/// Test that GET on non-existent resource returns 404.
#[tokio::test]
async fn get_nonexistent_404() {
    let service = create_test_service();

    let response =
        TestRequest::get("/api/caldav/00000000-0000-0000-0000-000000000000/nonexistent.ics")
            .send(service)
            .await;

    response.assert_status(StatusCode::NOT_FOUND);
}

// ============================================================================
// HEAD Tests
// ============================================================================

/// ## Summary
/// Test that HEAD returns same headers as GET without body.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn head_matches_get_headers() {
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
        .seed_collection(
            principal_id,
            "calendar",
            "testcal",
            Some("Personal"),
        )
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("icalendar", Some("event-789@example.com"))
        .await
        .expect("Failed to seed entity");

    let uri = format!("/api/caldav/{collection_id}/event-789.ics");
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            &uri,
            "text/calendar",
            "\"xyz789\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_test_service();

    // Send GET request
    let get_response = TestRequest::get(&uri).send(service).await;

    // Send HEAD request
    let head_response = TestRequest::head(&uri).send(service).await;

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
#[tokio::test]
async fn head_nonexistent_404() {
    let service = create_test_service();

    let response =
        TestRequest::head("/api/caldav/00000000-0000-0000-0000-000000000000/nonexistent.ics")
            .send(service)
            .await;

    response.assert_status(StatusCode::NOT_FOUND);
}

// ============================================================================
// ETag Tests
// ============================================================================

/// ## Summary
/// Test that GET returns strong ETag.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn get_etag_present_and_strong() {
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
        .seed_entity("icalendar", Some("etag-test@example.com"))
        .await
        .expect("Failed to seed entity");

    let uri = format!("/api/caldav/{collection_id}/etag-test.ics");
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            &uri,
            "text/calendar",
            "\"strong-etag-123\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_test_service();

    let response = TestRequest::get(&uri).send(service).await;

    let response = response.assert_status(StatusCode::OK).assert_header_exists("ETag");

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
#[tokio::test]
#[ignore = "requires database seeding"]
async fn get_if_none_match_304() {
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
        .seed_entity("icalendar", Some("cond-test@example.com"))
        .await
        .expect("Failed to seed entity");

    let uri = format!("/api/caldav/{collection_id}/cond-test.ics");
    let etag = "\"cond-etag-456\"";
    let _instance_id = test_db
        .seed_instance(collection_id, entity_id, &uri, "text/calendar", etag, 1)
        .await
        .expect("Failed to seed instance");

    let service = create_test_service();

    // First GET to verify resource exists
    let response = TestRequest::get(&uri).send(service).await;
    response.assert_status(StatusCode::OK);

    // Second GET with If-None-Match
    let response = TestRequest::get(&uri)
        .if_none_match(etag)
        .send(service)
        .await;

    response.assert_status(StatusCode::NOT_MODIFIED);
}

/// ## Summary
/// Test that If-None-Match with non-matching ETag returns 200.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn get_if_none_match_different_etag_returns_200() {
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
        .seed_entity("icalendar", Some("cond-test-2@example.com"))
        .await
        .expect("Failed to seed entity");

    let uri = format!("/api/caldav/{collection_id}/cond-test-2.ics");
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

    // GET with different ETag should return 200
    let response = TestRequest::get(&uri)
        .if_none_match("\"different-etag\"")
        .send(service)
        .await;

    response.assert_status(StatusCode::OK);
}

/// ## Summary
/// Test that If-Match with mismatched ETag returns 412.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn get_if_match_412() {
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
        .seed_entity("icalendar", Some("match-test@example.com"))
        .await
        .expect("Failed to seed entity");

    let uri = format!("/api/caldav/{collection_id}/match-test.ics");
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            &uri,
            "text/calendar",
            "\"real-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_test_service();

    // GET with wrong If-Match should return 412
    let response = TestRequest::get(&uri)
        .if_match("\"wrong-etag\"")
        .send(service)
        .await;

    response.assert_status(StatusCode::PRECONDITION_FAILED);
}

/// ## Summary
/// Test that If-Match with matching ETag returns 200.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn get_if_match_success() {
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
        .seed_entity("icalendar", Some("match-test-2@example.com"))
        .await
        .expect("Failed to seed entity");

    let uri = format!("/api/caldav/{collection_id}/match-test-2.ics");
    let etag = "\"correct-etag\"";
    let _instance_id = test_db
        .seed_instance(collection_id, entity_id, &uri, "text/calendar", etag, 1)
        .await
        .expect("Failed to seed instance");

    let service = create_test_service();

    // GET with correct If-Match should return 200
    let response = TestRequest::get(&uri).if_match(etag).send(service).await;

    response.assert_status(StatusCode::OK);
}

// ============================================================================
// Collection GET Tests
// ============================================================================

/// ## Summary
/// Test that GET on collection may return 405 or directory listing.
#[tokio::test]
async fn get_on_collection_path() {
    let service = create_test_service();

    // GET on a collection path
    let response =
        TestRequest::get("/api/caldav/00000000-0000-0000-0000-000000000001/")
            .send(service)
            .await;

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
#[tokio::test]
#[ignore = "requires database seeding"]
async fn get_last_modified_header() {
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
        .seed_entity("icalendar", Some("lm-test@example.com"))
        .await
        .expect("Failed to seed entity");

    let uri = format!("/api/caldav/{collection_id}/lm-test.ics");
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            &uri,
            "text/calendar",
            "\"lm-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_test_service();

    let response = TestRequest::get(&uri).send(service).await;

    response
        .assert_status(StatusCode::OK)
        .assert_header_exists("Last-Modified");
}

/// ## Summary
/// Test that Content-Length header matches actual body length.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn get_content_length_accurate() {
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
        .seed_entity("icalendar", Some("cl-test@example.com"))
        .await
        .expect("Failed to seed entity");

    let uri = format!("/api/caldav/{collection_id}/cl-test.ics");
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            &uri,
            "text/calendar",
            "\"cl-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_test_service();

    let response = TestRequest::get(&uri).send(service).await;

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
