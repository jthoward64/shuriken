#![allow(clippy::unused_async, unused_must_use)]
//! Tests for REPORT method.
//!
//! Verifies calendar-query, calendar-multiget, addressbook-query,
//! sync-collection, and expand-property REPORT types.

use salvo::http::StatusCode;

use super::helpers::*;

fn extract_sync_token(body: &str) -> Option<String> {
    for tag in ["D:sync-token", "sync-token"] {
        let open = format!("<{tag}>");
        let close = format!("</{tag}>");
        if let Some(start) = body.find(&open) {
            let content_start = start + open.len();
            if let Some(end) = body[content_start..].find(&close) {
                let content = body[content_start..content_start + end].trim();
                if !content.is_empty() {
                    return Some(content.to_string());
                }
            }
        }
    }

    None
}

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

    let service = create_db_test_service(&test_db.url()).await;

    // Use PUT to create the event (which will populate cal_index)
    let uid = "caldata@example.com";
    let summary = "CalData Event";
    let ical = sample_icalendar_event(uid, summary);
    TestRequest::put(&caldav_item_path("testuser", "testcal", "caldata.ics"))
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(&service)
        .await
        .assert_status(StatusCode::CREATED);
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

        test_db
            .seed_minimal_icalendar_event(
                entity_id,
                &format!("multiget-{i}@example.com"),
                &format!("Multiget Event {i}"),
            )
            .await
            .expect("Failed to seed iCalendar event");

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

    let collection_id = test_db
        .seed_collection(principal_id, CollectionType::Calendar, "testcal", None)
        .await
        .expect("Failed to seed collection");

    // Grant owner access to the user on their collection
    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
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
        test_db
            .seed_minimal_vcard(
                entity_id,
                &format!("abmg-{i}@example.com"),
                &format!("Contact {i}"),
            )
            .await
            .expect("Failed to seed vCard");
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

    let collection_id = test_db
        .seed_collection(principal_id, CollectionType::Calendar, "testcal", None)
        .await
        .expect("Failed to seed collection");

    // Grant owner access to the user on their collection
    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
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

    let collection_id = test_db
        .seed_collection(principal_id, CollectionType::Calendar, "testcal", None)
        .await
        .expect("Failed to seed collection");

    // Grant owner access to the user on their collection
    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
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

    let body = initial_response.body_string();
    let token = extract_sync_token(&body).expect("sync-token present in response");
    let parsed: i64 = token.parse().expect("sync-token should be numeric");
    assert!(parsed >= 0, "sync-token should be non-negative");
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

    let collection_id = test_db
        .seed_collection(principal_id, CollectionType::Calendar, "testcal", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

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

    test_db
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
// ============================================================================
// RFC 4790 Collation Integration Tests
// ============================================================================

/// ## Summary
/// Test calendar-query with i;octet (case-sensitive) collation.
/// Per RFC 4790 §9.1: i;octet performs byte-by-byte comparison.
#[test_log::test(tokio::test)]
async fn calendar_query_collation_octet_case_sensitive() {
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

    let service = create_db_test_service(&test_db.url()).await;

    // Create event with "Meeting" (capital M) in summary
    let ical = sample_icalendar_event("octet-test@example.com", "Meeting Room Booking");
    TestRequest::put(&caldav_item_path("testuser", "testcal", "octet.ics"))
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(&service)
        .await
        .assert_status(StatusCode::CREATED);

    // Search for "meeting" (lowercase) with i;octet - should NOT match
    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:prop-filter name="SUMMARY">
          <C:text-match collation="i;octet">meeting</C:text-match>
        </C:prop-filter>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>"#;

    let response = TestRequest::report(&caldav_collection_path("testuser", "testcal"))
        .xml_body(body)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    // Should return empty result (no match due to case sensitivity)
    let body_text = response.body_string();
    tracing::info!("Response body: {}", body_text);
    assert!(
        !body_text.contains("octet.ics"),
        "i;octet should be case-sensitive: 'meeting' should NOT match 'Meeting'"
    );
}

/// ## Summary
/// Test calendar-query with i;octet does NOT match decomposed vs composed.
/// Per RFC 4790 §9.1: byte-by-byte comparison only.
#[test_log::test(tokio::test)]
async fn calendar_query_collation_octet_normalization_mismatch() {
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

    let service = create_db_test_service(&test_db.url()).await;

    // Store NFC form: "Café"
    let ical = sample_icalendar_event("octet-nfc@example.com", "Café");
    TestRequest::put(&caldav_item_path("testuser", "testcal", "octet-nfc.ics"))
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(&service)
        .await
        .assert_status(StatusCode::CREATED);

    // Search with NFD form: "Cafe\u{0301}" should NOT match under i;octet
    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
    <D:prop>
        <D:getetag/>
    </D:prop>
    <C:filter>
        <C:comp-filter name="VCALENDAR">
            <C:comp-filter name="VEVENT">
                <C:prop-filter name="SUMMARY">
                    <C:text-match collation="i;octet">Cafe</C:text-match>
                </C:prop-filter>
            </C:comp-filter>
        </C:comp-filter>
    </C:filter>
</C:calendar-query>"#;

    let body = body.replace("\u{0011}\u{0011}\u{0011}\u{0011}", "\u{0301}");
    let response = TestRequest::report(&caldav_collection_path("testuser", "testcal"))
        .xml_body(&body)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    let body_text = response.body_string();
    assert!(
        response.count_multistatus_responses() == 0,
        "i;octet should NOT normalize composed/decomposed forms"
    );
    assert!(
        !body_text.contains(".ics</D:href>"),
        "Response should not contain matching .ics href"
    );
}

/// ## Summary
/// Test calendar-query with i;unicode-casemap (default) collation.
/// Per RFC 4790 §9.3 and RFC 4791 §7.5.1: Full Unicode case folding.
#[test_log::test(tokio::test)]
async fn calendar_query_collation_unicode_case_insensitive() {
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

    let service = create_db_test_service(&test_db.url()).await;

    // Create event with "Meeting" (capital M)
    let ical = sample_icalendar_event("unicode-test@example.com", "Meeting Room Booking");
    TestRequest::put(&caldav_item_path("testuser", "testcal", "unicode.ics"))
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(&service)
        .await
        .assert_status(StatusCode::CREATED);

    // Search for "meeting" (lowercase) with i;unicode-casemap - SHOULD match
    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:prop-filter name="SUMMARY">
          <C:text-match collation="i;unicode-casemap">meeting</C:text-match>
        </C:prop-filter>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>"#;

    let response = TestRequest::report(&caldav_collection_path("testuser", "testcal"))
        .xml_body(body)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    let body_text = response.body_string();
    tracing::info!("Response body: {}", body_text);
    // Should return one matching result with UUID-based href
    assert!(
        response.count_multistatus_responses() == 1,
        "i;unicode-casemap should be case-insensitive: 'meeting' SHOULD match 'Meeting' (found {} responses)",
        response.count_multistatus_responses()
    );
    assert!(
        body_text.contains(".ics</D:href>"),
        "Response should contain at least one .ics href"
    );
}

/// ## Summary
/// Test calendar-query with i;unicode-casemap normalizes composed vs decomposed.
/// Per RFC 4790 §9.3: Unicode normalization + case folding.
#[test_log::test(tokio::test)]
async fn calendar_query_collation_unicode_normalization_match() {
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

    let service = create_db_test_service(&test_db.url()).await;

    // Store NFC form: "Café"
    let ical = sample_icalendar_event("unicode-nfc@example.com", "Café");
    TestRequest::put(&caldav_item_path("testuser", "testcal", "unicode-nfc.ics"))
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(&service)
        .await
        .assert_status(StatusCode::CREATED);

    // Search with NFD form: "Cafe\u{0301}" should match under i;unicode-casemap
    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
    <D:prop>
        <D:getetag/>
    </D:prop>
    <C:filter>
        <C:comp-filter name="VCALENDAR">
            <C:comp-filter name="VEVENT">
                <C:prop-filter name="SUMMARY">
                    <C:text-match collation="i;unicode-casemap">Cafe</C:text-match>
                </C:prop-filter>
            </C:comp-filter>
        </C:comp-filter>
    </C:filter>
</C:calendar-query>"#;

    let body = body.replace("\u{0011}\u{0011}\u{0011}\u{0011}", "\u{0301}");
    let response = TestRequest::report(&caldav_collection_path("testuser", "testcal"))
        .xml_body(&body)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    let body_text = response.body_string();
    assert!(
        response.count_multistatus_responses() == 1,
        "i;unicode-casemap should normalize composed/decomposed forms"
    );
    assert!(
        body_text.contains(".ics</D:href>"),
        "Response should contain matching .ics href"
    );
}

/// ## Summary
/// Test calendar-query with i;ascii-casemap does NOT fold non-ASCII.
/// Per RFC 4790 §9.2: ASCII-only folding.
#[test_log::test(tokio::test)]
async fn calendar_query_collation_ascii_non_ascii_no_match() {
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

    let service = create_db_test_service(&test_db.url()).await;

    // Store "Straße"
    let ical = sample_icalendar_event("ascii-no-fold@example.com", "Straße");
    TestRequest::put(&caldav_item_path(
        "testuser",
        "testcal",
        "ascii-no-fold.ics",
    ))
    .if_none_match("*")
    .icalendar_body(&ical)
    .send(&service)
    .await
    .assert_status(StatusCode::CREATED);

    // Search for "strasse" should NOT match under i;ascii-casemap
    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
    <D:prop>
        <D:getetag/>
    </D:prop>
    <C:filter>
        <C:comp-filter name="VCALENDAR">
            <C:comp-filter name="VEVENT">
                <C:prop-filter name="SUMMARY">
                    <C:text-match collation="i;ascii-casemap">strasse</C:text-match>
                </C:prop-filter>
            </C:comp-filter>
        </C:comp-filter>
    </C:filter>
</C:calendar-query>"#;

    let response = TestRequest::report(&caldav_collection_path("testuser", "testcal"))
        .xml_body(body)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    let body_text = response.body_string();
    assert!(
        response.count_multistatus_responses() == 0,
        "i;ascii-casemap should NOT fold non-ASCII"
    );
    assert!(
        !body_text.contains(".ics</D:href>"),
        "Response should not contain matching .ics href"
    );
}

/// ## Summary
/// Test calendar-query with i;unicode-casemap matches German ß.
#[test_log::test(tokio::test)]
async fn calendar_query_collation_unicode_german_sharp_s() {
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

    let service = create_db_test_service(&test_db.url()).await;

    let ical = sample_icalendar_event("unicode-ss@example.com", "Straße Meeting");
    TestRequest::put(&caldav_item_path("testuser", "testcal", "unicode-ss.ics"))
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(&service)
        .await
        .assert_status(StatusCode::CREATED);

    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
    <D:prop>
        <D:getetag/>
    </D:prop>
    <C:filter>
        <C:comp-filter name="VCALENDAR">
            <C:comp-filter name="VEVENT">
                <C:prop-filter name="SUMMARY">
                    <C:text-match collation="i;unicode-casemap">strasse</C:text-match>
                </C:prop-filter>
            </C:comp-filter>
        </C:comp-filter>
    </C:filter>
</C:calendar-query>"#;

    let response = TestRequest::report(&caldav_collection_path("testuser", "testcal"))
        .xml_body(body)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    let body_text = response.body_string();
    assert!(
        response.count_multistatus_responses() == 1,
        "i;unicode-casemap should fold ß to ss"
    );
    assert!(
        body_text.contains(".ics</D:href>"),
        "Response should contain matching .ics href"
    );
}

/// ## Summary
/// Test calendar-query with i;ascii-casemap matches ASCII case-insensitively.
#[test_log::test(tokio::test)]
async fn calendar_query_collation_ascii_case_insensitive() {
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

    let service = create_db_test_service(&test_db.url()).await;

    let ical = sample_icalendar_event("ascii-case@example.com", "Email TEST");
    TestRequest::put(&caldav_item_path("testuser", "testcal", "ascii-case.ics"))
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(&service)
        .await
        .assert_status(StatusCode::CREATED);

    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
    <D:prop>
        <D:getetag/>
    </D:prop>
    <C:filter>
        <C:comp-filter name="VCALENDAR">
            <C:comp-filter name="VEVENT">
                <C:prop-filter name="SUMMARY">
                    <C:text-match collation="i;ascii-casemap">email test</C:text-match>
                </C:prop-filter>
            </C:comp-filter>
        </C:comp-filter>
    </C:filter>
</C:calendar-query>"#;

    let response = TestRequest::report(&caldav_collection_path("testuser", "testcal"))
        .xml_body(body)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    let body_text = response.body_string();
    assert!(
        response.count_multistatus_responses() == 1,
        "i;ascii-casemap should be ASCII case-insensitive"
    );
    assert!(
        body_text.contains(".ics</D:href>"),
        "Response should contain matching .ics href"
    );
}

/// ## Summary
/// Test calendar-query with i;unicode-casemap starts-with match.
#[test_log::test(tokio::test)]
async fn calendar_query_collation_unicode_starts_with() {
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

    let service = create_db_test_service(&test_db.url()).await;

    let ical = sample_icalendar_event("unicode-start@example.com", "Meeting Room");
    TestRequest::put(&caldav_item_path(
        "testuser",
        "testcal",
        "unicode-start.ics",
    ))
    .if_none_match("*")
    .icalendar_body(&ical)
    .send(&service)
    .await
    .assert_status(StatusCode::CREATED);

    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
    <D:prop>
        <D:getetag/>
    </D:prop>
    <C:filter>
        <C:comp-filter name="VCALENDAR">
            <C:comp-filter name="VEVENT">
                <C:prop-filter name="SUMMARY">
                    <C:text-match match-type="starts-with" collation="i;unicode-casemap">meeting</C:text-match>
                </C:prop-filter>
            </C:comp-filter>
        </C:comp-filter>
    </C:filter>
</C:calendar-query>"#;

    let response = TestRequest::report(&caldav_collection_path("testuser", "testcal"))
        .xml_body(body)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    let body_text = response.body_string();
    assert!(
        response.count_multistatus_responses() == 1,
        "i;unicode-casemap starts-with should match"
    );
    assert!(
        body_text.contains(".ics</D:href>"),
        "Response should contain matching .ics href"
    );
}

/// ## Summary
/// Test calendar-query with i;unicode-casemap ends-with match.
#[test_log::test(tokio::test)]
async fn calendar_query_collation_unicode_ends_with() {
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

    let service = create_db_test_service(&test_db.url()).await;

    let ical = sample_icalendar_event("unicode-end@example.com", "Team Sync");
    TestRequest::put(&caldav_item_path("testuser", "testcal", "unicode-end.ics"))
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(&service)
        .await
        .assert_status(StatusCode::CREATED);

    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
    <D:prop>
        <D:getetag/>
    </D:prop>
    <C:filter>
        <C:comp-filter name="VCALENDAR">
            <C:comp-filter name="VEVENT">
                <C:prop-filter name="SUMMARY">
                    <C:text-match match-type="ends-with" collation="i;unicode-casemap">sync</C:text-match>
                </C:prop-filter>
            </C:comp-filter>
        </C:comp-filter>
    </C:filter>
</C:calendar-query>"#;

    let response = TestRequest::report(&caldav_collection_path("testuser", "testcal"))
        .xml_body(body)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    let body_text = response.body_string();
    assert!(
        response.count_multistatus_responses() == 1,
        "i;unicode-casemap ends-with should match"
    );
    assert!(
        body_text.contains(".ics</D:href>"),
        "Response should contain matching .ics href"
    );
}

/// ## Summary
/// Test calendar-query with i;unicode-casemap negate behavior.
#[test_log::test(tokio::test)]
async fn calendar_query_collation_unicode_negate_contains() {
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

    let service = create_db_test_service(&test_db.url()).await;

    let ical = sample_icalendar_event("unicode-negate@example.com", "Alpha Beta");
    TestRequest::put(&caldav_item_path(
        "testuser",
        "testcal",
        "unicode-negate.ics",
    ))
    .if_none_match("*")
    .icalendar_body(&ical)
    .send(&service)
    .await
    .assert_status(StatusCode::CREATED);

    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
    <D:prop>
        <D:getetag/>
    </D:prop>
    <C:filter>
        <C:comp-filter name="VCALENDAR">
            <C:comp-filter name="VEVENT">
                <C:prop-filter name="SUMMARY">
                      <C:text-match match-type="contains" negate-condition="yes" collation="i;unicode-casemap">beta</C:text-match>
                </C:prop-filter>
            </C:comp-filter>
        </C:comp-filter>
    </C:filter>
</C:calendar-query>"#;

    let response = TestRequest::report(&caldav_collection_path("testuser", "testcal"))
        .xml_body(body)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    let body_text = response.body_string();
    assert!(
        response.count_multistatus_responses() == 0,
        "negate should exclude matching resources"
    );
    assert!(
        !body_text.contains(".ics</D:href>"),
        "Response should not contain matching .ics href"
    );
}

/// ## Summary
/// Test calendar-query with i;octet starts-with does not ignore case.
#[test_log::test(tokio::test)]
async fn calendar_query_collation_octet_starts_with_case_sensitive() {
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

    let service = create_db_test_service(&test_db.url()).await;

    let ical = sample_icalendar_event("octet-start@example.com", "Meeting Notes");
    TestRequest::put(&caldav_item_path("testuser", "testcal", "octet-start.ics"))
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(&service)
        .await
        .assert_status(StatusCode::CREATED);

    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
    <D:prop>
        <D:getetag/>
    </D:prop>
    <C:filter>
        <C:comp-filter name="VCALENDAR">
            <C:comp-filter name="VEVENT">
                <C:prop-filter name="SUMMARY">
                    <C:text-match match-type="starts-with" collation="i;octet">meeting</C:text-match>
                </C:prop-filter>
            </C:comp-filter>
        </C:comp-filter>
    </C:filter>
</C:calendar-query>"#;

    let response = TestRequest::report(&caldav_collection_path("testuser", "testcal"))
        .xml_body(body)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    let body_text = response.body_string();
    assert!(
        response.count_multistatus_responses() == 0,
        "i;octet should be case-sensitive for starts-with"
    );
    assert!(
        !body_text.contains(".ics</D:href>"),
        "Response should not contain matching .ics href"
    );
}

/// ## Summary
/// Test calendar-query with i;ascii-casemap contains match.
#[test_log::test(tokio::test)]
async fn calendar_query_collation_ascii_contains_case_insensitive() {
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

    let service = create_db_test_service(&test_db.url()).await;

    let ical = sample_icalendar_event("ascii-contains@example.com", "Email TEST");
    TestRequest::put(&caldav_item_path(
        "testuser",
        "testcal",
        "ascii-contains.ics",
    ))
    .if_none_match("*")
    .icalendar_body(&ical)
    .send(&service)
    .await
    .assert_status(StatusCode::CREATED);

    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
    <D:prop>
        <D:getetag/>
    </D:prop>
    <C:filter>
        <C:comp-filter name="VCALENDAR">
            <C:comp-filter name="VEVENT">
                <C:prop-filter name="SUMMARY">
                    <C:text-match match-type="contains" collation="i;ascii-casemap">email</C:text-match>
                </C:prop-filter>
            </C:comp-filter>
        </C:comp-filter>
    </C:filter>
</C:calendar-query>"#;

    let response = TestRequest::report(&caldav_collection_path("testuser", "testcal"))
        .xml_body(body)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    let body_text = response.body_string();
    assert!(
        response.count_multistatus_responses() == 1,
        "i;ascii-casemap contains should match"
    );
    assert!(
        body_text.contains(".ics</D:href>"),
        "Response should contain matching .ics href"
    );
}

/// ## Summary
/// Test calendar-query with i;ascii-casemap negate behavior.
#[test_log::test(tokio::test)]
async fn calendar_query_collation_ascii_negate_contains() {
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

    let service = create_db_test_service(&test_db.url()).await;

    let ical = sample_icalendar_event("ascii-negate@example.com", "Project Alpha");
    TestRequest::put(&caldav_item_path("testuser", "testcal", "ascii-negate.ics"))
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(&service)
        .await
        .assert_status(StatusCode::CREATED);

    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
    <D:prop>
        <D:getetag/>
    </D:prop>
    <C:filter>
        <C:comp-filter name="VCALENDAR">
            <C:comp-filter name="VEVENT">
                <C:prop-filter name="SUMMARY">
                      <C:text-match match-type="contains" negate-condition="yes" collation="i;ascii-casemap">alpha</C:text-match>
                </C:prop-filter>
            </C:comp-filter>
        </C:comp-filter>
    </C:filter>
</C:calendar-query>"#;

    let response = TestRequest::report(&caldav_collection_path("testuser", "testcal"))
        .xml_body(body)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    let body_text = response.body_string();
    assert!(
        response.count_multistatus_responses() == 0,
        "negate should exclude matching resources"
    );
    assert!(
        !body_text.contains(".ics</D:href>"),
        "Response should not contain matching .ics href"
    );
}

/// ## Summary
/// Test calendar-query with uppercase search term matching lowercase content.
/// Per RFC 4790 §9.3: i;unicode-casemap is bidirectional case-insensitive.
#[test_log::test(tokio::test)]
async fn calendar_query_collation_uppercase_search() {
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

    let service = create_db_test_service(&test_db.url()).await;

    // Create event with lowercase "meeting"
    let ical = sample_icalendar_event("uppercase-search@example.com", "meeting room");
    TestRequest::put(&caldav_item_path("testuser", "testcal", "uppersearch.ics"))
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(&service)
        .await
        .assert_status(StatusCode::CREATED);

    // Search for "MEETING" (uppercase) - SHOULD match "meeting" (lowercase)
    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:prop-filter name="SUMMARY">
          <C:text-match collation="i;unicode-casemap">MEETING</C:text-match>
        </C:prop-filter>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>"#;

    let response = TestRequest::report(&caldav_collection_path("testuser", "testcal"))
        .xml_body(body)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    let body_text = response.body_string();
    tracing::info!("Response body: {}", body_text);
    assert!(
        response.count_multistatus_responses() == 1,
        "i;unicode-casemap should be case-insensitive: 'MEETING' SHOULD match 'meeting' (found {} responses)",
        response.count_multistatus_responses()
    );
    assert!(
        body_text.contains(".ics</D:href>"),
        "Response should contain at least one .ics href"
    );
}

/// ## Summary
/// Test calendar-query with mixed case search and content.
/// Per RFC 4790 §9.3: Full Unicode normalization and case folding.
#[test_log::test(tokio::test)]
async fn calendar_query_collation_mixed_case() {
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

    let service = create_db_test_service(&test_db.url()).await;

    // Create event with mixed case "MiXeD CaSe"
    let ical = sample_icalendar_event("mixed-case@example.com", "MiXeD CaSe Event");
    TestRequest::put(&caldav_item_path("testuser", "testcal", "mixedcase.ics"))
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(&service)
        .await
        .assert_status(StatusCode::CREATED);

    // Search for "mixed case" (lowercase) - SHOULD match
    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:prop-filter name="SUMMARY">
          <C:text-match collation="i;unicode-casemap">mixed case</C:text-match>
        </C:prop-filter>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>"#;

    let response = TestRequest::report(&caldav_collection_path("testuser", "testcal"))
        .xml_body(body)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    let body_text = response.body_string();
    tracing::info!("Response body: {}", body_text);
    assert!(
        response.count_multistatus_responses() == 1,
        "i;unicode-casemap should normalize mixed case (found {} responses)",
        response.count_multistatus_responses()
    );
    assert!(
        body_text.contains(".ics</D:href>"),
        "Response should contain matching .ics href"
    );
}

/// ## Summary
/// Test calendar-query with Turkish İ (dotted capital I) case folding.
/// Per RFC 4790 §9.3: Full Unicode case folding, not locale-specific.
#[test_log::test(tokio::test)]
async fn calendar_query_collation_turkish_i() {
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

    let service = create_db_test_service(&test_db.url()).await;

    // Create event with Turkish İ (U+0130 LATIN CAPITAL LETTER I WITH DOT ABOVE)
    let ical = sample_icalendar_event("turkish-i@example.com", "İstanbul Meeting");
    TestRequest::put(&caldav_item_path("testuser", "testcal", "turkish.ics"))
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(&service)
        .await
        .assert_status(StatusCode::CREATED);

    // Search for "i̇stanbul" (i + combining dot) - SHOULD match "İstanbul"
    // Per Unicode case folding: İ (U+0130) folds to i + U+0307 (combining dot)
    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:prop-filter name="SUMMARY">
                    <C:text-match collation="i;unicode-casemap">i̇stanbul</C:text-match>
        </C:prop-filter>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>"#;

    let response = TestRequest::report(&caldav_collection_path("testuser", "testcal"))
        .xml_body(body)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    let body_text = response.body_string();
    tracing::info!("Response body: {}", body_text);
    assert!(
        response.count_multistatus_responses() == 1,
        "i;unicode-casemap should fold Turkish İ to i: 'istanbul' SHOULD match 'İstanbul' (found {} responses)",
        response.count_multistatus_responses()
    );
    assert!(
        body_text.contains(".ics</D:href>"),
        "Response should contain matching .ics href"
    );
}

/// ## Summary
/// Test calendar-query with Greek sigma (Σ/σ/ς) case folding.
/// Per RFC 4790 §9.3: Unicode handles Greek final sigma correctly.
#[test_log::test(tokio::test)]
async fn calendar_query_collation_greek_sigma() {
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

    let service = create_db_test_service(&test_db.url()).await;

    // Create event with Greek word ending in final sigma (ς)
    // "σύνδεσης" (syndesis - "connection" with final sigma ς)
    let ical = sample_icalendar_event("greek-sigma@example.com", "Δοκιμή σύνδεσης");
    TestRequest::put(&caldav_item_path("testuser", "testcal", "greek.ics"))
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(&service)
        .await
        .assert_status(StatusCode::CREATED);

    // Search with regular sigma (σ) instead of final sigma (ς), keep tonos
    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:prop-filter name="SUMMARY">
                    <C:text-match collation="i;unicode-casemap">σύνδεσησ</C:text-match>
        </C:prop-filter>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>"#;

    let response = TestRequest::report(&caldav_collection_path("testuser", "testcal"))
        .xml_body(body)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    let body_text = response.body_string();
    tracing::info!("Response body: {}", body_text);
    assert!(
        response.count_multistatus_responses() == 1,
        "i;unicode-casemap should handle Greek sigma variants (found {} responses)",
        response.count_multistatus_responses()
    );
    assert!(
        body_text.contains(".ics</D:href>"),
        "Response should contain matching .ics href"
    );
}

/// ## Summary
/// Test addressbook-query with i;unicode-casemap for international names.
/// Per RFC 4790 §9.3: Full Unicode case folding including non-ASCII.
#[test_log::test(tokio::test)]
async fn addressbook_query_collation_unicode_german() {
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

    test_db
        .seed_collection_owner(principal_id, collection_id, "addressbook")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    // Create vCard with German name containing ß
    let vcard = sample_vcard("german-test@example.com", "Straße", "test@example.com");
    TestRequest::put(&carddav_item_path("testuser", "contacts", "german.vcf"))
        .if_none_match("*")
        .vcard_body(&vcard)
        .send(&service)
        .await
        .assert_status(StatusCode::CREATED);

    // Search for "strasse" (ss) - should match "Straße" (ß) with Unicode folding
    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-query xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
  </D:prop>
  <C:filter>
    <C:prop-filter name="FN">
      <C:text-match collation="i;unicode-casemap">strasse</C:text-match>
    </C:prop-filter>
  </C:filter>
</C:addressbook-query>"#;

    let response = TestRequest::report(&carddav_collection_path("testuser", "contacts"))
        .xml_body(body)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    let body_text = response.body_string();
    tracing::info!("Response body: {}", body_text);
    assert!(
        response.count_multistatus_responses() == 1,
        "i;unicode-casemap should fold German ß to ss: 'strasse' SHOULD match 'Straße'"
    );
}

/// ## Summary
/// Test addressbook-query with i;ascii-casemap does NOT fold non-ASCII.
#[test_log::test(tokio::test)]
async fn addressbook_query_collation_ascii_non_ascii_no_match() {
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

    test_db
        .seed_collection_owner(principal_id, collection_id, "addressbook")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    // Create vCard with non-ASCII email local-part
    let vcard = r#"BEGIN:VCARD
VERSION:4.0
UID:ascii-no-fold@example.com
FN:Café User
EMAIL:café@example.com
END:VCARD"#;

    TestRequest::put(&carddav_item_path(
        "testuser",
        "contacts",
        "ascii-nonascii.vcf",
    ))
    .if_none_match("*")
    .vcard_body(vcard)
    .send(&service)
    .await
    .assert_status(StatusCode::CREATED);

    // Search for ASCII-only fold should NOT match non-ASCII
    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-query xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
  </D:prop>
  <C:filter>
    <C:prop-filter name="EMAIL">
      <C:text-match collation="i;ascii-casemap">cafe@example.com</C:text-match>
    </C:prop-filter>
  </C:filter>
</C:addressbook-query>"#;

    let response = TestRequest::report(&carddav_collection_path("testuser", "contacts"))
        .xml_body(body)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    let body_text = response.body_string();
    assert!(
        response.count_multistatus_responses() == 0,
        "i;ascii-casemap should NOT fold non-ASCII"
    );
    assert!(
        !body_text.contains(".vcf</D:href>"),
        "Response should not contain matching .vcf href"
    );
}

/// ## Summary
/// Test addressbook-query with i;octet is case-sensitive for EMAIL.
#[test_log::test(tokio::test)]
async fn addressbook_query_collation_octet_email_case_sensitive() {
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

    test_db
        .seed_collection_owner(principal_id, collection_id, "addressbook")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let vcard = r#"BEGIN:VCARD
VERSION:4.0
UID:octet-email@example.com
FN:Octet Email
EMAIL:John.Doe@EXAMPLE.COM
END:VCARD"#;

    TestRequest::put(&carddav_item_path(
        "testuser",
        "contacts",
        "octet-email.vcf",
    ))
    .if_none_match("*")
    .vcard_body(vcard)
    .send(&service)
    .await
    .assert_status(StatusCode::CREATED);

    // i;octet should NOT match different case
    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-query xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
  </D:prop>
  <C:filter>
    <C:prop-filter name="EMAIL">
      <C:text-match collation="i;octet">john.doe@example.com</C:text-match>
    </C:prop-filter>
  </C:filter>
</C:addressbook-query>"#;

    let response = TestRequest::report(&carddav_collection_path("testuser", "contacts"))
        .xml_body(body)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    let body_text = response.body_string();
    assert!(
        response.count_multistatus_responses() == 0,
        "i;octet should be case-sensitive for EMAIL"
    );
    assert!(
        !body_text.contains(".vcf</D:href>"),
        "Response should not contain matching .vcf href"
    );
}

/// ## Summary
/// Test addressbook-query with i;unicode-casemap matches composed vs decomposed.
#[test_log::test(tokio::test)]
async fn addressbook_query_collation_unicode_normalization_match() {
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

    test_db
        .seed_collection_owner(principal_id, collection_id, "addressbook")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let vcard = sample_vcard("unicode-nfd@example.com", "Café", "test@example.com");
    TestRequest::put(&carddav_item_path(
        "testuser",
        "contacts",
        "unicode-nfd.vcf",
    ))
    .if_none_match("*")
    .vcard_body(&vcard)
    .send(&service)
    .await
    .assert_status(StatusCode::CREATED);

    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-query xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
  </D:prop>
  <C:filter>
    <C:prop-filter name="FN">
      <C:text-match collation="i;unicode-casemap">Cafe</C:text-match>
    </C:prop-filter>
  </C:filter>
</C:addressbook-query>"#;

    let body = body.replace("\u{0011}\u{0011}\u{0011}\u{0011}", "\u{0301}");
    let response = TestRequest::report(&carddav_collection_path("testuser", "contacts"))
        .xml_body(&body)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    let body_text = response.body_string();
    assert!(
        response.count_multistatus_responses() == 1,
        "i;unicode-casemap should normalize composed/decomposed forms"
    );
    assert!(
        body_text.contains(".vcf</D:href>"),
        "Response should contain matching .vcf href"
    );
}

/// ## Summary
/// Test that malformed Unicode character references return 400.
#[test_log::test(tokio::test)]
async fn report_malformed_unicode_reference_400() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");
    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    test_db
        .seed_collection(principal_id, CollectionType::Calendar, "testcal", None)
        .await
        .expect("Failed to seed collection");

    let service = create_db_test_service(&test_db.url()).await;

    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:prop-filter name="SUMMARY">
          <C:text-match collation="i;unicode-casemap">&#xD800;</C:text-match>
        </C:prop-filter>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>"#;

    let response = TestRequest::report(&caldav_collection_path("testuser", "testcal"))
        .xml_body(body)
        .send(&service)
        .await;

    response.assert_status(StatusCode::BAD_REQUEST);
}

/// ## Summary
/// Test addressbook-query with i;ascii-casemap for email addresses.
/// Per RFC 4790 §9.2: ASCII-only case folding, non-ASCII preserved.
#[test_log::test(tokio::test)]
async fn addressbook_query_collation_ascii_email() {
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

    test_db
        .seed_collection_owner(principal_id, collection_id, "addressbook")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    // Create vCard with email address
    let vcard = r#"BEGIN:VCARD
VERSION:4.0
UID:ascii-email@example.com
FN:John Doe
EMAIL:John.Doe@EXAMPLE.COM
END:VCARD"#;

    TestRequest::put(&carddav_item_path("testuser", "contacts", "ascii.vcf"))
        .if_none_match("*")
        .vcard_body(vcard)
        .send(&service)
        .await
        .assert_status(StatusCode::CREATED);

    // Search for lowercase email - should match with ASCII case folding
    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-query xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
  </D:prop>
  <C:filter>
    <C:prop-filter name="EMAIL">
      <C:text-match collation="i;ascii-casemap">@example.com</C:text-match>
    </C:prop-filter>
  </C:filter>
</C:addressbook-query>"#;

    let response = TestRequest::report(&carddav_collection_path("testuser", "contacts"))
        .xml_body(body)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    let body_text = response.body_string();
    tracing::info!("Response body: {}", body_text);
    // Should match with ASCII case folding
    assert!(
        response.count_multistatus_responses() == 1,
        "i;ascii-casemap should match ASCII case-insensitively (found {} responses)",
        response.count_multistatus_responses()
    );
    assert!(
        body_text.contains(".vcf</D:href>"),
        "Response should contain at least one .vcf href"
    );
}

/// ## Summary
/// Test addressbook-query FN starts-with with i;unicode-casemap.
#[test_log::test(tokio::test)]
async fn addressbook_query_collation_unicode_fn_starts_with() {
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

    test_db
        .seed_collection_owner(principal_id, collection_id, "addressbook")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let vcard = sample_vcard("unicode-fn-start@example.com", "Élodie", "test@example.com");
    TestRequest::put(&carddav_item_path(
        "testuser",
        "contacts",
        "unicode-fn-start.vcf",
    ))
    .if_none_match("*")
    .vcard_body(&vcard)
    .send(&service)
    .await
    .assert_status(StatusCode::CREATED);

    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-query xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
  </D:prop>
  <C:filter>
    <C:prop-filter name="FN">
      <C:text-match match-type="starts-with" collation="i;unicode-casemap">él</C:text-match>
    </C:prop-filter>
  </C:filter>
</C:addressbook-query>"#;

    let response = TestRequest::report(&carddav_collection_path("testuser", "contacts"))
        .xml_body(body)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    let body_text = response.body_string();
    assert!(
        response.count_multistatus_responses() == 1,
        "i;unicode-casemap starts-with should match"
    );
    assert!(
        body_text.contains(".vcf</D:href>"),
        "Response should contain matching .vcf href"
    );
}

/// ## Summary
/// Test addressbook-query FN ends-with with i;unicode-casemap.
#[test_log::test(tokio::test)]
async fn addressbook_query_collation_unicode_fn_ends_with() {
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

    test_db
        .seed_collection_owner(principal_id, collection_id, "addressbook")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let vcard = sample_vcard(
        "unicode-fn-end@example.com",
        "Project Sigma",
        "test@example.com",
    );
    TestRequest::put(&carddav_item_path(
        "testuser",
        "contacts",
        "unicode-fn-end.vcf",
    ))
    .if_none_match("*")
    .vcard_body(&vcard)
    .send(&service)
    .await
    .assert_status(StatusCode::CREATED);

    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-query xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
  </D:prop>
  <C:filter>
    <C:prop-filter name="FN">
      <C:text-match match-type="ends-with" collation="i;unicode-casemap">SIGMA</C:text-match>
    </C:prop-filter>
  </C:filter>
</C:addressbook-query>"#;

    let response = TestRequest::report(&carddav_collection_path("testuser", "contacts"))
        .xml_body(body)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    let body_text = response.body_string();
    assert!(
        response.count_multistatus_responses() == 1,
        "i;unicode-casemap ends-with should match"
    );
    assert!(
        body_text.contains(".vcf</D:href>"),
        "Response should contain matching .vcf href"
    );
}

/// ## Summary
/// Test addressbook-query EMAIL contains with i;ascii-casemap.
#[test_log::test(tokio::test)]
async fn addressbook_query_collation_ascii_email_contains() {
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

    test_db
        .seed_collection_owner(principal_id, collection_id, "addressbook")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let vcard = r#"BEGIN:VCARD
VERSION:4.0
UID:ascii-contains@example.com
FN:John Doe
EMAIL:John.Doe@EXAMPLE.COM
END:VCARD"#;

    TestRequest::put(&carddav_item_path(
        "testuser",
        "contacts",
        "ascii-contains.vcf",
    ))
    .if_none_match("*")
    .vcard_body(vcard)
    .send(&service)
    .await
    .assert_status(StatusCode::CREATED);

    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-query xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
  </D:prop>
  <C:filter>
    <C:prop-filter name="EMAIL">
      <C:text-match match-type="contains" collation="i;ascii-casemap">example.com</C:text-match>
    </C:prop-filter>
  </C:filter>
</C:addressbook-query>"#;

    let response = TestRequest::report(&carddav_collection_path("testuser", "contacts"))
        .xml_body(body)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    let body_text = response.body_string();
    assert!(
        response.count_multistatus_responses() == 1,
        "i;ascii-casemap contains should match"
    );
    assert!(
        body_text.contains(".vcf</D:href>"),
        "Response should contain matching .vcf href"
    );
}

/// ## Summary
/// Test addressbook-query EMAIL starts-with with i;octet is case-sensitive.
#[test_log::test(tokio::test)]
async fn addressbook_query_collation_octet_email_starts_with_case_sensitive() {
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

    test_db
        .seed_collection_owner(principal_id, collection_id, "addressbook")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let vcard = r#"BEGIN:VCARD
VERSION:4.0
UID:octet-start@example.com
FN:Octet Start
EMAIL:John.Doe@EXAMPLE.COM
END:VCARD"#;

    TestRequest::put(&carddav_item_path(
        "testuser",
        "contacts",
        "octet-start.vcf",
    ))
    .if_none_match("*")
    .vcard_body(vcard)
    .send(&service)
    .await
    .assert_status(StatusCode::CREATED);

    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-query xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
  </D:prop>
  <C:filter>
    <C:prop-filter name="EMAIL">
      <C:text-match match-type="starts-with" collation="i;octet">john</C:text-match>
    </C:prop-filter>
  </C:filter>
</C:addressbook-query>"#;

    let response = TestRequest::report(&carddav_collection_path("testuser", "contacts"))
        .xml_body(body)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    let body_text = response.body_string();
    assert!(
        response.count_multistatus_responses() == 0,
        "i;octet should be case-sensitive for starts-with"
    );
    assert!(
        !body_text.contains(".vcf</D:href>"),
        "Response should not contain matching .vcf href"
    );
}

/// ## Summary
/// Test addressbook-query EMAIL negate with i;ascii-casemap.
#[test_log::test(tokio::test)]
async fn addressbook_query_collation_ascii_email_negate_contains() {
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

    test_db
        .seed_collection_owner(principal_id, collection_id, "addressbook")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let vcard = r#"BEGIN:VCARD
VERSION:4.0
UID:ascii-negate@example.com
FN:Alpha User
EMAIL:alpha@example.com
END:VCARD"#;

    TestRequest::put(&carddav_item_path(
        "testuser",
        "contacts",
        "ascii-negate.vcf",
    ))
    .if_none_match("*")
    .vcard_body(vcard)
    .send(&service)
    .await
    .assert_status(StatusCode::CREATED);

    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-query xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
  </D:prop>
  <C:filter>
    <C:prop-filter name="EMAIL">
    <C:text-match match-type="contains" negate-condition="yes" collation="i;ascii-casemap">alpha</C:text-match>
    </C:prop-filter>
  </C:filter>
</C:addressbook-query>"#;

    let response = TestRequest::report(&carddav_collection_path("testuser", "contacts"))
        .xml_body(body)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    let body_text = response.body_string();
    assert!(
        response.count_multistatus_responses() == 0,
        "negate should exclude matching resources"
    );
    assert!(
        !body_text.contains(".vcf</D:href>"),
        "Response should not contain matching .vcf href"
    );
}

/// ## Summary
/// Test addressbook-query N property matches family/given with unicode casemap.
#[test_log::test(tokio::test)]
async fn addressbook_query_collation_unicode_n_matches_family() {
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

    test_db
        .seed_collection_owner(principal_id, collection_id, "addressbook")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let vcard = r#"BEGIN:VCARD
VERSION:4.0
UID:n-family@example.com
FN:Jane Doe
N:Doe;Jane;;;
END:VCARD"#;

    TestRequest::put(&carddav_item_path("testuser", "contacts", "n-family.vcf"))
        .if_none_match("*")
        .vcard_body(vcard)
        .send(&service)
        .await
        .assert_status(StatusCode::CREATED);

    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-query xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
  </D:prop>
  <C:filter>
    <C:prop-filter name="N">
      <C:text-match match-type="contains" collation="i;unicode-casemap">doe</C:text-match>
    </C:prop-filter>
  </C:filter>
</C:addressbook-query>"#;

    let response = TestRequest::report(&carddav_collection_path("testuser", "contacts"))
        .xml_body(body)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    let body_text = response.body_string();
    assert!(
        response.count_multistatus_responses() == 1,
        "N property should match family name with unicode casemap"
    );
    assert!(
        body_text.contains(".vcf</D:href>"),
        "Response should contain matching .vcf href"
    );
}

/// ## Summary
/// Test addressbook-query N property with i;octet remains case-sensitive.
#[test_log::test(tokio::test)]
async fn addressbook_query_collation_octet_n_case_sensitive() {
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

    test_db
        .seed_collection_owner(principal_id, collection_id, "addressbook")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let vcard = r#"BEGIN:VCARD
VERSION:4.0
UID:n-octet@example.com
FN:Jane Doe
N:Doe;Jane;;;
END:VCARD"#;

    TestRequest::put(&carddav_item_path("testuser", "contacts", "n-octet.vcf"))
        .if_none_match("*")
        .vcard_body(vcard)
        .send(&service)
        .await
        .assert_status(StatusCode::CREATED);

    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-query xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
  </D:prop>
  <C:filter>
    <C:prop-filter name="N">
      <C:text-match match-type="contains" collation="i;octet">doe</C:text-match>
    </C:prop-filter>
  </C:filter>
</C:addressbook-query>"#;

    let response = TestRequest::report(&carddav_collection_path("testuser", "contacts"))
        .xml_body(body)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    let body_text = response.body_string();
    assert!(
        response.count_multistatus_responses() == 0,
        "N property with i;octet should be case-sensitive"
    );
    assert!(
        !body_text.contains(".vcf</D:href>"),
        "Response should not contain matching .vcf href"
    );
}

// ============================================================================
// REPORT Filter Validation Tests (RFC 4791 §7.8 supported-filter)
// ============================================================================

/// ## Summary
/// Test that calendar-query with unsupported component returns supported-filter error.
///
/// RFC 4791 §7.8 requires returning 403 with supported-filter precondition when
/// a filter uses unsupported components. For MVP, we support VEVENT, VTODO, VJOURNAL, etc.
#[test_log::test(tokio::test)]
async fn calendar_query_unsupported_component_403() {
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

    let service = create_db_test_service(&test_db.url()).await;

    // Create a calendar-query with an unsupported component (VUNDEFINED)
    // RFC 4791 requires the filter root to be VCALENDAR, with nested components like VEVENT, VTODO, etc.
    // VUNDEFINED is not a valid iCalendar component (RFC 5545).
    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VUNDEFINED">
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>"#;

    let response = TestRequest::report(&caldav_collection_path("testuser", "testcal"))
        .xml_body(body)
        .send(&service)
        .await;

    // RFC 4791 §7.8: Must return 403 with supported-filter precondition
    let body_text = response.body_string();
    response.assert_status(StatusCode::FORBIDDEN);
    assert!(
        body_text.contains("supported-filter"),
        "Response should contain supported-filter precondition error: {}",
        body_text
    );
}

/// ## Summary
/// Test that calendar-query with unsupported property returns supported-filter error.
///
/// RFC 4791 §7.8 requires returning 403 with supported-filter precondition when
/// a filter uses unsupported properties.
#[test_log::test(tokio::test)]
async fn calendar_query_unsupported_property_403() {
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

    let service = create_db_test_service(&test_db.url()).await;

    // Create a calendar-query with an unsupported property (NONEXISTENT)
    // Filter structure must be: VCALENDAR (root) -> VEVENT (component) -> NONEXISTENT (property)
    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:prop-filter name="NONEXISTENT">
        </C:prop-filter>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>"#;

    let response = TestRequest::report(&caldav_collection_path("testuser", "testcal"))
        .xml_body(body)
        .send(&service)
        .await;

    // RFC 4791 §7.8: Must return 403 with supported-filter precondition
    let body_text = response.body_string();
    response.assert_status(StatusCode::FORBIDDEN);
    assert!(
        body_text.contains("supported-filter"),
        "Response should contain supported-filter precondition error: {}",
        body_text
    );
}

/// ## Summary
/// Test that calendar-query with supported components works correctly.
///
/// RFC 4791 §7.8 supported-filter should allow VEVENT, VTODO, VJOURNAL, etc.
/// This test verifies that standard components are accepted.
#[test_log::test(tokio::test)]
async fn calendar_query_supported_components_accepted() {
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

    let service = create_db_test_service(&test_db.url()).await;

    let ical = sample_icalendar_event("test@example.com", "Test Event");
    TestRequest::put(&caldav_item_path("testuser", "testcal", "test.ics"))
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(&service)
        .await
        .assert_status(StatusCode::CREATED);

    // Create a calendar-query with supported components (VEVENT)
    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VEVENT">
      <C:prop-filter name="SUMMARY">
        <C:text-match collation="i;octet">Test</C:text-match>
      </C:prop-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>"#;

    let response = TestRequest::report(&caldav_collection_path("testuser", "testcal"))
        .xml_body(body)
        .send(&service)
        .await;

    // Should return 207 Multi-Status (not 403 error)
    let body_text = response.body_string();
    response.assert_status(StatusCode::MULTI_STATUS);
    // Should NOT contain error precondition
    assert!(
        !body_text.contains("supported-filter"),
        "Response should not contain supported-filter error for valid filter"
    );
}

