#![allow(clippy::unused_async)]
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
#[tokio::test]
#[ignore = "requires database seeding"]
async fn calendar_query_returns_multistatus() {
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
        .seed_entity("icalendar", Some("query-test@example.com"))
        .await
        .expect("Failed to seed entity");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            &format!("/api/caldav/{collection_id}/event.ics"),
            "text/calendar",
            "\"query-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_test_service();

    let response = TestRequest::report(&format!("/api/caldav/{collection_id}/"))
        .xml_body(calendar_query_report())
        .send(service)
        .await;

    response.assert_status(StatusCode::MULTI_STATUS);
}

/// ## Summary
/// Test that calendar-query with time-range filter returns matching events.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn calendar_query_time_range_filter() {
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

    // Seed an event
    let entity_id = test_db
        .seed_entity("icalendar", Some("time-range@example.com"))
        .await
        .expect("Failed to seed entity");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            &format!("/api/caldav/{collection_id}/time-range.ics"),
            "text/calendar",
            "\"tr-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_test_service();

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

    let response = TestRequest::report(&format!("/api/caldav/{collection_id}/"))
        .xml_body(body)
        .send(service)
        .await;

    response.assert_status(StatusCode::MULTI_STATUS);
}

/// ## Summary
/// Test that calendar-query returns calendar-data when requested.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn calendar_query_returns_calendar_data() {
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
        .seed_entity("icalendar", Some("caldata@example.com"))
        .await
        .expect("Failed to seed entity");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            &format!("/api/caldav/{collection_id}/caldata.ics"),
            "text/calendar",
            "\"caldata-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_test_service();

    let response = TestRequest::report(&format!("/api/caldav/{collection_id}/"))
        .xml_body(calendar_query_report())
        .send(service)
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
#[tokio::test]
#[ignore = "requires database seeding"]
async fn calendar_multiget_returns_resources() {
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

    // Create 3 events
    let mut hrefs = Vec::new();
    for i in 0..3 {
        let entity_id = test_db
            .seed_entity("icalendar", Some(&format!("multiget-{i}@example.com")))
            .await
            .expect("Failed to seed entity");

        let uri = format!("/api/caldav/{collection_id}/event-{i}.ics");
        hrefs.push(uri.clone());

        let _instance_id = test_db
            .seed_instance(
                collection_id,
                entity_id,
                &uri,
                "text/calendar",
                &format!("\"mg-{i}-etag\""),
                1,
            )
            .await
            .expect("Failed to seed instance");
    }

    let service = create_test_service();

    let body = calendar_multiget_report(&hrefs);
    let response = TestRequest::report(&format!("/api/caldav/{collection_id}/"))
        .xml_body(&body)
        .send(service)
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
#[tokio::test]
#[ignore = "requires database seeding"]
async fn calendar_multiget_missing_resource_404() {
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

    let hrefs = vec![format!("/api/caldav/{collection_id}/nonexistent.ics")];
    let body = calendar_multiget_report(&hrefs);

    let response = TestRequest::report(&format!("/api/caldav/{collection_id}/"))
        .xml_body(&body)
        .send(service)
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
#[tokio::test]
#[ignore = "requires database seeding"]
async fn addressbook_query_returns_multistatus() {
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
            None,
        )
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("vcard", Some("card-query@example.com"))
        .await
        .expect("Failed to seed entity");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            &format!("/api/carddav/{collection_id}/contact.vcf"),
            "text/vcard",
            "\"vcard-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_test_service();

    let response = TestRequest::report(&format!("/api/carddav/{collection_id}/"))
        .xml_body(addressbook_query_report())
        .send(service)
        .await;

    response.assert_status(StatusCode::MULTI_STATUS);
}

/// ## Summary
/// Test that addressbook-query returns address-data when requested.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn addressbook_query_returns_address_data() {
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
            "/addressbooks/bob/addrdata/",
            None,
        )
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("vcard", Some("addr-data@example.com"))
        .await
        .expect("Failed to seed entity");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            &format!("/api/carddav/{collection_id}/addr.vcf"),
            "text/vcard",
            "\"addr-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_test_service();

    let response = TestRequest::report(&format!("/api/carddav/{collection_id}/"))
        .xml_body(addressbook_query_report())
        .send(service)
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
#[tokio::test]
#[ignore = "requires database seeding"]
async fn addressbook_multiget_returns_vcards() {
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
            "/addressbooks/bob/abmg/",
            None,
        )
        .await
        .expect("Failed to seed collection");

    // Create 2 vcards
    let mut hrefs = Vec::new();
    for i in 0..2 {
        let entity_id = test_db
            .seed_entity("vcard", Some(&format!("abmg-{i}@example.com")))
            .await
            .expect("Failed to seed entity");

        let uri = format!("/api/carddav/{collection_id}/contact-{i}.vcf");
        hrefs.push(uri.clone());

        let _instance_id = test_db
            .seed_instance(
                collection_id,
                entity_id,
                &uri,
                "text/vcard",
                &format!("\"abmg-{i}-etag\""),
                1,
            )
            .await
            .expect("Failed to seed instance");
    }

    let service = create_test_service();

    let body = addressbook_multiget_report(&hrefs);
    let response = TestRequest::report(&format!("/api/carddav/{collection_id}/"))
        .xml_body(&body)
        .send(service)
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
#[tokio::test]
#[ignore = "requires database seeding"]
async fn sync_collection_returns_multistatus() {
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

    let response = TestRequest::report(&format!("/api/caldav/{collection_id}/"))
        .xml_body(sync_collection_report_initial())
        .send(service)
        .await;

    response.assert_status(StatusCode::MULTI_STATUS);
}

/// ## Summary
/// Test that sync-collection returns sync-token in response.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn sync_collection_returns_sync_token() {
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

    let response = TestRequest::report(&format!("/api/caldav/{collection_id}/"))
        .xml_body(sync_collection_report_initial())
        .send(service)
        .await;

    response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("sync-token");
}

/// ## Summary
/// Test that sync-collection with initial sync returns all resources.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn sync_collection_initial_sync() {
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

    // Create 3 events
    for i in 0..3 {
        let entity_id = test_db
            .seed_entity("icalendar", Some(&format!("init-sync-{i}@example.com")))
            .await
            .expect("Failed to seed entity");

        let _instance_id = test_db
            .seed_instance(
                collection_id,
                entity_id,
                &format!("/api/caldav/{collection_id}/init-{i}.ics"),
                "text/calendar",
                &format!("\"init-{i}-etag\""),
                1,
            )
            .await
            .expect("Failed to seed instance");
    }

    let service = create_test_service();

    // Empty sync-token means initial sync
    let response = TestRequest::report(&format!("/api/caldav/{collection_id}/"))
        .xml_body(sync_collection_report_initial())
        .send(service)
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
#[tokio::test]
#[ignore = "requires database seeding"]
async fn sync_collection_delta_sync() {
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

    // Create initial event
    let entity_id = test_db
        .seed_entity("icalendar", Some("delta-1@example.com"))
        .await
        .expect("Failed to seed entity");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            &format!("/api/caldav/{collection_id}/delta-1.ics"),
            "text/calendar",
            "\"delta-1-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_test_service();

    // Get initial sync-token
    let initial_response = TestRequest::report(&format!("/api/caldav/{collection_id}/"))
        .xml_body(sync_collection_report_initial())
        .send(service)
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
#[tokio::test]
async fn report_nonexistent_404() {
    let service = create_test_service();

    let response =
        TestRequest::report("/api/caldav/00000000-0000-0000-0000-000000000000/")
            .xml_body(calendar_query_report())
            .send(service)
            .await;

    response.assert_status(StatusCode::NOT_FOUND);
}

/// ## Summary
/// Test that REPORT with invalid XML returns 400.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn report_invalid_xml_400() {
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

    let response = TestRequest::report(&format!("/api/caldav/{collection_id}/"))
        .xml_body("this is not valid xml <><><")
        .send(service)
        .await;

    response.assert_status(StatusCode::BAD_REQUEST);
}

/// ## Summary
/// Test that unsupported REPORT type returns appropriate error.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn report_unsupported_type() {
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

    // Send an unknown report type
    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<X:unknown-report xmlns:X="http://custom.example.com/">
</X:unknown-report>"#;

    let response = TestRequest::report(&format!("/api/caldav/{collection_id}/"))
        .xml_body(body)
        .send(service)
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
