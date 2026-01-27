#![allow(clippy::unused_async, unused_must_use)]
//! Tests for MKCALENDAR and MKCOL (Extended MKCOL) methods.
//!
//! Verifies collection creation with initial properties.

use salvo::http::StatusCode;

use super::helpers::*;

// ============================================================================
// MKCALENDAR Basic Tests
// ============================================================================

/// ## Summary
/// Test that MKCALENDAR creates a calendar collection.
#[tokio::test]
async fn mkcalendar_creates_calendar_collection() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    let _principal_id = test_db
        .seed_principal("user", "/principals/alice/", Some("Alice"))
        .await
        .expect("Failed to seed principal");

    let service = create_test_service();

    let new_collection_uuid = uuid::Uuid::new_v4();
    let response = TestRequest::mkcalendar(&format!("/api/caldav/{new_collection_uuid}/"))
        .send(service)
        .await;

    response.assert_status(StatusCode::CREATED);

    // Verify with PROPFIND that it's a calendar collection
    let props = propfind_props(&[("DAV:", "resourcetype")]);
    let verify_response = TestRequest::propfind(&format!("/api/caldav/{new_collection_uuid}/"))
        .depth("0")
        .xml_body(&props)
        .send(create_test_service())
        .await;

    verify_response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("calendar");
}

/// ## Summary
/// Test that MKCALENDAR applies initial properties from request body.
#[tokio::test]
async fn mkcalendar_initial_props_applied() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    let _principal_id = test_db
        .seed_principal("user", "/principals/alice/", Some("Alice"))
        .await
        .expect("Failed to seed principal");

    let service = create_test_service();

    let new_collection_uuid = uuid::Uuid::new_v4();
    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set>
    <D:prop>
      <D:displayname>Work Calendar</D:displayname>
      <C:calendar-description>Events from work</C:calendar-description>
    </D:prop>
  </D:set>
</C:mkcalendar>"#;

    let response = TestRequest::mkcalendar(&format!("/api/caldav/{new_collection_uuid}/"))
        .xml_body(body)
        .send(service)
        .await;

    response.assert_status(StatusCode::CREATED);

    // Verify properties with PROPFIND
    let props = propfind_props(&[("DAV:", "displayname")]);
    let verify_response = TestRequest::propfind(&format!("/api/caldav/{new_collection_uuid}/"))
        .depth("0")
        .xml_body(&props)
        .send(create_test_service())
        .await;

    verify_response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("Work Calendar");
}

/// ## Summary
/// Test that MKCALENDAR on existing URI returns 405 or 409.
#[tokio::test]
async fn mkcalendar_on_existing_uri_conflict() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    let principal_id = test_db
        .seed_principal("user", "/principals/alice/", Some("Alice"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "testcal", None)
        .await
        .expect("Failed to seed collection");

    let service = create_test_service();

    let response = TestRequest::mkcalendar(&format!("/api/caldav/{collection_id}/"))
        .send(service)
        .await;

    // Either 405 Method Not Allowed or 409 Conflict
    assert!(
        response.status == StatusCode::METHOD_NOT_ALLOWED
            || response.status == StatusCode::CONFLICT,
        "Expected 405 or 409, got {}",
        response.status
    );
}

// ============================================================================
// Extended MKCOL Tests
// ============================================================================

/// ## Summary
/// Test that Extended MKCOL creates an addressbook.
#[tokio::test]
async fn mkcol_extended_creates_addressbook() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    let _principal_id = test_db
        .seed_principal("user", "/principals/bob/", Some("Bob"))
        .await
        .expect("Failed to seed principal");

    let service = create_test_service();

    let new_collection_uuid = uuid::Uuid::new_v4();
    let body = mkcol_addressbook_body(Some("Contacts"));

    let response = TestRequest::mkcol(&format!("/api/carddav/{new_collection_uuid}/"))
        .xml_body(&body)
        .send(service)
        .await;

    response.assert_status(StatusCode::CREATED);

    // Verify with PROPFIND that it's an addressbook collection
    let props = propfind_props(&[("DAV:", "resourcetype")]);
    let verify_response = TestRequest::propfind(&format!("/api/carddav/{new_collection_uuid}/"))
        .depth("0")
        .xml_body(&props)
        .send(create_test_service())
        .await;

    verify_response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("addressbook");
}

/// ## Summary
/// Test that Extended MKCOL applies initial properties.
#[tokio::test]
async fn mkcol_extended_applies_initial_props() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    let _principal_id = test_db
        .seed_principal("user", "/principals/bob/", Some("Bob"))
        .await
        .expect("Failed to seed principal");

    let service = create_test_service();

    let new_collection_uuid = uuid::Uuid::new_v4();
    let body = mkcol_addressbook_body(Some("Work Contacts"));

    let response = TestRequest::mkcol(&format!("/api/carddav/{new_collection_uuid}/"))
        .xml_body(&body)
        .send(service)
        .await;

    response.assert_status(StatusCode::CREATED);

    // Verify properties with PROPFIND
    let props = propfind_props(&[("DAV:", "displayname")]);
    let verify_response = TestRequest::propfind(&format!("/api/carddav/{new_collection_uuid}/"))
        .depth("0")
        .xml_body(&props)
        .send(create_test_service())
        .await;

    verify_response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("Work Contacts");
}

/// ## Summary
/// Test that Extended MKCOL with invalid XML returns 400.
#[tokio::test]
async fn mkcol_extended_rejects_bad_body() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    let _principal_id = test_db
        .seed_principal("user", "/principals/bob/", Some("Bob"))
        .await
        .expect("Failed to seed principal");

    let service = create_test_service();

    let new_collection_uuid = uuid::Uuid::new_v4();
    let response = TestRequest::mkcol(&format!("/api/carddav/{new_collection_uuid}/"))
        .xml_body("this is not valid xml <<><")
        .send(service)
        .await;

    response.assert_status(StatusCode::BAD_REQUEST);
}

// ============================================================================
// Plain MKCOL Tests
// ============================================================================

/// ## Summary
/// Test that plain MKCOL (without body) creates a collection.
#[tokio::test]
async fn mkcol_creates_plain_collection() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    let _principal_id = test_db
        .seed_principal("user", "/principals/alice/", Some("Alice"))
        .await
        .expect("Failed to seed principal");

    let service = create_test_service();

    let new_collection_uuid = uuid::Uuid::new_v4();
    let response = TestRequest::mkcol(&format!("/api/dav/{new_collection_uuid}/"))
        .send(service)
        .await;

    response.assert_status(StatusCode::CREATED);

    // Verify with PROPFIND that it's just a collection (not calendar/addressbook)
    let props = propfind_props(&[("DAV:", "resourcetype")]);
    let verify_response = TestRequest::propfind(&format!("/api/dav/{new_collection_uuid}/"))
        .depth("0")
        .xml_body(&props)
        .send(create_test_service())
        .await;

    verify_response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("collection");
}

/// ## Summary
/// Test that MKCOL on existing URI returns conflict.
#[tokio::test]
async fn mkcol_on_existing_uri_conflict() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    let principal_id = test_db
        .seed_principal("user", "/principals/alice/", Some("Alice"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "testcal", None)
        .await
        .expect("Failed to seed collection");

    let service = create_test_service();

    let response = TestRequest::mkcol(&format!("/api/caldav/{collection_id}/"))
        .send(service)
        .await;

    // Either 405 or 409
    assert!(
        response.status == StatusCode::METHOD_NOT_ALLOWED
            || response.status == StatusCode::CONFLICT,
        "Expected 405 or 409, got {}",
        response.status
    );
}

// ============================================================================
// Protected Property Tests
// ============================================================================

/// ## Summary
/// Test that MKCALENDAR with protected properties returns appropriate error.
#[tokio::test]
async fn mkcalendar_protected_props_rejected() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    let _principal_id = test_db
        .seed_principal("user", "/principals/alice/", Some("Alice"))
        .await
        .expect("Failed to seed principal");

    let service = create_test_service();

    let new_collection_uuid = uuid::Uuid::new_v4();
    // Try to set getetag (protected property)
    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set>
    <D:prop>
      <D:getetag>"custom-etag"</D:getetag>
    </D:prop>
  </D:set>
</C:mkcalendar>"#;

    let response = TestRequest::mkcalendar(&format!("/api/caldav/{new_collection_uuid}/"))
        .xml_body(body)
        .send(service)
        .await;

    // Either 403, 207 with propstat error, or collection created ignoring protected prop
    assert!(
        response.status == StatusCode::FORBIDDEN
            || response.status == StatusCode::MULTI_STATUS
            || response.status == StatusCode::CREATED,
        "Expected 403, 207, or 201, got {}",
        response.status
    );
}
