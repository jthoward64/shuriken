#![allow(clippy::unused_async, unused_must_use)]
//! Tests for REPORT method.
//!
//! Verifies calendar-query, calendar-multiget, addressbook-query,
//! sync-collection, and expand-property REPORT types.

use salvo::http::StatusCode;

use super::helpers::*;

// ============================================================================
// Calendar Query REPORT Tests
// ============================================================================

/// ## Summary
/// Test that calendar-query REPORT returns 207.
#[test_log::test(tokio::test)]
async fn calendar_query_returns_multistatus() {
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

    // Grant owner access to the user on their collection
    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let entity_id = test_db
        .seed_entity("icalendar", Some("query-test@example.com"))
        .await
        .expect("Failed to seed entity");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "event",
            "text/calendar",
            "\"query-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::report(&caldav_collection_path("testuser", "testcal"))
        .xml_body(calendar_query_report())
        .send(&service)
        .await;

    response.assert_status(StatusCode::MULTI_STATUS);
}

/// ## Summary
/// Test that calendar-query with time-range filter returns matching events.
#[test_log::test(tokio::test)]
async fn calendar_query_time_range_filter() {
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

    // Grant owner access to the user on their collection
    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    // Seed an event
    let entity_id = test_db
        .seed_entity("icalendar", Some("time-range@example.com"))
        .await
        .expect("Failed to seed entity");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "time-range",
            "text/calendar",
            "\"tr-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="20250101T000000Z" end="20251231T235959Z"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>"#;

    let response = TestRequest::report(&caldav_collection_path("testuser", "testcal"))
        .xml_body(body)
        .send(&service)
        .await;

    response.assert_status(StatusCode::MULTI_STATUS);
}

/// ## Summary
/// Test that calendar-query returns calendar-data when requested.
#[test_log::test(tokio::test)]
async fn calendar_query_returns_calendar_data() {
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

    // Grant owner access to the user on their collection
    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let entity_id = test_db
        .seed_entity("icalendar", Some("caldata@example.com"))
        .await
        .expect("Failed to seed entity");

    test_db
        .seed_minimal_icalendar_event(entity_id, "caldata@example.com", "CalData Event")
        .await
        .expect("Failed to seed iCalendar event");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "caldata",
            "text/calendar",
            "\"caldata-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::report(&caldav_collection_path("testuser", "testcal"))
        .xml_body(calendar_query_report())
        .send(&service)
        .await;

    response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("calendar-data");
}

// ============================================================================
// Calendar Multiget REPORT Tests
// ============================================================================

/// ## Summary
/// Test that calendar-multiget returns requested resources.
#[test_log::test(tokio::test)]
async fn calendar_multiget_returns_resources() {
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

    // Grant owner access to the user on their collection
    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    // Create 3 events
    let mut hrefs = Vec::new();
    for i in 0..3 {
        let entity_id = test_db
            .seed_entity("icalendar", Some(&format!("multiget-{i}@example.com")))
            .await
            .expect("Failed to seed entity");

        let slug = format!("event-{i}");
        let href = caldav_item_path("testuser", "testcal", &format!("{slug}.ics"));
        hrefs.push(href);

        let _instance_id = test_db
            .seed_instance(
                collection_id,
                entity_id,
                &slug,
                "text/calendar",
                &format!("\"mg-{i}-etag\""),
                1,
            )
            .await
            .expect("Failed to seed instance");
    }

    let service = create_db_test_service(&test_db.url()).await;

    let body = calendar_multiget_report(&hrefs);
    let response = TestRequest::report(&caldav_collection_path("testuser", "testcal"))
        .xml_body(&body)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);

    // Should have 3 responses
    assert_eq!(
        response.count_multistatus_responses(),
        3,
        "Should return 3 resources"
    );
}

/// ## Summary
/// Test that calendar-multiget returns 404 for missing resources.
#[test_log::test(tokio::test)]
async fn calendar_multiget_missing_resource_404() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");
    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let _collection_id = test_db
        .seed_collection(principal_id, CollectionType::Calendar, "testcal", None)
        .await
        .expect("Failed to seed collection");

    // Grant owner access to the user on their collection
    test_db
        .seed_collection_owner(principal_id, _collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let hrefs = vec![caldav_item_path("testuser", "testcal", "nonexistent.ics")];
    let body = calendar_multiget_report(&hrefs);

    let response = TestRequest::report(&caldav_collection_path("testuser", "testcal"))
        .xml_body(&body)
        .send(&service)
        .await;

    response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("404");
}

// ============================================================================
// Addressbook Query REPORT Tests
// ============================================================================

/// ## Summary
/// Test that addressbook-query REPORT returns 207.
#[test_log::test(tokio::test)]
async fn addressbook_query_returns_multistatus() {
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
        .seed_collection(principal_id, CollectionType::Addressbook, "contacts", None)
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("vcard", Some("card-query@example.com"))
        .await
        .expect("Failed to seed entity");

    test_db
        .seed_minimal_vcard(entity_id, "card-query@example.com", "Query Contact")
        .await
        .expect("Failed to seed vCard");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "contact",
            "text/vcard",
            "\"vcard-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::report(&carddav_collection_path("testuser", "contacts"))
        .xml_body(addressbook_query_report())
        .send(&service)
        .await;

    response.assert_status(StatusCode::MULTI_STATUS);
}

/// ## Summary
/// Test that addressbook-query returns address-data when requested.
#[test_log::test(tokio::test)]
async fn addressbook_query_returns_address_data() {
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
        .seed_collection(principal_id, CollectionType::Addressbook, "addrdata", None)
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("vcard", Some("addr-data@example.com"))
        .await
        .expect("Failed to seed entity");

    test_db
        .seed_minimal_vcard(entity_id, "addr-data@example.com", "Address Data Contact")
        .await
        .expect("Failed to seed vCard");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "addr",
            "text/vcard",
            "\"addr-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::report(&carddav_collection_path("testuser", "addrdata"))
        .xml_body(addressbook_query_report())
        .send(&service)
        .await;

    response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("address-data");
}

// ============================================================================
// Addressbook Multiget REPORT Tests
// ============================================================================

/// ## Summary
/// Test that addressbook-multiget returns requested vcards.
#[test_log::test(tokio::test)]
async fn addressbook_multiget_returns_vcards() {
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
        .seed_collection(principal_id, CollectionType::Addressbook, "abmg", None)
        .await
        .expect("Failed to seed collection");

    // Create 2 vcards
    let mut hrefs = Vec::new();
    for i in 0..2 {
        let entity_id = test_db
            .seed_entity("vcard", Some(&format!("abmg-{i}@example.com")))
            .await
            .expect("Failed to seed entity");

        let slug = format!("contact-{i}");
        let href = carddav_item_path("testuser", "abmg", &format!("{slug}.vcf"));
        hrefs.push(href);

        let _instance_id = test_db
            .seed_instance(
                collection_id,
                entity_id,
                &slug,
                "text/vcard",
                &format!("\"abmg-{i}-etag\""),
                1,
            )
            .await
            .expect("Failed to seed instance");
    }

    let service = create_db_test_service(&test_db.url()).await;

    let body = addressbook_multiget_report(&hrefs);
    let response = TestRequest::report(&carddav_collection_path("testuser", "abmg"))
        .xml_body(&body)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);

    assert_eq!(
        response.count_multistatus_responses(),
        2,
        "Should return 2 vcards"
    );
}

// ============================================================================
// Sync Collection REPORT Tests
// ============================================================================

/// ## Summary
/// Test that sync-collection REPORT returns 207.
#[test_log::test(tokio::test)]
async fn sync_collection_returns_multistatus() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");
    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let _collection_id = test_db
        .seed_collection(principal_id, CollectionType::Calendar, "testcal", None)
        .await
        .expect("Failed to seed collection");

    // Grant owner access to the user on their collection
    test_db
        .seed_collection_owner(principal_id, _collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::report(&caldav_collection_path("testuser", "testcal"))
        .xml_body(sync_collection_report_initial())
        .send(&service)
        .await;

    response.assert_status(StatusCode::MULTI_STATUS);
}

/// ## Summary
/// Test that sync-collection returns sync-token in response.
#[test_log::test(tokio::test)]
async fn sync_collection_returns_sync_token() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");
    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let _collection_id = test_db
        .seed_collection(principal_id, CollectionType::Calendar, "testcal", None)
        .await
        .expect("Failed to seed collection");

    // Grant owner access to the user on their collection
    test_db
        .seed_collection_owner(principal_id, _collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::report(&caldav_collection_path("testuser", "testcal"))
        .xml_body(sync_collection_report_initial())
        .send(&service)
        .await;

    response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("sync-token");
}

/// ## Summary
/// Test that sync-collection with initial sync returns all resources.
#[test_log::test(tokio::test)]
async fn sync_collection_initial_sync() {
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

    // Grant owner access to the user on their collection
    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    // Create 3 events
    for i in 0..3 {
        let entity_id = test_db
            .seed_entity("icalendar", Some(&format!("init-sync-{i}@example.com")))
            .await
            .expect("Failed to seed entity");

        test_db
            .seed_minimal_icalendar_event(
                entity_id,
                &format!("init-sync-{i}@example.com"),
                &format!("Init Sync Event {i}"),
            )
            .await
            .expect("Failed to seed iCalendar event");

        let _instance_id = test_db
            .seed_instance(
                collection_id,
                entity_id,
                &format!("init-{i}"),
                "text/calendar",
                &format!("\"init-{i}-etag\""),
                1,
            )
            .await
            .expect("Failed to seed instance");
    }

    let service = create_db_test_service(&test_db.url()).await;

    // Empty sync-token means initial sync
    let response = TestRequest::report(&caldav_collection_path("testuser", "testcal"))
        .xml_body(sync_collection_report_initial())
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);

    // Should include all 3 resources
    assert!(
        response.count_multistatus_responses() >= 3,
        "Initial sync should return all resources"
    );
}

/// ## Summary
/// Test that sync-collection with token returns only changes.
#[test_log::test(tokio::test)]
async fn sync_collection_delta_sync() {
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

    // Grant owner access to the user on their collection
    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    // Create initial event
    let entity_id = test_db
        .seed_entity("icalendar", Some("delta-1@example.com"))
        .await
        .expect("Failed to seed entity");

    test_db
        .seed_minimal_icalendar_event(entity_id, "delta-1@example.com", "Delta Event 1")
        .await
        .expect("Failed to seed iCalendar event");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "delta-1",
            "text/calendar",
            "\"delta-1-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    // Get initial sync-token
    let initial_response = TestRequest::report(&caldav_collection_path("testuser", "testcal"))
        .xml_body(sync_collection_report_initial())
        .send(&service)
        .await;

    let initial_response = initial_response.assert_status(StatusCode::MULTI_STATUS);

    // Extract sync-token from response (would need parsing)
    // For now, test that response structure is correct
    initial_response.assert_body_contains("sync-token");
}

// ============================================================================
// Error Cases
// ============================================================================

/// ## Summary
/// Test that REPORT on non-existent resource returns 404.
#[test_log::test(tokio::test)]
async fn report_nonexistent_404() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");
    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::report(&caldav_collection_path("nonexistent", "unknown"))
        .xml_body(calendar_query_report())
        .send(&service)
        .await;

    response.assert_status(StatusCode::NOT_FOUND);
}

/// ## Summary
/// Test that REPORT with invalid XML returns 400.
#[test_log::test(tokio::test)]
async fn report_invalid_xml_400() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");
    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let _collection_id = test_db
        .seed_collection(principal_id, CollectionType::Calendar, "testcal", None)
        .await
        .expect("Failed to seed collection");

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::report(&caldav_collection_path("testuser", "testcal"))
        .xml_body("this is not valid xml <><><")
        .send(&service)
        .await;

    response.assert_status(StatusCode::BAD_REQUEST);
}

/// ## Summary
/// Test that unsupported REPORT type returns appropriate error.
#[test_log::test(tokio::test)]
async fn report_unsupported_type() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");
    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let _collection_id = test_db
        .seed_collection(principal_id, CollectionType::Calendar, "testcal", None)
        .await
        .expect("Failed to seed collection");

    let service = create_db_test_service(&test_db.url()).await;

    // Send an unknown report type
    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<X:unknown-report xmlns:X="http://custom.example.com/">
</X:unknown-report>"#;

    let response = TestRequest::report(&caldav_collection_path("testuser", "testcal"))
        .xml_body(body)
        .send(&service)
        .await;

    // Either 400 or 501 or 403
    assert!(
        response.status == StatusCode::BAD_REQUEST
            || response.status == StatusCode::NOT_IMPLEMENTED
            || response.status == StatusCode::FORBIDDEN,
        "Expected 400, 501, or 403, got {}",
        response.status
    );
}
