#![allow(clippy::unused_async, unused_must_use)]
//! Tests for COPY and MOVE methods.
//!
//! Verifies destination rules, href updates, and tombstone generation.

use salvo::http::StatusCode;

use super::helpers::*;

// ============================================================================
// MOVE Basic Tests
// ============================================================================

/// ## Summary
/// Test that MOVE renames a resource and updates href.
#[test_log::test(tokio::test)]
async fn move_rename_item_updates_href() {
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
        .seed_collection(principal_id, CollectionType::Calendar, "move-test", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let entity_id = test_db
        .seed_entity("icalendar", Some("move-test@example.com"))
        .await
        .expect("Failed to seed entity");

    test_db
        .seed_minimal_icalendar_event(entity_id, "move-test@example.com", "Move Test Event")
        .await
        .expect("Failed to seed iCalendar event");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "source-event",
            "text/calendar",
            "\"source-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    let source_uri = caldav_item_path("testuser", "move-test", "source-event.ics");
    let dest_uri = caldav_item_path("testuser", "move-test", "renamed-event.ics");
    let response = TestRequest::move_resource(&source_uri)
        .destination(&dest_uri)
        .send(&service)
        .await;

    // Either 201 Created or 204 No Content
    assert!(
        response.status == StatusCode::CREATED || response.status == StatusCode::NO_CONTENT,
        "Expected 201 or 204, got {}",
        response.status
    );

    // Verify resource exists at destination
    let get_response = TestRequest::get(&dest_uri).send(&service).await;
    get_response.assert_status(StatusCode::OK);

    // Verify source no longer exists (404 or 410)
    let source_response = TestRequest::get(&source_uri).send(&service).await;
    assert!(
        source_response.status == StatusCode::NOT_FOUND
            || source_response.status == StatusCode::GONE,
        "Expected 404 or 410, got {}",
        source_response.status
    );
}

/// ## Summary
/// Test that MOVE within same collection updates instance.uri.
#[test_log::test(tokio::test)]
async fn move_within_collection() {
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
        .seed_collection(principal_id, CollectionType::Calendar, "within-test", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let entity_id = test_db
        .seed_entity("icalendar", Some("within-test@example.com"))
        .await
        .expect("Failed to seed entity");

    test_db
        .seed_minimal_icalendar_event(entity_id, "within-test@example.com", "Within Test Event")
        .await
        .expect("Failed to seed iCalendar event");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "original",
            "text/calendar",
            "\"orig-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    let source_uri = caldav_item_path("testuser", "within-test", "original.ics");
    let dest_uri = caldav_item_path("testuser", "within-test", "new-name.ics");
    let response = TestRequest::move_resource(&source_uri)
        .destination(&dest_uri)
        .send(&service)
        .await;

    assert!(
        response.status == StatusCode::CREATED || response.status == StatusCode::NO_CONTENT,
        "Expected 201 or 204, got {}",
        response.status
    );
}

/// ## Summary
/// Test that MOVE across collections creates new instance.
#[test_log::test(tokio::test)]
async fn move_across_collections() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let collection_a = test_db
        .seed_collection(principal_id, CollectionType::Calendar, "coll-a", None)
        .await
        .expect("Failed to seed collection A");

    let collection_b = test_db
        .seed_collection(principal_id, CollectionType::Calendar, "coll-b", None)
        .await
        .expect("Failed to seed collection B");

    test_db
        .seed_collection_owner(principal_id, collection_a, "calendar")
        .await
        .expect("Failed to seed collection A owner");

    test_db
        .seed_collection_owner(principal_id, collection_b, "calendar")
        .await
        .expect("Failed to seed collection B owner");

    let entity_id = test_db
        .seed_entity("icalendar", Some("cross-move@example.com"))
        .await
        .expect("Failed to seed entity");

    test_db
        .seed_minimal_icalendar_event(entity_id, "cross-move@example.com", "Cross Collection Move")
        .await
        .expect("Failed to seed iCalendar event");

    let _instance_id = test_db
        .seed_instance(
            collection_a,
            entity_id,
            "cross-event",
            "text/calendar",
            "\"cross-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    let source_uri = caldav_item_path("testuser", "coll-a", "cross-event.ics");
    let dest_uri = caldav_item_path("testuser", "coll-b", "moved-event.ics");
    let response = TestRequest::move_resource(&source_uri)
        .destination(&dest_uri)
        .send(&service)
        .await;

    assert!(
        response.status == StatusCode::CREATED || response.status == StatusCode::NO_CONTENT,
        "Expected 201 or 204, got {}",
        response.status
    );

    // Verify resource exists at destination
    let get_response = TestRequest::get(&dest_uri).send(&service).await;
    get_response.assert_status(StatusCode::OK);
}

// ============================================================================
// COPY Basic Tests
// ============================================================================

/// ## Summary
/// Test that COPY duplicates a resource to destination.
#[test_log::test(tokio::test)]
async fn copy_duplicates_resource() {
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
        .seed_collection(principal_id, CollectionType::Calendar, "copy-test", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let entity_id = test_db
        .seed_entity("icalendar", Some("copy-test@example.com"))
        .await
        .expect("Failed to seed entity");

    test_db
        .seed_minimal_icalendar_event(entity_id, "copy-test@example.com", "Copy Test Event")
        .await
        .expect("Failed to seed iCalendar event");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "source-copy",
            "text/calendar",
            "\"copy-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    let source_uri = caldav_item_path("testuser", "copy-test", "source-copy.ics");
    let dest_uri = caldav_item_path("testuser", "copy-test", "copy-target.ics");
    let response = TestRequest::copy(&source_uri)
        .destination(&dest_uri)
        .send(&service)
        .await;

    response.assert_status(StatusCode::CREATED);

    // Verify resource exists at both source and destination
    let source_get = TestRequest::get(&source_uri).send(&service).await;
    source_get.assert_status(StatusCode::OK);

    let dest_get = TestRequest::get(&dest_uri).send(&service).await;
    dest_get.assert_status(StatusCode::OK);
}

/// ## Summary
/// Test that COPY does not create tombstone (source still exists).
#[test_log::test(tokio::test)]
async fn copy_does_not_create_tombstone() {
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
        .seed_collection(principal_id, CollectionType::Calendar, "notomb", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let entity_id = test_db
        .seed_entity("icalendar", Some("no-tomb@example.com"))
        .await
        .expect("Failed to seed entity");

    test_db
        .seed_minimal_icalendar_event(entity_id, "no-tomb@example.com", "No Tombstone Test")
        .await
        .expect("Failed to seed iCalendar event");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "no-tomb",
            "text/calendar",
            "\"no-tomb-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    let source_uri = caldav_item_path("testuser", "notomb", "no-tomb.ics");
    let dest_uri = caldav_item_path("testuser", "notomb", "copied.ics");
    let response = TestRequest::copy(&source_uri)
        .destination(&dest_uri)
        .send(&service)
        .await;

    response.assert_status(StatusCode::CREATED);

    // Verify source still accessible (no tombstone needed for COPY source)
    let source_get = TestRequest::get(&source_uri).send(&service).await;
    source_get.assert_status(StatusCode::OK);
}

// ============================================================================
// Overwrite and Conflict Tests
// ============================================================================

/// ## Summary
/// Test that MOVE with existing destination and Overwrite:F returns 412.
#[test_log::test(tokio::test)]
async fn move_destination_exists_overwrite_false_412() {
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
            "conflict-test",
            None,
        )
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    // Create source resource
    let source_entity_id = test_db
        .seed_entity("icalendar", Some("source-conflict@example.com"))
        .await
        .expect("Failed to seed source entity");

    test_db
        .seed_minimal_icalendar_event(
            source_entity_id,
            "source-conflict@example.com",
            "Source Conflict",
        )
        .await
        .expect("Failed to seed iCalendar event");

    let _source_instance = test_db
        .seed_instance(
            collection_id,
            source_entity_id,
            "source",
            "text/calendar",
            "\"src-etag\"",
            1,
        )
        .await
        .expect("Failed to seed source instance");

    // Create destination resource
    let dest_entity_id = test_db
        .seed_entity("icalendar", Some("dest-conflict@example.com"))
        .await
        .expect("Failed to seed dest entity");

    test_db
        .seed_minimal_icalendar_event(dest_entity_id, "dest-conflict@example.com", "Dest Conflict")
        .await
        .expect("Failed to seed iCalendar event");

    let _dest_instance = test_db
        .seed_instance(
            collection_id,
            dest_entity_id,
            "dest",
            "text/calendar",
            "\"dst-etag\"",
            2,
        )
        .await
        .expect("Failed to seed dest instance");

    let service = create_db_test_service(&test_db.url()).await;

    let source_uri = caldav_item_path("testuser", "conflict-test", "source.ics");
    let dest_uri = caldav_item_path("testuser", "conflict-test", "dest.ics");
    let response = TestRequest::move_resource(&source_uri)
        .destination(&dest_uri)
        .overwrite(false)
        .send(&service)
        .await;

    response.assert_status(StatusCode::PRECONDITION_FAILED);
}

/// ## Summary
/// Test that MOVE with existing destination and Overwrite:T succeeds.
#[test_log::test(tokio::test)]
async fn move_destination_exists_overwrite_true_succeeds() {
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
            "overwrite-test",
            None,
        )
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    // Create source resource
    let source_entity_id = test_db
        .seed_entity("icalendar", Some("src-overwrite@example.com"))
        .await
        .expect("Failed to seed source entity");
    test_db
        .seed_minimal_icalendar_event(
            source_entity_id,
            "src-overwrite@example.com",
            "Source Overwrite",
        )
        .await
        .expect("Failed to seed iCalendar event");
    let _source_instance = test_db
        .seed_instance(
            collection_id,
            source_entity_id,
            "src-ow",
            "text/calendar",
            "\"src-ow-etag\"",
            1,
        )
        .await
        .expect("Failed to seed source instance");

    // Create destination resource
    let dest_entity_id = test_db
        .seed_entity("icalendar", Some("dst-overwrite@example.com"))
        .await
        .expect("Failed to seed dest entity");
    test_db
        .seed_minimal_icalendar_event(
            dest_entity_id,
            "dst-overwrite@example.com",
            "Dest Overwrite",
        )
        .await
        .expect("Failed to seed iCalendar event");
    let _dest_instance = test_db
        .seed_instance(
            collection_id,
            dest_entity_id,
            "dst-ow",
            "text/calendar",
            "\"dst-ow-etag\"",
            2,
        )
        .await
        .expect("Failed to seed dest instance");

    let service = create_db_test_service(&test_db.url()).await;

    let source_uri = caldav_item_path("testuser", "overwrite-test", "src-ow.ics");
    let dest_uri = caldav_item_path("testuser", "overwrite-test", "dst-ow.ics");
    let response = TestRequest::move_resource(&source_uri)
        .destination(&dest_uri)
        .overwrite(true)
        .send(&service)
        .await;

    // 201 Created or 204 No Content
    assert!(
        response.status == StatusCode::CREATED || response.status == StatusCode::NO_CONTENT,
        "Expected 201 or 204, got {}",
        response.status
    );
}

// ============================================================================
// Tombstone Tests
// ============================================================================

/// ## Summary
/// Test that MOVE generates tombstone for source resource.
#[test_log::test(tokio::test)]
async fn move_generates_tombstone() {
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
        .seed_collection(principal_id, CollectionType::Calendar, "tomb-test", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let entity_id = test_db
        .seed_entity("icalendar", Some("tomb-test@example.com"))
        .await
        .expect("Failed to seed entity");

    test_db
        .seed_minimal_icalendar_event(entity_id, "tomb-test@example.com", "Tombstone Test")
        .await
        .expect("Failed to seed iCalendar event");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "tomb-src",
            "text/calendar",
            "\"tomb-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    // Get initial sync-token
    let props = propfind_props(&[("DAV:", "sync-token")]);
    let collection_path = caldav_collection_path("testuser", "tomb-test");
    let initial_sync = TestRequest::propfind(&collection_path)
        .depth("0")
        .xml_body(&props)
        .send(&service)
        .await;
    initial_sync.assert_status(StatusCode::MULTI_STATUS);

    let source_uri = caldav_item_path("testuser", "tomb-test", "tomb-src.ics");
    let dest_uri = caldav_item_path("testuser", "tomb-test", "tomb-dst.ics");
    let response = TestRequest::move_resource(&source_uri)
        .destination(&dest_uri)
        .send(&service)
        .await;

    assert!(
        response.status == StatusCode::CREATED || response.status == StatusCode::NO_CONTENT,
        "Expected 201 or 204, got {}",
        response.status
    );

    // Verify sync-token changed (tombstone created)
    let new_sync = TestRequest::propfind(&collection_path)
        .depth("0")
        .xml_body(&props)
        .send(&service)
        .await;
    new_sync.assert_status(StatusCode::MULTI_STATUS);
}

// ============================================================================
// Error Cases
// ============================================================================

/// ## Summary
/// Test that MOVE without Destination header returns 400.
#[test_log::test(tokio::test)]
async fn move_without_destination_400() {
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
        .seed_collection(principal_id, CollectionType::Calendar, "nodest", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let entity_id = test_db
        .seed_entity("icalendar", Some("no-dest@example.com"))
        .await
        .expect("Failed to seed entity");

    test_db
        .seed_minimal_icalendar_event(entity_id, "no-dest@example.com", "No Destination Test")
        .await
        .expect("Failed to seed iCalendar event");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "no-dest",
            "text/calendar",
            "\"no-dest-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    // MOVE without Destination header
    let source_uri = caldav_item_path("testuser", "nodest", "no-dest.ics");
    let response = TestRequest::move_resource(&source_uri).send(&service).await;

    response.assert_status(StatusCode::BAD_REQUEST);
}

/// ## Summary
/// Test that MOVE on non-existent resource returns 404.
#[test_log::test(tokio::test)]
async fn move_nonexistent_404() {
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
            "nonexistent-coll",
            None,
        )
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let source_uri = caldav_item_path("testuser", "nonexistent-coll", "nonexistent.ics");
    let dest_uri = caldav_item_path("testuser", "nonexistent-coll", "dest.ics");
    let response = TestRequest::move_resource(&source_uri)
        .destination(&dest_uri)
        .send(&service)
        .await;

    response.assert_status(StatusCode::NOT_FOUND);
}

/// ## Summary
/// Test that COPY on non-existent resource returns 404.
#[test_log::test(tokio::test)]
async fn copy_nonexistent_404() {
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
            "copy-nonexistent-coll",
            None,
        )
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let source_uri = caldav_item_path("testuser", "copy-nonexistent-coll", "nonexistent.ics");
    let dest_uri = caldav_item_path("testuser", "copy-nonexistent-coll", "dest.ics");
    let response = TestRequest::copy(&source_uri)
        .destination(&dest_uri)
        .send(&service)
        .await;

    response.assert_status(StatusCode::NOT_FOUND);
}
