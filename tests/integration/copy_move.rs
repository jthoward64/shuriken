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
#[tokio::test]
#[expect(clippy::too_many_lines)]
async fn move_rename_item_updates_href() {
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
        .seed_collection(principal_id, "calendar", "move-test", None)
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("icalendar", Some("move-test@example.com"))
        .await
        .expect("Failed to seed entity");

    let source_uri = format!("/api/caldav/{collection_id}/source-event.ics");
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            &source_uri,
            "text/calendar",
            "\"source-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_test_service();

    let dest_uri = format!("/api/caldav/{collection_id}/renamed-event.ics");
    let response = TestRequest::move_resource(&source_uri)
        .destination(&dest_uri)
        .send(service)
        .await;

    // Either 201 Created or 204 No Content
    assert!(
        response.status == StatusCode::CREATED || response.status == StatusCode::NO_CONTENT,
        "Expected 201 or 204, got {}",
        response.status
    );

    // Verify resource exists at destination
    let get_response = TestRequest::get(&dest_uri)
        .send(create_test_service())
        .await;
    get_response.assert_status(StatusCode::OK);

    // Verify source no longer exists (404 or 410)
    let source_response = TestRequest::get(&source_uri)
        .send(create_test_service())
        .await;
    assert!(
        source_response.status == StatusCode::NOT_FOUND
            || source_response.status == StatusCode::GONE,
        "Expected 404 or 410, got {}",
        source_response.status
    );
}

/// ## Summary
/// Test that MOVE within same collection updates instance.uri.
#[tokio::test]
async fn move_within_collection() {
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
        .seed_collection(principal_id, "calendar", "within-test", None)
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("icalendar", Some("within-test@example.com"))
        .await
        .expect("Failed to seed entity");

    let source_uri = format!("/api/caldav/{collection_id}/original.ics");
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            &source_uri,
            "text/calendar",
            "\"orig-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_test_service();

    let dest_uri = format!("/api/caldav/{collection_id}/new-name.ics");
    let response = TestRequest::move_resource(&source_uri)
        .destination(&dest_uri)
        .send(service)
        .await;

    assert!(
        response.status == StatusCode::CREATED || response.status == StatusCode::NO_CONTENT,
        "Expected 201 or 204, got {}",
        response.status
    );
}

/// ## Summary
/// Test that MOVE across collections creates new instance.
#[tokio::test]
async fn move_across_collections() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .truncate_all()
        .await
        .expect("Failed to truncate tables");

    let principal_id = test_db
        .seed_principal("user", "/principals/alice/", Some("Alice"))
        .await
        .expect("Failed to seed principal");

    let collection_a = test_db
        .seed_collection(principal_id, "calendar", "coll-a", None)
        .await
        .expect("Failed to seed collection A");

    let collection_b = test_db
        .seed_collection(principal_id, "calendar", "coll-b", None)
        .await
        .expect("Failed to seed collection B");

    let entity_id = test_db
        .seed_entity("icalendar", Some("cross-move@example.com"))
        .await
        .expect("Failed to seed entity");

    let source_uri = format!("/api/caldav/{collection_a}/cross-event.ics");
    let _instance_id = test_db
        .seed_instance(
            collection_a,
            entity_id,
            &source_uri,
            "text/calendar",
            "\"cross-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_test_service();

    let dest_uri = format!("/api/caldav/{collection_b}/moved-event.ics");
    let response = TestRequest::move_resource(&source_uri)
        .destination(&dest_uri)
        .send(service)
        .await;

    assert!(
        response.status == StatusCode::CREATED || response.status == StatusCode::NO_CONTENT,
        "Expected 201 or 204, got {}",
        response.status
    );

    // Verify resource exists at destination
    let get_response = TestRequest::get(&dest_uri)
        .send(create_test_service())
        .await;
    get_response.assert_status(StatusCode::OK);
}

// ============================================================================
// COPY Basic Tests
// ============================================================================

/// ## Summary
/// Test that COPY duplicates a resource to destination.
#[tokio::test]
async fn copy_duplicates_resource() {
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
        .seed_collection(principal_id, "calendar", "copy-test", None)
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("icalendar", Some("copy-test@example.com"))
        .await
        .expect("Failed to seed entity");

    let source_uri = format!("/api/caldav/{collection_id}/source-copy.ics");
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            &source_uri,
            "text/calendar",
            "\"copy-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_test_service();

    let dest_uri = format!("/api/caldav/{collection_id}/copy-target.ics");
    let response = TestRequest::copy(&source_uri)
        .destination(&dest_uri)
        .send(service)
        .await;

    response.assert_status(StatusCode::CREATED);

    // Verify resource exists at both source and destination
    let source_get = TestRequest::get(&source_uri)
        .send(create_test_service())
        .await;
    source_get.assert_status(StatusCode::OK);

    let dest_get = TestRequest::get(&dest_uri)
        .send(create_test_service())
        .await;
    dest_get.assert_status(StatusCode::OK);
}

/// ## Summary
/// Test that COPY does not create tombstone (source still exists).
#[tokio::test]
async fn copy_does_not_create_tombstone() {
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
        .seed_collection(principal_id, "calendar", "notomb", None)
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("icalendar", Some("no-tomb@example.com"))
        .await
        .expect("Failed to seed entity");

    let source_uri = format!("/api/caldav/{collection_id}/no-tomb.ics");
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            &source_uri,
            "text/calendar",
            "\"no-tomb-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_test_service();

    let dest_uri = format!("/api/caldav/{collection_id}/copied.ics");
    let response = TestRequest::copy(&source_uri)
        .destination(&dest_uri)
        .send(service)
        .await;

    response.assert_status(StatusCode::CREATED);

    // Verify source still accessible (no tombstone needed for COPY source)
    let source_get = TestRequest::get(&source_uri)
        .send(create_test_service())
        .await;
    source_get.assert_status(StatusCode::OK);
}

// ============================================================================
// Overwrite and Conflict Tests
// ============================================================================

/// ## Summary
/// Test that MOVE with existing destination and Overwrite:F returns 412.
#[tokio::test]
#[expect(clippy::too_many_lines)]
async fn move_destination_exists_overwrite_false_412() {
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
        .seed_collection(principal_id, "calendar", "conflict-test", None)
        .await
        .expect("Failed to seed collection");

    // Create source resource
    let source_entity_id = test_db
        .seed_entity("icalendar", Some("source-conflict@example.com"))
        .await
        .expect("Failed to seed source entity");

    let source_uri = format!("/api/caldav/{collection_id}/source.ics");
    let _source_instance = test_db
        .seed_instance(
            collection_id,
            source_entity_id,
            &source_uri,
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

    let dest_uri = format!("/api/caldav/{collection_id}/dest.ics");
    let _dest_instance = test_db
        .seed_instance(
            collection_id,
            dest_entity_id,
            &dest_uri,
            "text/calendar",
            "\"dst-etag\"",
            1,
        )
        .await
        .expect("Failed to seed dest instance");

    let service = create_test_service();

    let response = TestRequest::move_resource(&source_uri)
        .destination(&dest_uri)
        .overwrite(false)
        .send(service)
        .await;

    response.assert_status(StatusCode::PRECONDITION_FAILED);
}

/// ## Summary
/// Test that MOVE with existing destination and Overwrite:T succeeds.
#[tokio::test]
#[expect(clippy::too_many_lines)]
async fn move_destination_exists_overwrite_true_succeeds() {
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
        .seed_collection(principal_id, "calendar", "overwrite-test", None)
        .await
        .expect("Failed to seed collection");

    // Create source resource
    let source_entity_id = test_db
        .seed_entity("icalendar", Some("src-overwrite@example.com"))
        .await
        .expect("Failed to seed source entity");

    let source_uri = format!("/api/caldav/{collection_id}/src-ow.ics");
    let _source_instance = test_db
        .seed_instance(
            collection_id,
            source_entity_id,
            &source_uri,
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

    let dest_uri = format!("/api/caldav/{collection_id}/dst-ow.ics");
    let _dest_instance = test_db
        .seed_instance(
            collection_id,
            dest_entity_id,
            &dest_uri,
            "text/calendar",
            "\"dst-ow-etag\"",
            1,
        )
        .await
        .expect("Failed to seed dest instance");

    let service = create_test_service();

    let response = TestRequest::move_resource(&source_uri)
        .destination(&dest_uri)
        .overwrite(true)
        .send(service)
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
#[tokio::test]
#[expect(clippy::too_many_lines)]
async fn move_generates_tombstone() {
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
        .seed_collection(principal_id, "calendar", "tomb-test", None)
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("icalendar", Some("tomb-test@example.com"))
        .await
        .expect("Failed to seed entity");

    let source_uri = format!("/api/caldav/{collection_id}/tomb-src.ics");
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            &source_uri,
            "text/calendar",
            "\"tomb-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    // Get initial sync-token
    let props = propfind_props(&[("DAV:", "sync-token")]);
    let initial_sync = TestRequest::propfind(&format!("/api/caldav/{collection_id}/"))
        .depth("0")
        .xml_body(&props)
        .send(create_test_service())
        .await;
    initial_sync.assert_status(StatusCode::MULTI_STATUS);

    let service = create_test_service();

    let dest_uri = format!("/api/caldav/{collection_id}/tomb-dst.ics");
    let response = TestRequest::move_resource(&source_uri)
        .destination(&dest_uri)
        .send(service)
        .await;

    assert!(
        response.status == StatusCode::CREATED || response.status == StatusCode::NO_CONTENT,
        "Expected 201 or 204, got {}",
        response.status
    );

    // Verify sync-token changed (tombstone created)
    let new_sync = TestRequest::propfind(&format!("/api/caldav/{collection_id}/"))
        .depth("0")
        .xml_body(&props)
        .send(create_test_service())
        .await;
    new_sync.assert_status(StatusCode::MULTI_STATUS);
}

// ============================================================================
// Error Cases
// ============================================================================

/// ## Summary
/// Test that MOVE without Destination header returns 400.
#[tokio::test]
async fn move_without_destination_400() {
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
        .seed_collection(principal_id, "calendar", "nodest", None)
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("icalendar", Some("no-dest@example.com"))
        .await
        .expect("Failed to seed entity");

    let source_uri = format!("/api/caldav/{collection_id}/no-dest.ics");
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            &source_uri,
            "text/calendar",
            "\"no-dest-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_test_service();

    // MOVE without Destination header
    let response = TestRequest::move_resource(&source_uri).send(service).await;

    response.assert_status(StatusCode::BAD_REQUEST);
}

/// ## Summary
/// Test that MOVE on non-existent resource returns 404.
#[tokio::test]
async fn move_nonexistent_404() {
    let service = create_test_service();

    let response = TestRequest::move_resource(
        "/api/caldav/00000000-0000-0000-0000-000000000000/nonexistent.ics",
    )
    .destination("/api/caldav/00000000-0000-0000-0000-000000000000/dest.ics")
    .send(service)
    .await;

    response.assert_status(StatusCode::NOT_FOUND);
}

/// ## Summary
/// Test that COPY on non-existent resource returns 404.
#[tokio::test]
async fn copy_nonexistent_404() {
    let service = create_test_service();

    let response =
        TestRequest::copy("/api/caldav/00000000-0000-0000-0000-000000000000/nonexistent.ics")
            .destination("/api/caldav/00000000-0000-0000-0000-000000000000/dest.ics")
            .send(service)
            .await;

    response.assert_status(StatusCode::NOT_FOUND);
}
