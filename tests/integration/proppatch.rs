#![allow(clippy::unused_async, unused_must_use)]
//! Tests for PROPPATCH method.
//!
//! Verifies property modification, protected properties, and partial success handling.

use salvo::http::StatusCode;

use super::helpers::*;

// ============================================================================
// Basic PROPPATCH Tests
// ============================================================================

/// ## Summary
/// Test that PROPPATCH returns 207 Multi-Status.
#[tokio::test]
async fn proppatch_returns_multistatus() {
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

    let body = proppatch_set(&[("DAV:", "displayname", "New Name")]);
    let response = TestRequest::proppatch(&format!("/api/caldav/{collection_id}/"))
        .xml_body(&body)
        .send(service)
        .await;

    response.assert_status(StatusCode::MULTI_STATUS);
}

// ============================================================================
// Protected Property Tests
// ============================================================================

/// ## Summary
/// Test that attempting to set a protected property returns 403.
#[tokio::test]
async fn proppatch_set_protected_prop_403() {
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

    // resourcetype is a protected property
    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <D:resourcetype><D:collection/></D:resourcetype>
    </D:prop>
  </D:set>
</D:propertyupdate>"#;

    let response = TestRequest::proppatch(&format!("/api/caldav/{collection_id}/"))
        .xml_body(body)
        .send(service)
        .await;

    response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("403");
}

/// ## Summary
/// Test that attempting to remove a protected property returns 403.
#[tokio::test]
async fn proppatch_remove_protected_prop_403() {
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

    // getetag is a protected property
    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:">
  <D:remove>
    <D:prop>
      <D:getetag/>
    </D:prop>
  </D:remove>
</D:propertyupdate>"#;

    let response = TestRequest::proppatch(&format!("/api/caldav/{collection_id}/"))
        .xml_body(body)
        .send(service)
        .await;

    response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("403");
}

// ============================================================================
// Writable Property Tests
// ============================================================================

/// ## Summary
/// Test that setting DAV:displayname succeeds and persists.
#[tokio::test]
async fn proppatch_set_displayname_200() {
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

    let body = proppatch_set(&[("DAV:", "displayname", "My Work Calendar")]);
    let response = TestRequest::proppatch(&format!("/api/caldav/{collection_id}/"))
        .xml_body(&body)
        .send(service)
        .await;

    response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("200");

    // Verify persistence with PROPFIND
    let props = propfind_props(&[("DAV:", "displayname")]);
    let verify_response = TestRequest::propfind(&format!("/api/caldav/{collection_id}/"))
        .depth("0")
        .xml_body(&props)
        .send(create_test_service())
        .await;

    verify_response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("My Work Calendar");
}

/// ## Summary
/// Test that setting calendar-description property succeeds.
#[tokio::test]
async fn proppatch_set_calendar_description() {
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

    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set>
    <D:prop>
      <C:calendar-description>My important calendar</C:calendar-description>
    </D:prop>
  </D:set>
</D:propertyupdate>"#;

    let response = TestRequest::proppatch(&format!("/api/caldav/{collection_id}/"))
        .xml_body(body)
        .send(service)
        .await;

    response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("200");
}

/// ## Summary
/// Test that removing a writable property succeeds.
#[tokio::test]
async fn proppatch_remove_displayname() {
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
        .seed_collection(principal_id, "calendar", "testcal", Some("Original Name"))
        .await
        .expect("Failed to seed collection");

    let service = create_test_service();

    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:">
  <D:remove>
    <D:prop>
      <D:displayname/>
    </D:prop>
  </D:remove>
</D:propertyupdate>"#;

    let response = TestRequest::proppatch(&format!("/api/caldav/{collection_id}/"))
        .xml_body(body)
        .send(service)
        .await;

    response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("200");
}

/// ## Summary
/// Test that setting multiple properties in one request works.
#[tokio::test]
async fn proppatch_set_multiple_props() {
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

    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set>
    <D:prop>
      <D:displayname>Work Events</D:displayname>
      <C:calendar-description>All work-related events</C:calendar-description>
    </D:prop>
  </D:set>
</D:propertyupdate>"#;

    let response = TestRequest::proppatch(&format!("/api/caldav/{collection_id}/"))
        .xml_body(body)
        .send(service)
        .await;

    response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("200");
}

// ============================================================================
// Partial Success Tests
// ============================================================================

/// ## Summary
/// Test that partial success is handled correctly.
#[tokio::test]
async fn proppatch_partial_success_207() {
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

    // Mix writable (displayname) and protected (resourcetype) properties
    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <D:displayname>Partially Updated</D:displayname>
      <D:resourcetype><D:collection/></D:resourcetype>
    </D:prop>
  </D:set>
</D:propertyupdate>"#;

    let response = TestRequest::proppatch(&format!("/api/caldav/{collection_id}/"))
        .xml_body(body)
        .send(service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);

    // Should have multiple propstats (200 for displayname, 403 for resourcetype)
    let propstat_count = response.count_propstats();
    assert!(
        propstat_count >= 2,
        "Should have at least 2 propstats, got {propstat_count}"
    );
}

// ============================================================================
// Error Cases
// ============================================================================

/// ## Summary
/// Test that PROPPATCH on non-existent resource returns 404.
#[tokio::test]
async fn proppatch_nonexistent_404() {
    let service = create_test_service();

    let body = proppatch_set(&[("DAV:", "displayname", "Test")]);
    let response = TestRequest::proppatch("/api/caldav/00000000-0000-0000-0000-000000000000/")
        .xml_body(&body)
        .send(service)
        .await;

    response.assert_status(StatusCode::NOT_FOUND);
}

/// ## Summary
/// Test that PROPPATCH with invalid XML returns 400.
#[tokio::test]
async fn proppatch_invalid_xml_400() {
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

    let response = TestRequest::proppatch(&format!("/api/caldav/{collection_id}/"))
        .xml_body("this is not valid xml <><><")
        .send(service)
        .await;

    response.assert_status(StatusCode::BAD_REQUEST);
}

/// ## Summary
/// Test that PROPPATCH without body returns appropriate error.
#[tokio::test]
async fn proppatch_empty_body_error() {
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

    let response = TestRequest::proppatch(&format!("/api/caldav/{collection_id}/"))
        .send(service)
        .await;

    // Either 400 Bad Request or 415 Unsupported Media Type
    assert!(
        response.status == StatusCode::BAD_REQUEST
            || response.status == StatusCode::UNSUPPORTED_MEDIA_TYPE,
        "Expected 400 or 415, got {}",
        response.status
    );
}
