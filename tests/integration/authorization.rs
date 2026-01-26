#![allow(clippy::unused_async, unused_must_use, clippy::too_many_lines)]
//! Authorization integration tests.
//!
//! Verifies that handlers correctly return 403 Forbidden when authorization
//! is denied and 200 OK (or appropriate success codes) when authorized.

use salvo::http::StatusCode;
use tracing_test::traced_test;

use super::helpers::*;

// ============================================================================
// GET Authorization Tests
// ============================================================================

/// ## Summary
/// Test that GET returns 403 Forbidden when no permission is granted.
#[traced_test]
#[tokio::test]
async fn get_returns_403_without_permission() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    // Seed default policies (role hierarchy, action policies)
    test_db
        .seed_default_policies()
        .await
        .expect("Failed to seed default policies");

    // Create a principal and collection
    let principal_id = test_db
        .seed_principal("user", "/principals/alice/", Some("Alice"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "testcal", Some("Personal"))
        .await
        .expect("Failed to seed collection");

    // Create an entity and instance
    let entity_id = test_db
        .seed_entity("icalendar", Some("event-123@example.com"))
        .await
        .expect("Failed to seed entity");

    // Seed minimal iCalendar event tree (VCALENDAR + VEVENT components)
    test_db
        .seed_minimal_icalendar_event(entity_id, "event-123@example.com", "Test Event")
        .await
        .expect("Failed to seed iCalendar event");

    // URI stored in DB is just the filename; request path includes collection
    let instance_uri = "event-123.ics";
    let request_path = format!("/api/caldav/{collection_id}/{instance_uri}");
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            instance_uri,
            "text/calendar",
            "\"abc123\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    // Seed resource type for the entity (required for casbin matching)
    let resource_str = format!("evt:{entity_id}");
    test_db
        .seed_resource_type(&resource_str, "calendar_event")
        .await
        .expect("Failed to seed resource type");

    // NO grant is seeded - request should be denied
    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::get(&request_path).send(&service).await;

    // Debug: print body if not the expected status
    if response.status != StatusCode::FORBIDDEN {
        eprintln!("Response body: {}", String::from_utf8_lossy(&response.body));
    }

    // Expect 403 Forbidden since no permission is granted
    response.assert_status(StatusCode::FORBIDDEN);
}

/// ## Summary
/// Test that GET returns 200 OK when read permission is granted.
#[traced_test]
#[tokio::test]
async fn get_returns_200_with_read_permission() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    // Seed default policies
    test_db
        .seed_default_policies()
        .await
        .expect("Failed to seed default policies");

    // Create a principal and collection
    let principal_id = test_db
        .seed_principal("user", "/principals/bob/", Some("Bob"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "bobcal", Some("Bob Calendar"))
        .await
        .expect("Failed to seed collection");

    // Create an entity and instance
    let entity_id = test_db
        .seed_entity("icalendar", Some("event-456@example.com"))
        .await
        .expect("Failed to seed entity");

    // Seed minimal iCalendar event tree
    test_db
        .seed_minimal_icalendar_event(entity_id, "event-456@example.com", "Test Event 456")
        .await
        .expect("Failed to seed iCalendar event");

    let instance_uri = "event-456.ics";
    let request_path = format!("/api/caldav/{collection_id}/{instance_uri}");
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            instance_uri,
            "text/calendar",
            "\"def456\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    // Seed resource type for the entity
    let resource_str = format!("evt:{entity_id}");
    test_db
        .seed_resource_type(&resource_str, "calendar_event")
        .await
        .expect("Failed to seed resource type");

    // Grant read permission to the public principal
    test_db
        .seed_grant("public", &resource_str, "read")
        .await
        .expect("Failed to seed grant");

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::get(&request_path).send(&service).await;

    // Expect 200 OK since read permission is granted
    response.assert_status(StatusCode::OK);
}

// ============================================================================
// DELETE Authorization Tests
// ============================================================================

/// ## Summary
/// Test that DELETE returns 403 Forbidden when no write permission is granted.
#[traced_test]
#[tokio::test]
async fn delete_returns_403_without_write_permission() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    test_db
        .seed_default_policies()
        .await
        .expect("Failed to seed default policies");

    let principal_id = test_db
        .seed_principal("user", "/principals/charlie/", Some("Charlie"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "charliecal", Some("Charlie Cal"))
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("icalendar", Some("event-789@example.com"))
        .await
        .expect("Failed to seed entity");

    // Seed minimal iCalendar event tree
    test_db
        .seed_minimal_icalendar_event(entity_id, "event-789@example.com", "Test Event 789")
        .await
        .expect("Failed to seed iCalendar event");

    let instance_uri = "event-789.ics";
    let request_path = format!("/api/caldav/{collection_id}/{instance_uri}");
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            instance_uri,
            "text/calendar",
            "\"ghi789\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    // Seed resource type
    let resource_str = format!("evt:{entity_id}");
    test_db
        .seed_resource_type(&resource_str, "calendar_event")
        .await
        .expect("Failed to seed resource type");

    // Grant only READ permission (not write) - delete should be denied
    test_db
        .seed_grant("public", &resource_str, "read")
        .await
        .expect("Failed to seed grant");

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::delete(&request_path).send(&service).await;

    // Debug: print body if not expected status
    if response.status != StatusCode::FORBIDDEN {
        eprintln!("DELETE Response status: {}", response.status);
        eprintln!(
            "DELETE Response body: {}",
            String::from_utf8_lossy(&response.body)
        );
    }

    // Expect 403 Forbidden since only read (not write) permission is granted
    response.assert_status(StatusCode::FORBIDDEN);
}

/// ## Summary
/// Test that DELETE returns 204 No Content when write permission is granted.
#[traced_test]
#[tokio::test]
async fn delete_returns_204_with_write_permission() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    test_db
        .seed_default_policies()
        .await
        .expect("Failed to seed default policies");

    let principal_id = test_db
        .seed_principal("user", "/principals/dana/", Some("Dana"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "danacal", Some("Dana Cal"))
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("icalendar", Some("event-del@example.com"))
        .await
        .expect("Failed to seed entity");

    // Seed minimal iCalendar event tree
    test_db
        .seed_minimal_icalendar_event(entity_id, "event-del@example.com", "Event to Delete")
        .await
        .expect("Failed to seed iCalendar event");

    let instance_uri = "event-del.ics";
    let request_path = format!("/api/caldav/{collection_id}/{instance_uri}");
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            instance_uri,
            "text/calendar",
            "\"jkl012\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    // Seed resource type
    let resource_str = format!("evt:{entity_id}");
    test_db
        .seed_resource_type(&resource_str, "calendar_event")
        .await
        .expect("Failed to seed resource type");

    // Grant edit permission - delete should succeed
    test_db
        .seed_grant("public", &resource_str, "edit")
        .await
        .expect("Failed to seed grant");

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::delete(&request_path).send(&service).await;

    // Expect 204 No Content since write permission is granted
    response.assert_status(StatusCode::NO_CONTENT);
}

// ============================================================================
// PUT Authorization Tests
// ============================================================================

/// ## Summary
/// Test that PUT (create new resource) returns 403 when no write permission on collection.
#[traced_test]
#[tokio::test]
async fn put_new_returns_403_without_collection_write_permission() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    test_db
        .seed_default_policies()
        .await
        .expect("Failed to seed default policies");

    let principal_id = test_db
        .seed_principal("user", "/principals/eve/", Some("Eve"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "evecal", Some("Eve Cal"))
        .await
        .expect("Failed to seed collection");

    // Seed resource type for collection
    let collection_resource = format!("cal:{collection_id}");
    test_db
        .seed_resource_type(&collection_resource, "calendar")
        .await
        .expect("Failed to seed collection resource type");

    // NO write permission granted on collection
    let request_path = format!("/api/caldav/{collection_id}/new-event.ics");

    let ics_body = r"BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:new-event@example.com
DTSTART:20250101T100000Z
DTEND:20250101T110000Z
SUMMARY:New Event
END:VEVENT
END:VCALENDAR";

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::put(&request_path)
        .header("Content-Type", "text/calendar")
        .body(ics_body)
        .send(&service)
        .await;

    // Expect 403 Forbidden since no write permission on collection
    response.assert_status(StatusCode::FORBIDDEN);
}

/// ## Summary
/// Test that PUT (update existing resource) returns 403 when no write permission.
#[traced_test]
#[tokio::test]
async fn put_update_returns_403_without_write_permission() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    test_db
        .seed_default_policies()
        .await
        .expect("Failed to seed default policies");

    let principal_id = test_db
        .seed_principal("user", "/principals/frank/", Some("Frank"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "frankcal", Some("Frank Cal"))
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("icalendar", Some("existing@example.com"))
        .await
        .expect("Failed to seed entity");

    // Seed minimal iCalendar event tree
    test_db
        .seed_minimal_icalendar_event(entity_id, "existing@example.com", "Existing Event")
        .await
        .expect("Failed to seed iCalendar event");

    let instance_uri = "existing.ics";
    let request_path = format!("/api/caldav/{collection_id}/{instance_uri}");
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            instance_uri,
            "text/calendar",
            "\"old-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    // Seed resource type but only with read permission
    let resource_str = format!("evt:{entity_id}");
    test_db
        .seed_resource_type(&resource_str, "calendar_event")
        .await
        .expect("Failed to seed resource type");

    test_db
        .seed_grant("public", &resource_str, "read")
        .await
        .expect("Failed to seed grant");

    let ics_body = r"BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:existing@example.com
DTSTART:20250101T100000Z
DTEND:20250101T110000Z
SUMMARY:Updated Event
END:VEVENT
END:VCALENDAR";

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::put(&request_path)
        .header("Content-Type", "text/calendar")
        .body(ics_body)
        .send(&service)
        .await;

    // Expect 403 Forbidden since only read (not write) permission
    response.assert_status(StatusCode::FORBIDDEN);
}

// ============================================================================
// PROPFIND Authorization Tests
// ============================================================================

/// ## Summary
/// Test that PROPFIND on a resource returns 403 when no permission.
#[traced_test]
#[tokio::test]
async fn propfind_returns_403_without_permission() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    test_db
        .seed_default_policies()
        .await
        .expect("Failed to seed default policies");

    let principal_id = test_db
        .seed_principal("user", "/principals/grace/", Some("Grace"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "gracecal", Some("Grace Cal"))
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("icalendar", Some("propfind-event@example.com"))
        .await
        .expect("Failed to seed entity");

    // Seed minimal iCalendar event tree
    test_db
        .seed_minimal_icalendar_event(entity_id, "propfind-event@example.com", "Propfind Event")
        .await
        .expect("Failed to seed iCalendar event");

    let instance_uri = "propfind-event.ics";
    let request_path = format!("/api/caldav/{collection_id}/{instance_uri}");
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            instance_uri,
            "text/calendar",
            "\"propfind-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    // Seed resource type for the entity (required for casbin matching)
    let resource_str = format!("evt:{entity_id}");
    test_db
        .seed_resource_type(&resource_str, "calendar_event")
        .await
        .expect("Failed to seed resource type");

    // NO permission granted
    let service = create_db_test_service(&test_db.url()).await;

    let propfind_body = r#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
  </D:prop>
</D:propfind>"#;

    let response = TestRequest::propfind(&request_path)
        .header("Content-Type", "application/xml")
        .header("Depth", "0")
        .body(propfind_body)
        .send(&service)
        .await;

    // Expect 403 Forbidden
    response.assert_status(StatusCode::FORBIDDEN);
}

// ============================================================================
// PROPPATCH Authorization Tests
// ============================================================================

/// ## Summary
/// Test that PROPPATCH returns 403 when no write permission.
#[traced_test]
#[tokio::test]
async fn proppatch_returns_403_without_write_permission() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    test_db
        .seed_default_policies()
        .await
        .expect("Failed to seed default policies");

    let principal_id = test_db
        .seed_principal("user", "/principals/henry/", Some("Henry"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "henrycal", Some("Henry Cal"))
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("icalendar", Some("proppatch-event@example.com"))
        .await
        .expect("Failed to seed entity");

    // Seed minimal iCalendar event tree
    test_db
        .seed_minimal_icalendar_event(entity_id, "proppatch-event@example.com", "Proppatch Event")
        .await
        .expect("Failed to seed iCalendar event");

    let instance_uri = "proppatch-event.ics";
    let request_path = format!("/api/caldav/{collection_id}/{instance_uri}");
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            instance_uri,
            "text/calendar",
            "\"proppatch-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    // Grant only read permission
    let resource_str = format!("evt:{entity_id}");
    test_db
        .seed_resource_type(&resource_str, "calendar_event")
        .await
        .expect("Failed to seed resource type");

    test_db
        .seed_grant("public", &resource_str, "read")
        .await
        .expect("Failed to seed grant");

    let service = create_db_test_service(&test_db.url()).await;

    let proppatch_body = r#"<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <D:displayname>Updated Name</D:displayname>
    </D:prop>
  </D:set>
</D:propertyupdate>"#;

    let response = TestRequest::proppatch(&request_path)
        .header("Content-Type", "application/xml")
        .body(proppatch_body)
        .send(&service)
        .await;

    // Expect 403 Forbidden since only read permission
    response.assert_status(StatusCode::FORBIDDEN);
}

// ============================================================================
// Role Hierarchy Tests
// ============================================================================

/// ## Summary
/// Test that role hierarchy is respected: a principal with "owner" role
/// can access resources requiring "read" role via g5 hierarchy.
///
/// Role hierarchy: owner > admin > edit-share > edit > read-share > read > read-freebusy
#[traced_test]
#[tokio::test]
async fn get_returns_200_with_owner_role_for_read_action() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    // Seed default policies (role hierarchy, action policies)
    test_db
        .seed_default_policies()
        .await
        .expect("Failed to seed default policies");

    // Create a principal and collection
    let principal_id = test_db
        .seed_principal("user", "/principals/bob/", Some("Bob"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "bobcal", Some("Bob Cal"))
        .await
        .expect("Failed to seed collection");

    // Create an entity and instance
    let entity_id = test_db
        .seed_entity("icalendar", Some("owner-hierarchy@example.com"))
        .await
        .expect("Failed to seed entity");

    // Seed minimal iCalendar event tree
    test_db
        .seed_minimal_icalendar_event(
            entity_id,
            "owner-hierarchy@example.com",
            "Owner Hierarchy Event",
        )
        .await
        .expect("Failed to seed iCalendar event");

    let instance_uri = "owner-hierarchy.ics";
    let request_path = format!("/api/caldav/{collection_id}/{instance_uri}");
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            instance_uri,
            "text/calendar",
            "\"owner-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    // Grant "owner" role (highest in hierarchy)
    let resource_str = format!("evt:{entity_id}");
    test_db
        .seed_resource_type(&resource_str, "calendar_event")
        .await
        .expect("Failed to seed resource type");

    test_db
        .seed_grant("public", &resource_str, "owner")
        .await
        .expect("Failed to seed grant with owner role");

    let service = create_db_test_service(&test_db.url()).await;

    // Policy requires "read" role, but we have "owner" role.
    // With role hierarchy (owner > ... > read), this should succeed.
    let response = TestRequest::get(&request_path).send(&service).await;

    // Expect 200 OK because owner role implies read via g5 hierarchy
    response.assert_status(StatusCode::OK);
}

/// ## Summary
/// Test that role hierarchy works for "edit" role accessing read-only resources.
/// Edit role should allow read access via hierarchy: edit > read-share > read
#[traced_test]
#[tokio::test]
async fn get_returns_200_with_edit_role_for_read_action() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    test_db
        .seed_default_policies()
        .await
        .expect("Failed to seed default policies");

    let principal_id = test_db
        .seed_principal("user", "/principals/carol/", Some("Carol"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "carolcal", Some("Carol Cal"))
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("icalendar", Some("edit-hierarchy@example.com"))
        .await
        .expect("Failed to seed entity");

    test_db
        .seed_minimal_icalendar_event(
            entity_id,
            "edit-hierarchy@example.com",
            "Edit Hierarchy Event",
        )
        .await
        .expect("Failed to seed iCalendar event");

    let instance_uri = "edit-hierarchy.ics";
    let request_path = format!("/api/caldav/{collection_id}/{instance_uri}");
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            instance_uri,
            "text/calendar",
            "\"edit-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    // Grant "edit" role
    let resource_str = format!("evt:{entity_id}");
    test_db
        .seed_resource_type(&resource_str, "calendar_event")
        .await
        .expect("Failed to seed resource type");

    test_db
        .seed_grant("public", &resource_str, "edit")
        .await
        .expect("Failed to seed grant with edit role");

    let service = create_db_test_service(&test_db.url()).await;

    // Policy requires "read" role, we have "edit" role.
    // With role hierarchy (edit > read-share > read), this should succeed.
    let response = TestRequest::get(&request_path).send(&service).await;

    response.assert_status(StatusCode::OK);
}

/// ## Summary
/// Test that "edit" role can perform write actions (exact match, not hierarchy).
#[traced_test]
#[tokio::test]
async fn delete_returns_204_with_edit_role() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    test_db
        .seed_default_policies()
        .await
        .expect("Failed to seed default policies");

    let principal_id = test_db
        .seed_principal("user", "/principals/dave/", Some("Dave"))
        .await
        .expect("Failed to seed principal");

    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "davecal", Some("Dave Cal"))
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("icalendar", Some("edit-write@example.com"))
        .await
        .expect("Failed to seed entity");

    test_db
        .seed_minimal_icalendar_event(entity_id, "edit-write@example.com", "Edit Write Event")
        .await
        .expect("Failed to seed iCalendar event");

    let instance_uri = "edit-write.ics";
    let request_path = format!("/api/caldav/{collection_id}/{instance_uri}");
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            instance_uri,
            "text/calendar",
            "\"edit-write-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    // Grant "edit" role
    let resource_str = format!("evt:{entity_id}");
    test_db
        .seed_resource_type(&resource_str, "calendar_event")
        .await
        .expect("Failed to seed resource type");

    test_db
        .seed_grant("public", &resource_str, "edit")
        .await
        .expect("Failed to seed grant with edit role");

    let service = create_db_test_service(&test_db.url()).await;

    // Policy requires "edit" role for write, we have "edit" role (exact match).
    let response = TestRequest::delete(&request_path).send(&service).await;

    response.assert_status(StatusCode::NO_CONTENT);
}
