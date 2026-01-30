#![allow(clippy::unused_async, unused_must_use, clippy::too_many_lines)]
//! Authorization integration tests.
//!
//! Verifies that handlers correctly return 403 Forbidden when authorization
//! is denied and 200 OK (or appropriate success codes) when authorized.
//!
//! ## Authorization Model
//! The authorization model is path-based using Casbin policies:
//! - `seed_default_role_permissions()` sets up role→permission mappings (g2 rules)
//! - `seed_access_policy(subject, path_pattern, role)` grants a subject a role on a path
//! - `seed_collection_owner(principal_id, collection_id, type)` is a convenience for owner access
//!
//! ## Path Patterns
//! - `/cal/{owner_slug}/{collection_slug}/**` - matches all items in a calendar collection
//! - `/card/{owner_slug}/{collection_slug}/**` - matches all items in an addressbook collection
//!
//! ## Roles and Permissions
//! - `reader`: read, `read_freebusy`
//! - `editor-basic`: read, `read_freebusy`, edit
//! - `editor`: read, `read_freebusy`, edit, delete
//! - `owner`: all permissions including admin

use salvo::http::StatusCode;

use super::helpers::*;

// ============================================================================
// GET Authorization Tests
// ============================================================================

/// ## Summary
/// Test that GET returns 403 Forbidden when no permission is granted.
#[test_log::test(tokio::test)]
async fn get_returns_403_without_permission() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    // Seed role→permission mappings (g2 rules)
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    // Create an authenticated user (slug: "testuser")
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

    let instance_uri = "event-123";
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

    // NO access policy is seeded - request should be denied
    let service = create_db_test_service(&test_db.url()).await;

    // Use path helper for proper URL construction
    let request_path = caldav_item_path("testuser", "testcal", "event-123.ics");
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
#[test_log::test(tokio::test)]
async fn get_returns_200_with_read_permission() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    // Seed role→permission mappings
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    // Create an authenticated user
    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let collection_id = test_db
        .seed_collection(
            principal_id,
            CollectionType::Calendar,
            "bobcal",
            Some("Bob Calendar"),
        )
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

    let instance_uri = "event-456";
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

    // Grant reader access to the authenticated user on their collection
    // Use UUID-based path pattern for authorization
    let path_pattern = format!("/cal/{principal_id}/{collection_id}/**");
    test_db
        .seed_access_policy(
            &format!("principal:{principal_id}"),
            &path_pattern,
            "reader",
        )
        .await
        .expect("Failed to seed access policy");

    let service = create_db_test_service(&test_db.url()).await;

    let request_path = caldav_item_path("testuser", "bobcal", "event-456.ics");
    let response = TestRequest::get(&request_path).send(&service).await;

    // Expect 200 OK since read permission is granted
    response.assert_status(StatusCode::OK);
}

// ============================================================================
// DELETE Authorization Tests
// ============================================================================

/// ## Summary
/// Test that DELETE returns 403 Forbidden when only read permission is granted.
#[test_log::test(tokio::test)]
async fn delete_returns_403_without_write_permission() {
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
            "charliecal",
            Some("Charlie Cal"),
        )
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

    let instance_uri = "event-789";
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

    // Grant only READ permission (reader role) - delete should be denied
    let path_pattern = format!("/cal/{principal_id}/{collection_id}/**");
    test_db
        .seed_access_policy(
            &format!("principal:{principal_id}"),
            &path_pattern,
            "reader",
        )
        .await
        .expect("Failed to seed access policy");

    let service = create_db_test_service(&test_db.url()).await;

    let request_path = caldav_item_path("testuser", "charliecal", "event-789.ics");
    let response = TestRequest::delete(&request_path).send(&service).await;

    // Debug: print body if not expected status
    if response.status != StatusCode::FORBIDDEN {
        eprintln!("DELETE Response status: {}", response.status);
        eprintln!(
            "DELETE Response body: {}",
            String::from_utf8_lossy(&response.body)
        );
    }

    // Expect 403 Forbidden since only read (not delete) permission is granted
    response.assert_status(StatusCode::FORBIDDEN);
}

/// ## Summary
/// Test that DELETE returns 204 No Content when editor permission is granted.
#[test_log::test(tokio::test)]
async fn delete_returns_204_with_write_permission() {
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
            "danacal",
            Some("Dana Cal"),
        )
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

    let instance_uri = "event-del";
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

    // Grant editor permission (includes delete) - delete should succeed
    // Use UUID-based path pattern for authorization
    let path_pattern = format!("/cal/{principal_id}/{collection_id}/**");
    test_db
        .seed_access_policy(
            &format!("principal:{principal_id}"),
            &path_pattern,
            "editor",
        )
        .await
        .expect("Failed to seed access policy");

    let service = create_db_test_service(&test_db.url()).await;

    let request_path = caldav_item_path("testuser", "danacal", "event-del.ics");
    let response = TestRequest::delete(&request_path).send(&service).await;

    // Expect 204 No Content since editor permission includes delete
    response.assert_status(StatusCode::NO_CONTENT);
}

// ============================================================================
// PUT Authorization Tests
// ============================================================================

/// ## Summary
/// Test that PUT (create new resource) returns 403 when no write permission on collection.
#[test_log::test(tokio::test)]
async fn put_new_returns_403_without_collection_write_permission() {
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
        .seed_collection(
            principal_id,
            CollectionType::Calendar,
            "evecal",
            Some("Eve Cal"),
        )
        .await
        .expect("Failed to seed collection");

    // NO write permission granted on collection
    let request_path = caldav_item_path("testuser", "evecal", "new-event.ics");

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
/// Test that PUT (update existing resource) returns 403 when only read permission.
#[test_log::test(tokio::test)]
async fn put_update_returns_403_without_write_permission() {
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
            "frankcal",
            Some("Frank Cal"),
        )
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

    let instance_uri = "existing";
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

    // Grant only reader permission - PUT should be denied
    let path_pattern = format!("/cal/{principal_id}/{collection_id}/**");
    test_db
        .seed_access_policy(
            &format!("principal:{principal_id}"),
            &path_pattern,
            "reader",
        )
        .await
        .expect("Failed to seed access policy");

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

    let request_path = caldav_item_path("testuser", "frankcal", "existing.ics");
    let response = TestRequest::put(&request_path)
        .header("Content-Type", "text/calendar")
        .body(ics_body)
        .send(&service)
        .await;

    // Expect 403 Forbidden since only read (not edit) permission
    response.assert_status(StatusCode::FORBIDDEN);
}

// ============================================================================
// PROPFIND Authorization Tests
// ============================================================================

/// ## Summary
/// Test that PROPFIND on a resource returns 403 when no permission.
#[test_log::test(tokio::test)]
async fn propfind_returns_403_without_permission() {
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
            "gracecal",
            Some("Grace Cal"),
        )
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

    let instance_uri = "propfind-event";
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

    // NO permission granted
    let service = create_db_test_service(&test_db.url()).await;

    let propfind_body = r#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
  </D:prop>
</D:propfind>"#;

    let request_path = caldav_item_path("testuser", "gracecal", "propfind-event.ics");
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
/// Test that PROPPATCH returns 403 when only read permission.
#[test_log::test(tokio::test)]
async fn proppatch_returns_403_without_write_permission() {
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
            "henrycal",
            Some("Henry Cal"),
        )
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

    let instance_uri = "proppatch-event";
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

    // Grant only reader permission
    let path_pattern = format!("/cal/{principal_id}/{collection_id}/**");
    test_db
        .seed_access_policy(
            &format!("principal:{principal_id}"),
            &path_pattern,
            "reader",
        )
        .await
        .expect("Failed to seed access policy");

    let service = create_db_test_service(&test_db.url()).await;

    let proppatch_body = r#"<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <D:displayname>Updated Name</D:displayname>
    </D:prop>
  </D:set>
</D:propertyupdate>"#;

    let request_path = caldav_item_path("testuser", "henrycal", "proppatch-event.ics");
    let response = TestRequest::proppatch(&request_path)
        .header("Content-Type", "application/xml")
        .body(proppatch_body)
        .send(&service)
        .await;

    // Expect 403 Forbidden since only read permission
    response.assert_status(StatusCode::FORBIDDEN);
}

// ============================================================================
// Role Permission Tests
// ============================================================================

/// ## Summary
/// Test that owner role includes read permission.
/// Owner role should allow read access via role→permission mapping.
#[test_log::test(tokio::test)]
async fn get_returns_200_with_owner_role_for_read_action() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    // Seed role→permission mappings
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    // Create an authenticated user
    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let collection_id = test_db
        .seed_collection(
            principal_id,
            CollectionType::Calendar,
            "bobcal",
            Some("Bob Cal"),
        )
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

    let instance_uri = "owner-hierarchy";
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

    // Grant owner access using the convenience method
    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    // Owner role includes read permission via g2 mapping
    let request_path = caldav_item_path("testuser", "bobcal", "owner-hierarchy.ics");
    let response = TestRequest::get(&request_path).send(&service).await;

    // Expect 200 OK because owner role includes read permission
    response.assert_status(StatusCode::OK);
}

/// ## Summary
/// Test that editor-basic role includes read permission.
/// Editor-basic role should allow read access via role→permission mapping.
#[test_log::test(tokio::test)]
async fn get_returns_200_with_edit_role_for_read_action() {
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
            "carolcal",
            Some("Carol Cal"),
        )
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

    let instance_uri = "edit-hierarchy";
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

    // Grant editor-basic role (includes read, edit but not delete)
    let path_pattern = format!("/cal/{principal_id}/{collection_id}/**");
    test_db
        .seed_access_policy(
            &format!("principal:{principal_id}"),
            &path_pattern,
            "editor-basic",
        )
        .await
        .expect("Failed to seed access policy");

    let service = create_db_test_service(&test_db.url()).await;

    // Editor-basic role includes read permission via g2 mapping
    let request_path = caldav_item_path("testuser", "carolcal", "edit-hierarchy.ics");
    let response = TestRequest::get(&request_path).send(&service).await;

    response.assert_status(StatusCode::OK);
}

/// ## Summary
/// Test that editor role can perform delete actions.
#[test_log::test(tokio::test)]
async fn delete_returns_204_with_edit_role() {
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
            "davecal",
            Some("Dave Cal"),
        )
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

    let instance_uri = "edit-write";
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

    // Grant editor role (includes delete)
    let path_pattern = format!("/cal/{principal_id}/{collection_id}/**");
    test_db
        .seed_access_policy(
            &format!("principal:{principal_id}"),
            &path_pattern,
            "editor",
        )
        .await
        .expect("Failed to seed access policy");

    let service = create_db_test_service(&test_db.url()).await;

    // Editor role includes delete permission via g2 mapping
    let request_path = caldav_item_path("testuser", "davecal", "edit-write.ics");
    let response = TestRequest::delete(&request_path).send(&service).await;

    response.assert_status(StatusCode::NO_CONTENT);
}

// ============================================================================
// Group Authorization Tests
// ============================================================================

/// ## Summary
/// Test that group members inherit permissions granted to the group.
#[test_log::test(tokio::test)]
async fn group_member_inherits_group_permissions() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    // Create owner of the calendar
    let owner_principal_id = test_db
        .seed_principal(PrincipalType::User, "owner", Some("Owner"))
        .await
        .expect("Failed to seed owner principal");

    let _owner_user_id = test_db
        .seed_user("Owner", "owner@example.com", owner_principal_id)
        .await
        .expect("Failed to seed owner user");

    // Create authenticated user (member of a group)
    let member_principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    // Get the user_id for membership (need to query by principal_id)
    let member_user_id = test_db
        .get_user_id_by_principal(member_principal_id)
        .await
        .expect("Failed to get user ID from principal");

    // Create a group and add the authenticated user to it
    let group_principal_id = test_db
        .seed_principal(PrincipalType::Group, "team", Some("Team Group"))
        .await
        .expect("Failed to seed group principal");

    let group_id = test_db
        .seed_group(group_principal_id)
        .await
        .expect("Failed to seed group");

    // Add authenticated user to the group
    test_db
        .seed_membership(member_user_id, group_id)
        .await
        .expect("Failed to seed membership");

    // Create owner's calendar
    let collection_id = test_db
        .seed_collection(
            owner_principal_id,
            CollectionType::Calendar,
            "teamcal",
            Some("Team Calendar"),
        )
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("icalendar", Some("group-event@example.com"))
        .await
        .expect("Failed to seed entity");

    test_db
        .seed_minimal_icalendar_event(entity_id, "group-event@example.com", "Group Event")
        .await
        .expect("Failed to seed iCalendar event");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "group-event",
            "text/calendar",
            "\"group-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    // Grant reader role to the GROUP (not the user directly)
    let path_pattern = format!("/cal/{owner_principal_id}/{collection_id}/**");
    test_db
        .seed_access_policy(
            &format!("principal:{group_principal_id}"),
            &path_pattern,
            "reader",
        )
        .await
        .expect("Failed to seed access policy");

    let service = create_db_test_service(&test_db.url()).await;

    // Authenticated user (group member) should be able to read via group permission
    let request_path = caldav_item_path("owner", "teamcal", "group-event.ics");
    let response = TestRequest::get(&request_path).send(&service).await;

    #[expect(unused_must_use)]
    response.assert_status(StatusCode::OK);
}

/// ## Summary
/// Test that non-group members cannot access resources granted to a group.
#[test_log::test(tokio::test)]
async fn non_group_member_denied_group_resource() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    // Create owner of the calendar
    let owner_principal_id = test_db
        .seed_principal(PrincipalType::User, "owner", Some("Owner"))
        .await
        .expect("Failed to seed owner principal");

    let _owner_user_id = test_db
        .seed_user("Owner", "owner@example.com", owner_principal_id)
        .await
        .expect("Failed to seed owner user");

    // Create authenticated user (NOT a member of the group)
    let _member_principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    // Create a group (without adding authenticated user to it)
    let group_principal_id = test_db
        .seed_principal(PrincipalType::Group, "team", Some("Team Group"))
        .await
        .expect("Failed to seed group principal");

    let _group_id = test_db
        .seed_group(group_principal_id)
        .await
        .expect("Failed to seed group");

    // Create owner's calendar
    let collection_id = test_db
        .seed_collection(
            owner_principal_id,
            CollectionType::Calendar,
            "teamcal",
            Some("Team Calendar"),
        )
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("icalendar", Some("group-event@example.com"))
        .await
        .expect("Failed to seed entity");

    test_db
        .seed_minimal_icalendar_event(entity_id, "group-event@example.com", "Group Event")
        .await
        .expect("Failed to seed iCalendar event");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "group-event",
            "text/calendar",
            "\"group-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    // Grant reader role to the GROUP only
    let path_pattern = format!("/cal/{owner_principal_id}/{collection_id}/**");
    test_db
        .seed_access_policy(
            &format!("principal:{group_principal_id}"),
            &path_pattern,
            "reader",
        )
        .await
        .expect("Failed to seed access policy");

    let service = create_db_test_service(&test_db.url()).await;

    // Authenticated user (NOT a group member) should be denied
    let request_path = caldav_item_path("owner", "teamcal", "group-event.ics");
    let response = TestRequest::get(&request_path).send(&service).await;

    #[expect(unused_must_use)]
    response.assert_status(StatusCode::FORBIDDEN);
}

// ============================================================================
// Public Access Tests
// ============================================================================

/// ## Summary
/// Test that public principal can access publicly shared resources.
#[test_log::test(tokio::test)]
async fn public_principal_can_access_public_resources() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    // Create owner of the calendar
    let owner_principal_id = test_db
        .seed_principal(PrincipalType::User, "owner", Some("Owner"))
        .await
        .expect("Failed to seed owner principal");

    let _owner_user_id = test_db
        .seed_user("Owner", "owner@example.com", owner_principal_id)
        .await
        .expect("Failed to seed owner user");

    // Create authenticated user (represents public access in this test)
    let _public_principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    // Create owner's calendar
    let collection_id = test_db
        .seed_collection(
            owner_principal_id,
            CollectionType::Calendar,
            "publiccal",
            Some("Public Calendar"),
        )
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("icalendar", Some("public-event@example.com"))
        .await
        .expect("Failed to seed entity");

    test_db
        .seed_minimal_icalendar_event(entity_id, "public-event@example.com", "Public Event")
        .await
        .expect("Failed to seed iCalendar event");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "public-event",
            "text/calendar",
            "\"public-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    // Grant reader role to "all" principal (special system principal for everyone)
    let path_pattern = format!("/cal/{owner_principal_id}/{collection_id}/**");
    test_db
        .seed_access_policy("all", &path_pattern, "reader")
        .await
        .expect("Failed to seed access policy");

    let service = create_db_test_service(&test_db.url()).await;

    // Any authenticated user should be able to read (all principal matches everyone)
    let request_path = caldav_item_path("owner", "publiccal", "public-event.ics");
    let response = TestRequest::get(&request_path).send(&service).await;

    #[expect(unused_must_use)]
    response.assert_status(StatusCode::OK);
}

/// ## Summary
/// Test that public principal cannot write to read-only public resources.
#[test_log::test(tokio::test)]
async fn public_principal_denied_write_on_readonly_public() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    // Create owner of the calendar
    let owner_principal_id = test_db
        .seed_principal(PrincipalType::User, "owner", Some("Owner"))
        .await
        .expect("Failed to seed owner principal");

    let _owner_user_id = test_db
        .seed_user("Owner", "owner@example.com", owner_principal_id)
        .await
        .expect("Failed to seed owner user");

    // Create authenticated user (represents public access)
    let _public_principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    // Create owner's calendar
    let collection_id = test_db
        .seed_collection(
            owner_principal_id,
            CollectionType::Calendar,
            "publiccal",
            Some("Public Calendar"),
        )
        .await
        .expect("Failed to seed collection");

    // Grant ONLY reader role to public (no write permission)
    let path_pattern = format!("/cal/{owner_principal_id}/{collection_id}/**");
    test_db
        .seed_access_policy("public", &path_pattern, "reader")
        .await
        .expect("Failed to seed access policy");

    let service = create_db_test_service(&test_db.url()).await;

    // Try to PUT a new event (should be denied - public only has read permission)
    let ical = sample_icalendar_event("public-write@example.com", "Public Write Attempt");
    let request_path = caldav_item_path("owner", "publiccal", "new-event.ics");
    let response = TestRequest::put(&request_path)
        .icalendar_body(&ical)
        .send(&service)
        .await;

    #[expect(unused_must_use)]
    response.assert_status(StatusCode::FORBIDDEN);
}
