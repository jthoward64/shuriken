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
#[test_log::test(tokio::test)]
async fn propfind_returns_multistatus() {
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
        .seed_collection(principal_id, "calendar", "testcal", Some("Personal"))
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::propfind(&caldav_collection_path("testuser", "testcal"))
        .depth("0")
        .xml_body(propfind_allprop())
        .send(&service)
        .await;

    response.assert_status(StatusCode::MULTI_STATUS);
}

/// ## Summary
/// Test that PROPFIND response is valid XML.
#[test_log::test(tokio::test)]
async fn propfind_returns_valid_xml() {
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
        .seed_collection(principal_id, "calendar", "testcal", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::propfind(&caldav_collection_path("testuser", "testcal"))
        .depth("0")
        .xml_body(propfind_allprop())
        .send(&service)
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
#[test_log::test(tokio::test)]
async fn propfind_depth0_collection() {
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
        .seed_collection(principal_id, "calendar", "testcal", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

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
                &format!("item-{i}"),
                "text/calendar",
                &format!("\"item-{i}\""),
                1,
            )
            .await
            .expect("Failed to seed instance");
    }

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::propfind(&caldav_collection_path("testuser", "testcal"))
        .depth("0")
        .xml_body(propfind_allprop())
        .send(&service)
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
#[test_log::test(tokio::test)]
async fn propfind_depth1_collection() {
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
        .seed_collection(principal_id, "calendar", "testcal", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

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
                &format!("item-{i}"),
                "text/calendar",
                &format!("\"item-{i}\""),
                1,
            )
            .await
            .expect("Failed to seed instance");
    }

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::propfind(&caldav_collection_path("testuser", "testcal"))
        .depth("1")
        .xml_body(propfind_allprop())
        .send(&service)
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
#[test_log::test(tokio::test)]
async fn propfind_depth_infinity() {
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
        .seed_collection(principal_id, "calendar", "testcal", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::propfind(&caldav_collection_path("testuser", "testcal"))
        .depth("infinity")
        .xml_body(propfind_allprop())
        .send(&service)
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
#[test_log::test(tokio::test)]
async fn propfind_default_depth() {
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
        .seed_collection(principal_id, "calendar", "testcal", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    // Send without Depth header
    let response = TestRequest::propfind(&caldav_collection_path("testuser", "testcal"))
        .xml_body(propfind_allprop())
        .send(&service)
        .await;

    // Should succeed with some default depth
    response.assert_status(StatusCode::MULTI_STATUS);
}

// ============================================================================
// Property Request Tests
// ============================================================================

/// ## Summary
/// Test that known properties return 200 propstat.
#[test_log::test(tokio::test)]
async fn propfind_known_props_200() {
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
            "calendar",
            "testcal",
            Some("Known Props Calendar"),
        )
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let props = propfind_props(&[("DAV:", "displayname"), ("DAV:", "resourcetype")]);
    let response = TestRequest::propfind(&caldav_collection_path("testuser", "testcal"))
        .depth("0")
        .xml_body(&props)
        .send(&service)
        .await;

    response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("200 OK")
        .assert_body_contains("displayname");
}

/// ## Summary
/// Test that unknown properties return 404 propstat.
#[test_log::test(tokio::test)]
async fn propfind_unknown_props_404() {
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
        .seed_collection(principal_id, "calendar", "testcal", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let props = propfind_props(&[("http://custom.example.com/", "nonexistent-property")]);
    let response = TestRequest::propfind(&caldav_collection_path("testuser", "testcal"))
        .depth("0")
        .xml_body(&props)
        .send(&service)
        .await;

    response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("404");
}

/// ## Summary
/// Test that mixed known/unknown properties return 207 with separate propstats.
#[test_log::test(tokio::test)]
async fn propfind_mixed_props() {
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
        .seed_collection(principal_id, "calendar", "testcal", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    // Request both a known and unknown property
    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:" xmlns:X="http://custom.example.com/">
  <D:prop>
    <D:displayname/>
    <X:nonexistent/>
  </D:prop>
</D:propfind>"#;

    let response = TestRequest::propfind(&caldav_collection_path("testuser", "testcal"))
        .depth("0")
        .xml_body(body)
        .send(&service)
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
#[test_log::test(tokio::test)]
async fn propfind_allprop_request() {
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
            "calendar",
            "testcal",
            Some("All Props Calendar"),
        )
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::propfind(&caldav_collection_path("testuser", "testcal"))
        .depth("0")
        .xml_body(propfind_allprop())
        .send(&service)
        .await;

    response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("displayname")
        .assert_body_contains("resourcetype");
}

/// ## Summary
/// Test that PROPFIND propname returns property names without values.
#[test_log::test(tokio::test)]
async fn propfind_propname() {
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
        .seed_collection(principal_id, "calendar", "testcal", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:propname/>
</D:propfind>"#;

    let response = TestRequest::propfind(&caldav_collection_path("testuser", "testcal"))
        .depth("0")
        .xml_body(body)
        .send(&service)
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
#[test_log::test(tokio::test)]
async fn propfind_calendar_resourcetype() {
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
        .seed_collection(principal_id, "calendar", "testcal", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let props = propfind_props(&[("DAV:", "resourcetype")]);
    let response = TestRequest::propfind(&caldav_collection_path("testuser", "testcal"))
        .depth("0")
        .xml_body(&props)
        .send(&service)
        .await;

    response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("collection")
        .assert_body_contains("calendar");
}

/// ## Summary
/// Test that addressbook collections advertise addressbook resource type.
#[test_log::test(tokio::test)]
async fn propfind_addressbook_resourcetype() {
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
        .seed_collection(principal_id, "addressbook", "addr", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "addressbook")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let props = propfind_props(&[("DAV:", "resourcetype")]);
    let response = TestRequest::propfind(&carddav_collection_path("testuser", "addr"))
        .depth("0")
        .xml_body(&props)
        .send(&service)
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
#[test_log::test(tokio::test)]
async fn propfind_getetag() {
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
        .seed_collection(principal_id, "calendar", "testcal", None)
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

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "etag-test",
            "text/calendar",
            "\"test-etag-123\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    let props = propfind_props(&[("DAV:", "getetag")]);
    let response = TestRequest::propfind(&caldav_collection_path("testuser", "testcal"))
        .depth("1")
        .xml_body(&props)
        .send(&service)
        .await;

    response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("getetag")
        .assert_body_contains("test-etag-123");
}

/// ## Summary
/// Test that PROPFIND returns sync-token for collections.
#[test_log::test(tokio::test)]
async fn propfind_sync_token() {
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
        .seed_collection(principal_id, "calendar", "testcal", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let props = propfind_props(&[("DAV:", "sync-token")]);
    let response = TestRequest::propfind(&caldav_collection_path("testuser", "testcal"))
        .depth("0")
        .xml_body(&props)
        .send(&service)
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
#[test_log::test(tokio::test)]
async fn propfind_nonexistent_404() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::propfind(&caldav_collection_path(
        "nonexistent-user",
        "nonexistent-cal",
    ))
    .depth("0")
    .xml_body(propfind_allprop())
    .send(&service)
    .await;

    response.assert_status(StatusCode::NOT_FOUND);
}

/// ## Summary
/// Test that PROPFIND with invalid XML returns 400.
#[test_log::test(tokio::test)]
async fn propfind_invalid_xml_400() {
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
        .seed_collection(principal_id, "calendar", "testcal", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::propfind(&caldav_collection_path("testuser", "testcal"))
        .depth("0")
        .xml_body("this is not valid xml <><><")
        .send(&service)
        .await;

    response.assert_status(StatusCode::BAD_REQUEST);
}

// ============================================================================
// RFC Compliance: Discovery Property Tests
// ============================================================================

/// ## Summary
/// Test that PROPFIND returns DAV:supported-report-set for calendar collections.
///
/// RFC 4791 §7: CalDAV servers MUST advertise supported REPORT methods.
#[test_log::test(tokio::test)]
async fn propfind_calendar_returns_supported_report_set() {
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
        .seed_collection(principal_id, "calendar", "testcal", Some("Test Calendar"))
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let prop_request = r#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:supported-report-set/>
  </D:prop>
</D:propfind>"#;

    let response = TestRequest::propfind(&caldav_collection_path("testuser", "testcal"))
        .depth("0")
        .xml_body(prop_request)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);

    let body = response.body_string();

    // RFC 4791 §7: MUST support calendar-query and calendar-multiget
    assert!(
        body.contains("calendar-query"),
        "Response should contain calendar-query report"
    );
    assert!(
        body.contains("calendar-multiget"),
        "Response should contain calendar-multiget report"
    );
    assert!(
        body.contains("sync-collection"),
        "Response should contain sync-collection report"
    );
}

/// ## Summary
/// Test that PROPFIND returns DAV:supported-report-set for addressbook collections.
///
/// RFC 6352 §3: CardDAV servers MUST advertise supported REPORT methods.
#[test_log::test(tokio::test)]
async fn propfind_addressbook_returns_supported_report_set() {
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
        .seed_collection(principal_id, "addressbook", "contacts", Some("My Contacts"))
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "addressbook")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let prop_request = r#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:supported-report-set/>
  </D:prop>
</D:propfind>"#;

    let response = TestRequest::propfind(&carddav_collection_path("testuser", "contacts"))
        .depth("0")
        .xml_body(prop_request)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);

    let body = response.body_string();

    // RFC 6352 §3: MUST support addressbook-query and addressbook-multiget
    assert!(
        body.contains("addressbook-query"),
        "Response should contain addressbook-query report"
    );
    assert!(
        body.contains("addressbook-multiget"),
        "Response should contain addressbook-multiget report"
    );
    assert!(
        body.contains("sync-collection"),
        "Response should contain sync-collection report"
    );
}

/// ## Summary
/// Test that PROPFIND returns CALDAV:supported-calendar-component-set.
///
/// RFC 4791 §5.2.3: Calendar collections MUST advertise supported component types.
#[test_log::test(tokio::test)]
async fn propfind_returns_supported_calendar_component_set() {
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
        .seed_collection(principal_id, "calendar", "testcal", Some("Test Calendar"))
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let prop_request = r#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <C:supported-calendar-component-set/>
  </D:prop>
</D:propfind>"#;

    let response = TestRequest::propfind(&caldav_collection_path("testuser", "testcal"))
        .depth("0")
        .xml_body(prop_request)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);

    let body = response.body_string();

    // RFC 4791 §5.2.3: Must list supported component types
    assert!(
        body.contains("VEVENT"),
        "Response should contain VEVENT component"
    );
    assert!(
        body.contains("VTODO"),
        "Response should contain VTODO component"
    );
    assert!(
        body.contains("VJOURNAL"),
        "Response should contain VJOURNAL component"
    );
}

/// ## Summary
/// Test that PROPFIND returns CARDDAV:supported-address-data.
///
/// RFC 6352 §6.2.2: Addressbook collections MUST advertise supported vCard versions.
#[test_log::test(tokio::test)]
async fn propfind_returns_supported_address_data() {
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
        .seed_collection(principal_id, "addressbook", "contacts", Some("My Contacts"))
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "addressbook")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let prop_request = r#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:" xmlns:CR="urn:ietf:params:xml:ns:carddav">
  <D:prop>
    <CR:supported-address-data/>
  </D:prop>
</D:propfind>"#;

    let response = TestRequest::propfind(&carddav_collection_path("testuser", "contacts"))
        .depth("0")
        .xml_body(prop_request)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);

    let body = response.body_string();

    // RFC 6352 §6.2.2: Must list supported vCard versions
    assert!(
        body.contains("version=\"3.0\""),
        "Response should contain vCard 3.0 support"
    );
    assert!(
        body.contains("version=\"4.0\""),
        "Response should contain vCard 4.0 support"
    );
    assert!(
        body.contains("text/vcard"),
        "Response should contain text/vcard content type"
    );
}

/// ## Summary
/// Test that PROPFIND returns CALDAV:supported-collation-set.
///
/// RFC 4791 §7.5.1: Calendar collections SHOULD advertise supported text collations.
#[test_log::test(tokio::test)]
async fn propfind_returns_supported_collation_set() {
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
        .seed_collection(principal_id, "calendar", "testcal", Some("Test Calendar"))
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let prop_request = r#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <C:supported-collation-set/>
  </D:prop>
</D:propfind>"#;

    let response = TestRequest::propfind(&caldav_collection_path("testuser", "testcal"))
        .depth("0")
        .xml_body(prop_request)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);

    let body = response.body_string();

    // RFC 4791 §7.5.1: Must list supported collations
    assert!(
        body.contains("i;octet"),
        "Response should contain i;octet collation"
    );
    assert!(
        body.contains("i;ascii-casemap"),
        "Response should contain i;ascii-casemap collation"
    );
    assert!(
        body.contains("i;unicode-casemap"),
        "Response should contain i;unicode-casemap collation"
    );
}
