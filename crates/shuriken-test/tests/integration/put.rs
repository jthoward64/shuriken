#![allow(clippy::unused_async, unused_must_use)]
//! Tests for PUT method.
//!
//! Verifies resource creation/update, precondition handling, and side effects.

use salvo::http::StatusCode;

use super::helpers::*;

// ============================================================================
// Basic PUT Create Tests
// ============================================================================

/// ## Summary
/// Test that PUT creates a new calendar object.
#[test_log::test(tokio::test)]
async fn put_creates_calendar_object() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    // Seed the role→permission mappings (g2 rules)
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    // Seed the authenticated user (matches config email)
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

    // Grant owner access to the authenticated user on their collection
    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let ical = sample_icalendar_event("new-event@example.com", "Test Event");
    // Use the authenticated user's slug for the path
    let uri = caldav_item_path("testuser", "testcal", "new-event.ics");

    let response = TestRequest::put(&uri)
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(&service)
        .await;

    response.assert_status(StatusCode::CREATED);
}

/// ## Summary
/// Test that PUT creates a new vCard.
#[test_log::test(tokio::test)]
async fn put_creates_vcard() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    // Seed the role→permission mappings (g2 rules)
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    // Seed the authenticated user (matches config email)
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

    // Grant owner access to the user on their collection
    test_db
        .seed_collection_owner(principal_id, collection_id, "addressbook")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let vcard = sample_vcard("new-contact@example.com", "Jane Doe", "jane@example.com");
    let uri = carddav_item_path("testuser", "contacts", "new-contact.vcf");

    let response = TestRequest::put(&uri)
        .if_none_match("*")
        .vcard_body(&vcard)
        .send(&service)
        .await;

    response.assert_status(StatusCode::CREATED);
}

// ============================================================================
// Index Population Tests
// ============================================================================

/// ## Summary
/// Test that PUT populates `cal_index` for recurring events.
#[test_log::test(tokio::test)]
async fn put_populates_cal_index_and_occurrences() {
    use chrono::{NaiveDateTime, Utc};
    use diesel::prelude::*;
    use diesel_async::RunQueryDsl;
    use shuriken_test::component::db::schema::{cal_index, dav_instance};

    let test_db = TestDb::new().await.expect("Failed to create test database");

    // Seed the role→permission mappings (g2 rules)
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    // Seed the authenticated user (matches config email)
    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let collection_id = test_db
        .seed_collection(
            principal_id,
            CollectionType::Calendar,
            "indexcal",
            Some("Index Calendar"),
        )
        .await
        .expect("Failed to seed collection");

    // Grant owner access to the user on their collection
    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let uid = "index-event@example.com";
    let summary = "Index Event";
    let uri = caldav_item_path("testuser", "indexcal", "index-event.ics");
    let ical = sample_recurring_event(uid, summary, "FREQ=DAILY;COUNT=3");

    let response = TestRequest::put(&uri)
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(&service)
        .await;

    response.assert_status(StatusCode::CREATED);

    let mut conn = test_db.get_conn().await.expect("Failed to get DB conn");

    // Use just the base name (without extension) for instance slug lookup
    let item_slug = "index-event";
    let entity_id = dav_instance::table
        .filter(dav_instance::collection_id.eq(collection_id))
        .filter(dav_instance::slug.eq(item_slug))
        .select(dav_instance::entity_id)
        .first::<uuid::Uuid>(&mut conn)
        .await
        .expect("Failed to fetch entity_id for instance");

    let (component_type, idx_uid, metadata, dtstart_utc, dtend_utc) = cal_index::table
        .filter(cal_index::entity_id.eq(entity_id))
        .select((
            cal_index::component_type,
            cal_index::uid,
            cal_index::metadata,
            cal_index::dtstart_utc,
            cal_index::dtend_utc,
        ))
        .first::<(
            String,
            Option<String>,
            Option<serde_json::Value>,
            Option<chrono::DateTime<Utc>>,
            Option<chrono::DateTime<Utc>>,
        )>(&mut conn)
        .await
        .expect("Failed to fetch cal_index entry");

    assert_eq!(component_type, "VEVENT");
    assert_eq!(idx_uid.as_deref(), Some(uid));

    // Check summary is in metadata JSONB
    if let Some(meta) = metadata {
        let idx_summary = meta.get("summary").and_then(|v| v.as_str());
        assert_eq!(idx_summary, Some(summary));
    }

    let dtstart_naive = NaiveDateTime::parse_from_str("20260126T100000Z", "%Y%m%dT%H%M%SZ")
        .expect("Failed to parse DTSTART");
    let dtend_naive = NaiveDateTime::parse_from_str("20260126T110000Z", "%Y%m%dT%H%M%SZ")
        .expect("Failed to parse DTEND");

    let dtstart_expected = chrono::DateTime::<Utc>::from_naive_utc_and_offset(dtstart_naive, Utc);
    let dtend_expected = chrono::DateTime::<Utc>::from_naive_utc_and_offset(dtend_naive, Utc);

    assert_eq!(dtstart_utc, Some(dtstart_expected));
    assert_eq!(dtend_utc, Some(dtend_expected));
}

/// ## Summary
/// Test that PUT populates `card_index` for vCards.
#[test_log::test(tokio::test)]
async fn put_populates_card_index() {
    use diesel::prelude::*;
    use diesel_async::RunQueryDsl;
    use shuriken_test::component::db::schema::{card_index, dav_instance};

    let test_db = TestDb::new().await.expect("Failed to create test database");

    // Seed the role→permission mappings (g2 rules)
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    // Seed the authenticated user (matches config email)
    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let collection_id = test_db
        .seed_collection(
            principal_id,
            CollectionType::Addressbook,
            "indexbook",
            Some("Index Book"),
        )
        .await
        .expect("Failed to seed collection");

    // Grant owner access to the user on their collection
    test_db
        .seed_collection_owner(principal_id, collection_id, "addressbook")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let uid = "index-contact@example.com";
    let fn_name = "Index Contact";
    let email = "index@example.com";
    let uri = carddav_item_path("testuser", "indexbook", "index-contact.vcf");
    let vcard = sample_vcard(uid, fn_name, email);

    let response = TestRequest::put(&uri)
        .if_none_match("*")
        .vcard_body(&vcard)
        .send(&service)
        .await;

    response.assert_status(StatusCode::CREATED);

    let mut conn = test_db.get_conn().await.expect("Failed to get DB conn");

    // Use just the base name (without extension) for instance slug lookup
    let item_slug = "index-contact";
    let entity_id = dav_instance::table
        .filter(dav_instance::collection_id.eq(collection_id))
        .filter(dav_instance::slug.eq(item_slug))
        .select(dav_instance::entity_id)
        .first::<uuid::Uuid>(&mut conn)
        .await
        .expect("Failed to fetch entity_id for instance");

    let (idx_uid, idx_fn, idx_data) = card_index::table
        .filter(card_index::entity_id.eq(entity_id))
        .select((card_index::uid, card_index::fn_, card_index::data))
        .first::<(Option<String>, Option<String>, Option<serde_json::Value>)>(&mut conn)
        .await
        .expect("Failed to fetch card_index entry");

    assert_eq!(idx_uid.as_deref(), Some(uid));
    assert_eq!(idx_fn.as_deref(), Some(fn_name));

    // Verify data JSONB is present (fields may not be present if vcard is minimal)
    assert!(idx_data.is_some(), "card_index.data should be populated");
    if let Some(data) = idx_data {
        // For a minimal vcard, these fields won't be in the JSON object
        // Just verify the data structure exists
        assert!(data.is_object(), "card_index.data should be a JSON object");
    }
}

// ============================================================================
// If-None-Match Precondition Tests
// ============================================================================

/// ## Summary
/// Test that PUT with If-None-Match:* succeeds when resource doesn't exist.
#[test_log::test(tokio::test)]
async fn put_create_if_none_match_star_ok() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    // Seed the role→permission mappings (g2 rules)
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    // Seed the authenticated user (matches config email)
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

    let ical = sample_icalendar_event("inm-test@example.com", "INM Test");
    let uri = caldav_item_path("testuser", "testcal", "inm-test.ics");

    let response = TestRequest::put(&uri)
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(&service)
        .await;

    response
        .assert_status(StatusCode::CREATED)
        .assert_header_exists("ETag");
}

/// ## Summary
/// Test that PUT with If-None-Match:* fails when resource exists.
#[test_log::test(tokio::test)]
async fn put_create_if_none_match_star_fails_when_exists() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    // Seed the role→permission mappings (g2 rules)
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    // Seed the authenticated user (matches config email)
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
        .seed_entity("icalendar", Some("existing@example.com"))
        .await
        .expect("Failed to seed entity");

    let uri = caldav_item_path("testuser", "testcal", "existing.ics");
    // Use just the base name (without extension) for the instance slug
    let item_slug = "existing";
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            item_slug,
            "text/calendar",
            "\"existing-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    let ical = sample_icalendar_event("existing@example.com", "Try Create Over Existing");

    let response = TestRequest::put(&uri)
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(&service)
        .await;

    response.assert_status(StatusCode::PRECONDITION_FAILED);
}

// ============================================================================
// If-Match Precondition Tests
// ============================================================================

/// ## Summary
/// Test that PUT update with correct If-Match succeeds.
#[test_log::test(tokio::test)]
async fn put_update_if_match_success() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    // Seed the role→permission mappings (g2 rules)
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    // Seed the authenticated user (matches config email)
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
        .seed_entity("icalendar", Some("update-test@example.com"))
        .await
        .expect("Failed to seed entity");

    let uri = caldav_item_path("testuser", "testcal", "update-test.ics");
    // Use just the base name (without extension) for the instance slug
    let item_slug = "update-test";
    let etag = "\"update-etag-123\"";
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            item_slug,
            "text/calendar",
            etag,
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    let ical = sample_icalendar_event("update-test@example.com", "Updated Event");

    let response = TestRequest::put(&uri)
        .if_match(etag)
        .icalendar_body(&ical)
        .send(&service)
        .await;

    // Either 200 OK or 204 No Content for updates
    assert!(
        response.status == StatusCode::OK || response.status == StatusCode::NO_CONTENT,
        "Expected 200 or 204, got {}",
        response.status
    );
}

/// ## Summary
/// Test that PUT with mismatched If-Match returns 412.
#[test_log::test(tokio::test)]
async fn put_update_if_match_mismatch_412() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    // Seed the role→permission mappings (g2 rules)
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    // Seed the authenticated user (matches config email)
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
        .seed_entity("icalendar", Some("mismatch-test@example.com"))
        .await
        .expect("Failed to seed entity");

    let uri = caldav_item_path("testuser", "testcal", "mismatch-test.ics");
    // Use just the base name (without extension) for the instance slug
    let item_slug = "mismatch-test";
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            item_slug,
            "text/calendar",
            "\"actual-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    let ical = sample_icalendar_event("mismatch-test@example.com", "Try Update");

    let response = TestRequest::put(&uri)
        .if_match("\"wrong-etag\"")
        .icalendar_body(&ical)
        .send(&service)
        .await;

    response.assert_status(StatusCode::PRECONDITION_FAILED);
}

// ============================================================================
// Content Validation Tests
// ============================================================================

/// ## Summary
/// Test that PUT with invalid iCalendar returns validation error.
#[test_log::test(tokio::test)]
async fn put_invalid_ical_rejected() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    // Seed the role→permission mappings (g2 rules)
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    // Seed the authenticated user (matches config email)
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

    let invalid_ical = "this is not valid icalendar data";
    let uri = caldav_item_path("testuser", "testcal", "invalid.ics");

    let response = TestRequest::put(&uri)
        .if_none_match("*")
        .icalendar_body(invalid_ical)
        .send(&service)
        .await;

    // Should return 403 Forbidden with valid-calendar-data precondition
    // or 400 Bad Request
    assert!(
        response.status == StatusCode::FORBIDDEN || response.status == StatusCode::BAD_REQUEST,
        "Expected 403 or 400 for invalid iCalendar, got {}",
        response.status
    );
}

/// ## Summary
/// Test that PUT with invalid vCard returns validation error.
#[test_log::test(tokio::test)]
async fn put_invalid_vcard_rejected() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    // Seed the role→permission mappings (g2 rules)
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    // Seed the authenticated user (matches config email)
    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let collection_id = test_db
        .seed_collection(principal_id, CollectionType::Addressbook, "inv", None)
        .await
        .expect("Failed to seed collection");

    // Grant owner access to the user on their collection
    test_db
        .seed_collection_owner(principal_id, collection_id, "addressbook")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let invalid_vcard = "this is not valid vcard data";
    let uri = carddav_item_path("testuser", "inv", "invalid.vcf");

    let response = TestRequest::put(&uri)
        .if_none_match("*")
        .vcard_body(invalid_vcard)
        .send(&service)
        .await;

    // Should return 403 Forbidden with valid-address-data precondition
    // or 400 Bad Request
    assert!(
        response.status == StatusCode::FORBIDDEN || response.status == StatusCode::BAD_REQUEST,
        "Expected 403 or 400 for invalid vCard, got {}",
        response.status
    );
}

// ============================================================================
// UID Conflict Tests
// ============================================================================

/// ## Summary
/// Test that PUT with duplicate UID returns no-uid-conflict error.
#[test_log::test(tokio::test)]
async fn put_uid_conflict_rejected() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    // Seed the role→permission mappings (g2 rules)
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    // Seed the authenticated user (matches config email)
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

    // Create an existing event with a specific UID
    let entity_id = test_db
        .seed_entity("icalendar", Some("duplicate-uid@example.com"))
        .await
        .expect("Failed to seed entity");

    // Use just the base name (without extension) for the instance slug
    let existing_slug = "existing-event";
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            existing_slug,
            "text/calendar",
            "\"existing\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    // Try to create a new event at a different URI with the same UID
    let ical = sample_icalendar_event("duplicate-uid@example.com", "Duplicate UID Event");
    let new_uri = caldav_item_path("testuser", "testcal", "new-event-same-uid.ics");

    let response = TestRequest::put(&new_uri)
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(&service)
        .await;

    // RFC 4791 §5.3.2.1: UID conflicts return 403 with no-uid-conflict precondition
    let response = response.assert_status(StatusCode::FORBIDDEN);

    // Verify XML error body contains no-uid-conflict element
    let body = response.body_string();
    assert!(
        body.contains("no-uid-conflict"),
        "Response should contain no-uid-conflict precondition element"
    );
}

// ============================================================================
// Sync Token Tests
// ============================================================================

/// ## Summary
/// Test that PUT bumps collection sync token.
#[test_log::test(tokio::test)]
async fn put_bumps_synctoken() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    // Seed the role→permission mappings (g2 rules)
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    // Seed the authenticated user (matches config email)
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

    // Get initial sync token
    let initial_synctoken = test_db
        .get_collection_synctoken(collection_id)
        .await
        .expect("Failed to get synctoken");

    let service = create_db_test_service(&test_db.url()).await;

    let ical = sample_icalendar_event("sync-test@example.com", "Sync Test Event");
    let uri = caldav_item_path("testuser", "testcal", "sync-test.ics");

    let response = TestRequest::put(&uri)
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(&service)
        .await;

    response.assert_status(StatusCode::CREATED);

    // Verify sync token increased
    let new_synctoken = test_db
        .get_collection_synctoken(collection_id)
        .await
        .expect("Failed to get synctoken");

    assert!(
        new_synctoken > initial_synctoken,
        "Sync token should increase after PUT"
    );
}

// ============================================================================
// ETag Response Tests
// ============================================================================

/// ## Summary
/// Test that PUT returns ETag in response.
#[test_log::test(tokio::test)]
async fn put_returns_etag() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    // Seed the role→permission mappings (g2 rules)
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    // Seed the authenticated user (matches config email)
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

    let ical = sample_icalendar_event("etag-response@example.com", "ETag Response Test");
    let uri = caldav_item_path("testuser", "testcal", "etag-response.ics");

    let response = TestRequest::put(&uri)
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(&service)
        .await;

    let response = response
        .assert_status(StatusCode::CREATED)
        .assert_header_exists("ETag");

    // Verify ETag format
    let etag = response.get_etag().expect("ETag should be present");
    assert!(
        etag.starts_with('"') && etag.ends_with('"'),
        "ETag should be a quoted string"
    );
}

/// ## Summary
/// Test that PUT updates ETag on modification.
#[test_log::test(tokio::test)]
async fn put_updates_etag() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    // Seed the role→permission mappings (g2 rules)
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    // Seed the authenticated user (matches config email)
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
        .seed_entity("icalendar", Some("etag-update@example.com"))
        .await
        .expect("Failed to seed entity");

    let uri = caldav_item_path("testuser", "testcal", "etag-update.ics");
    // Use just the base name (without extension) for the instance slug
    let item_slug = "etag-update";
    let initial_etag = "\"initial-etag\"";
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            item_slug,
            "text/calendar",
            initial_etag,
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    let ical = sample_icalendar_event("etag-update@example.com", "Updated Content");

    let response = TestRequest::put(&uri)
        .if_match(initial_etag)
        .icalendar_body(&ical)
        .send(&service)
        .await;

    assert!(
        response.status == StatusCode::OK || response.status == StatusCode::NO_CONTENT,
        "Expected 200 or 204, got {}",
        response.status
    );

    // If ETag is returned, it should be different from initial
    if let Some(new_etag) = response.get_etag() {
        assert_ne!(
            new_etag, initial_etag,
            "ETag should change after content update"
        );
    }
}

// ============================================================================
// Status Code Tests
// ============================================================================

/// ## Summary
/// Test that PUT returns 201 for new resources and 204 for updates.
#[test_log::test(tokio::test)]
async fn put_status_codes() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    // Seed the role→permission mappings (g2 rules)
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    // Seed the authenticated user (matches config email)
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

    let uri = caldav_item_path("testuser", "testcal", "status-test.ics");

    // Create new resource - should return 201
    let ical = sample_icalendar_event("status-test@example.com", "Status Test");
    let response = TestRequest::put(&uri)
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::CREATED);

    // Get ETag for update
    let etag = response.get_etag().expect("ETag from create");

    // Update existing resource - should return 200 or 204
    let updated_ical = sample_icalendar_event("status-test@example.com", "Updated Status Test");
    let response = TestRequest::put(&uri)
        .if_match(etag)
        .icalendar_body(&updated_ical)
        .send(&service)
        .await;

    assert!(
        response.status == StatusCode::OK || response.status == StatusCode::NO_CONTENT,
        "Update should return 200 or 204, got {}",
        response.status
    );
}

// ============================================================================
// Non-existent Collection Tests
// ============================================================================

/// ## Summary
/// Test that PUT to non-existent collection returns 404.
#[test_log::test(tokio::test)]
async fn put_nonexistent_collection_404() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    // Seed the role→permission mappings (g2 rules)
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    let service = create_db_test_service(&test_db.url()).await;

    let ical = sample_icalendar_event("orphan@example.com", "Orphan Event");
    // Use a slug-based path for a non-existent user/collection
    let uri = caldav_item_path("nonexistent", "nocollection", "orphan.ics");

    let response = TestRequest::put(&uri)
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(&service)
        .await;

    response.assert_status(StatusCode::NOT_FOUND);
}
