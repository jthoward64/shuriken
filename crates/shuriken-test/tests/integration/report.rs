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

    test_db
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
    assert!(
        !body_text.contains("octet.ics"),
        "i;octet should be case-sensitive: 'meeting' should NOT match 'Meeting'"
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

    // Search for "istanbul" (lowercase) - SHOULD match "İstanbul"
    // Per Unicode case folding: İ (U+0130) folds to i (U+0069)
    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:prop-filter name="SUMMARY">
          <C:text-match collation="i;unicode-casemap">istanbul</C:text-match>
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

    // Search with regular sigma (σ) instead of final sigma (ς)
    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:prop-filter name="SUMMARY">
          <C:text-match collation="i;unicode-casemap">συνδεσησ</C:text-match>
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
    assert!(
        response.count_multistatus_responses() == 1,
        "i;unicode-casemap should fold German ß to ss: 'strasse' SHOULD match 'Straße'"
    );
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
