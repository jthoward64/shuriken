#![allow(clippy::unused_async, unused_must_use)]
//! Tests for PROPFIND method.
//!
//! Verifies property retrieval, Depth handling, and multistatus responses.

use salvo::http::StatusCode;

use super::helpers::*;

// ============================================================================
// Basic PROPFIND Tests
// ============================================================================

/// ## Summary
/// Test that PROPFIND returns 207 Multi-Status.
#[tokio::test]
async fn propfind_returns_multistatus() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    let principal_id = test_db
        .seed_principal("user", "/principals/alice/", Some("Alice"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "testcal", Some("Personal"))
        .await
        .expect("Failed to seed collection");

    let service = create_test_service();

    let response = TestRequest::propfind(&format!("/api/caldav/{collection_id}/"))
        .depth("0")
        .xml_body(propfind_allprop())
        .send(service)
        .await;

    response.assert_status(StatusCode::MULTI_STATUS);
}

/// ## Summary
/// Test that PROPFIND response is valid XML.
#[tokio::test]
async fn propfind_returns_valid_xml() {
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

    let response = TestRequest::propfind(&format!("/api/caldav/{collection_id}/"))
        .depth("0")
        .xml_body(propfind_allprop())
        .send(service)
        .await;

    response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_valid_xml()
        .assert_header_contains("Content-Type", "xml");
}

// ============================================================================
// Depth Header Tests
// ============================================================================

/// ## Summary
/// Test that PROPFIND Depth:0 on a collection returns only the collection.
#[tokio::test]
async fn propfind_depth0_collection() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    let principal_id = test_db
        .seed_principal("user", "/principals/alice/", Some("Alice"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "testcal", None)
        .await
        .expect("Failed to seed collection");

    // Add some items to the collection
    for i in 0..3 {
        let entity_id = test_db
            .seed_entity("icalendar", Some(&format!("depth0-{i}@example.com")))
            .await
            .expect("Failed to seed entity");

        let _instance_id = test_db
            .seed_instance(
                collection_id,
                entity_id,
                &format!("/api/caldav/{collection_id}/item-{i}.ics"),
                "text/calendar",
                &format!("\"item-{i}\""),
                1,
            )
            .await
            .expect("Failed to seed instance");
    }

    let service = create_test_service();

    let response = TestRequest::propfind(&format!("/api/caldav/{collection_id}/"))
        .depth("0")
        .xml_body(propfind_allprop())
        .send(service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);

    // Should have exactly 1 response (just the collection)
    assert_eq!(
        response.count_multistatus_responses(),
        1,
        "Depth 0 should return only the collection"
    );
}

/// ## Summary
/// Test that PROPFIND Depth:1 returns collection and immediate members.
#[tokio::test]
async fn propfind_depth1_collection() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    let principal_id = test_db
        .seed_principal("user", "/principals/alice/", Some("Alice"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "testcal", None)
        .await
        .expect("Failed to seed collection");

    // Add 3 items to the collection
    for i in 0..3 {
        let entity_id = test_db
            .seed_entity("icalendar", Some(&format!("depth1-{i}@example.com")))
            .await
            .expect("Failed to seed entity");

        let _instance_id = test_db
            .seed_instance(
                collection_id,
                entity_id,
                &format!("/api/caldav/{collection_id}/item-{i}.ics"),
                "text/calendar",
                &format!("\"item-{i}\""),
                1,
            )
            .await
            .expect("Failed to seed instance");
    }

    let service = create_test_service();

    let response = TestRequest::propfind(&format!("/api/caldav/{collection_id}/"))
        .depth("1")
        .xml_body(propfind_allprop())
        .send(service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);

    // Should have 4 responses (collection + 3 items)
    assert_eq!(
        response.count_multistatus_responses(),
        4,
        "Depth 1 should return collection + 3 items"
    );
}

/// ## Summary
/// Test that PROPFIND Depth:infinity is rejected or supported consistently.
#[tokio::test]
async fn propfind_depth_infinity() {
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

    let response = TestRequest::propfind(&format!("/api/caldav/{collection_id}/"))
        .depth("infinity")
        .xml_body(propfind_allprop())
        .send(service)
        .await;

    // Either supported (207) or rejected (403)
    assert!(
        response.status == StatusCode::MULTI_STATUS || response.status == StatusCode::FORBIDDEN,
        "Depth infinity should return 207 or 403, got {}",
        response.status
    );
}

/// ## Summary
/// Test that missing Depth header defaults appropriately.
#[tokio::test]
async fn propfind_default_depth() {
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

    // Send without Depth header
    let response = TestRequest::propfind(&format!("/api/caldav/{collection_id}/"))
        .xml_body(propfind_allprop())
        .send(service)
        .await;

    // Should succeed with some default depth
    response.assert_status(StatusCode::MULTI_STATUS);
}

// ============================================================================
// Property Request Tests
// ============================================================================

/// ## Summary
/// Test that known properties return 200 propstat.
#[tokio::test]
async fn propfind_known_props_200() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    let principal_id = test_db
        .seed_principal("user", "/principals/alice/", Some("Alice"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(
            principal_id,
            "calendar",
            "testcal",
            Some("Known Props Calendar"),
        )
        .await
        .expect("Failed to seed collection");

    let service = create_test_service();

    let props = propfind_props(&[("DAV:", "displayname"), ("DAV:", "resourcetype")]);
    let response = TestRequest::propfind(&format!("/api/caldav/{collection_id}/"))
        .depth("0")
        .xml_body(&props)
        .send(service)
        .await;

    response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("200 OK")
        .assert_body_contains("displayname");
}

/// ## Summary
/// Test that unknown properties return 404 propstat.
#[tokio::test]
async fn propfind_unknown_props_404() {
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

    let props = propfind_props(&[("http://custom.example.com/", "nonexistent-property")]);
    let response = TestRequest::propfind(&format!("/api/caldav/{collection_id}/"))
        .depth("0")
        .xml_body(&props)
        .send(service)
        .await;

    response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("404");
}

/// ## Summary
/// Test that mixed known/unknown properties return 207 with separate propstats.
#[tokio::test]
async fn propfind_mixed_props() {
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

    // Request both a known and unknown property
    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:" xmlns:X="http://custom.example.com/">
  <D:prop>
    <D:displayname/>
    <X:nonexistent/>
  </D:prop>
</D:propfind>"#;

    let response = TestRequest::propfind(&format!("/api/caldav/{collection_id}/"))
        .depth("0")
        .xml_body(body)
        .send(service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);

    // Should have multiple propstats (one for 200, one for 404)
    let propstat_count = response.count_propstats();
    assert!(
        propstat_count >= 2,
        "Should have at least 2 propstats, got {propstat_count}"
    );
}

// ============================================================================
// AllProp Tests
// ============================================================================

/// ## Summary
/// Test that PROPFIND allprop returns reasonable set of properties.
#[tokio::test]
async fn propfind_allprop_request() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    let principal_id = test_db
        .seed_principal("user", "/principals/alice/", Some("Alice"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(
            principal_id,
            "calendar",
            "testcal",
            Some("All Props Calendar"),
        )
        .await
        .expect("Failed to seed collection");

    let service = create_test_service();

    let response = TestRequest::propfind(&format!("/api/caldav/{collection_id}/"))
        .depth("0")
        .xml_body(propfind_allprop())
        .send(service)
        .await;

    response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("displayname")
        .assert_body_contains("resourcetype");
}

/// ## Summary
/// Test that PROPFIND propname returns property names without values.
#[tokio::test]
async fn propfind_propname() {
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

    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:propname/>
</D:propfind>"#;

    let response = TestRequest::propfind(&format!("/api/caldav/{collection_id}/"))
        .depth("0")
        .xml_body(body)
        .send(service)
        .await;

    response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("displayname");
}

// ============================================================================
// Resource Type Tests
// ============================================================================

/// ## Summary
/// Test that calendar collections advertise calendar-access resource type.
#[tokio::test]
async fn propfind_calendar_resourcetype() {
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

    let props = propfind_props(&[("DAV:", "resourcetype")]);
    let response = TestRequest::propfind(&format!("/api/caldav/{collection_id}/"))
        .depth("0")
        .xml_body(&props)
        .send(service)
        .await;

    response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("collection")
        .assert_body_contains("calendar");
}

/// ## Summary
/// Test that addressbook collections advertise addressbook resource type.
#[tokio::test]
async fn propfind_addressbook_resourcetype() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    let principal_id = test_db
        .seed_principal("user", "/principals/bob/", Some("Bob"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(principal_id, "addressbook", "addr", None)
        .await
        .expect("Failed to seed collection");

    let service = create_test_service();

    let props = propfind_props(&[("DAV:", "resourcetype")]);
    let response = TestRequest::propfind(&format!("/api/carddav/{collection_id}/"))
        .depth("0")
        .xml_body(&props)
        .send(service)
        .await;

    response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("collection")
        .assert_body_contains("addressbook");
}

// ============================================================================
// ETag and Sync Token Tests
// ============================================================================

/// ## Summary
/// Test that PROPFIND returns getetag for resources.
#[tokio::test]
async fn propfind_getetag() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

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

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            &format!("/api/caldav/{collection_id}/etag-test.ics"),
            "text/calendar",
            "\"test-etag-123\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_test_service();

    let props = propfind_props(&[("DAV:", "getetag")]);
    let response = TestRequest::propfind(&format!("/api/caldav/{collection_id}/"))
        .depth("1")
        .xml_body(&props)
        .send(service)
        .await;

    response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("getetag")
        .assert_body_contains("test-etag-123");
}

/// ## Summary
/// Test that PROPFIND returns sync-token for collections.
#[tokio::test]
async fn propfind_sync_token() {
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

    let props = propfind_props(&[("DAV:", "sync-token")]);
    let response = TestRequest::propfind(&format!("/api/caldav/{collection_id}/"))
        .depth("0")
        .xml_body(&props)
        .send(service)
        .await;

    response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("sync-token");
}

// ============================================================================
// Error Cases
// ============================================================================

/// ## Summary
/// Test that PROPFIND on non-existent resource returns 404.
#[tokio::test]
async fn propfind_nonexistent_404() {
    let service = create_test_service();

    let response = TestRequest::propfind("/api/caldav/00000000-0000-0000-0000-000000000000/")
        .depth("0")
        .xml_body(propfind_allprop())
        .send(service)
        .await;

    response.assert_status(StatusCode::NOT_FOUND);
}

/// ## Summary
/// Test that PROPFIND with invalid XML returns 400.
#[tokio::test]
async fn propfind_invalid_xml_400() {
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

    let response = TestRequest::propfind(&format!("/api/caldav/{collection_id}/"))
        .depth("0")
        .xml_body("this is not valid xml <><><")
        .send(service)
        .await;

    response.assert_status(StatusCode::BAD_REQUEST);
}
