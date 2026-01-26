#![allow(clippy::unused_async)]
//! Tests for DELETE method.
//!
//! Verifies resource deletion, tombstone creation, and idempotency.

use salvo::http::StatusCode;

use super::helpers::*;

// ============================================================================
// Basic DELETE Tests
// ============================================================================

/// ## Summary
/// Test that DELETE on a calendar object succeeds.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn delete_calendar_object() {
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
        .seed_collection(
            principal_id,
            "calendar",
            "personal",
            Some("Personal"),
        )
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("icalendar", Some("delete-test@example.com"))
        .await
        .expect("Failed to seed entity");

    let uri = format!("/api/caldav/{collection_id}/delete-test.ics");
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            &uri,
            "text/calendar",
            "\"delete-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_test_service();

    let response = TestRequest::delete(&uri).send(service).await;

    response.assert_status(StatusCode::NO_CONTENT);
}

/// ## Summary
/// Test that DELETE creates a tombstone and bumps sync token.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn delete_creates_tombstone() {
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
        .seed_collection(principal_id, "calendar", "tomb", None)
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("icalendar", Some("tomb-test@example.com"))
        .await
        .expect("Failed to seed entity");

    let uri = format!("/api/caldav/{collection_id}/tomb-test.ics");
    let resource_uri = "tomb-test.ics"; // Just the filename for tombstone lookup
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            &uri,
            "text/calendar",
            "\"tomb-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    // Get initial sync token
    let initial_synctoken = test_db
        .get_collection_synctoken(collection_id)
        .await
        .expect("Failed to get synctoken");

    let service = create_test_service();

    let response = TestRequest::delete(&uri).send(service).await;

    response.assert_status(StatusCode::NO_CONTENT);

    // Verify tombstone was created
    let tombstone_exists = test_db
        .tombstone_exists(collection_id, resource_uri)
        .await
        .expect("Failed to check tombstone");
    assert!(tombstone_exists, "Tombstone should exist after DELETE");

    // Verify sync token increased
    let new_synctoken = test_db
        .get_collection_synctoken(collection_id)
        .await
        .expect("Failed to get synctoken");
    assert!(
        new_synctoken > initial_synctoken,
        "Sync token should increase after DELETE"
    );
}

// ============================================================================
// Not Found Tests
// ============================================================================

/// ## Summary
/// Test that DELETE on non-existent resource returns 404.
#[tokio::test]
async fn delete_nonexistent_404() {
    let service = create_test_service();

    let response =
        TestRequest::delete("/api/caldav/00000000-0000-0000-0000-000000000000/nonexistent.ics")
            .send(service)
            .await;

    response.assert_status(StatusCode::NOT_FOUND);
}

// ============================================================================
// Idempotency Tests
// ============================================================================

/// ## Summary
/// Test that DELETE on already-deleted resource is handled appropriately.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn delete_idempotent() {
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
        .seed_collection(principal_id, "calendar", "idemp", None)
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("icalendar", Some("idemp-test@example.com"))
        .await
        .expect("Failed to seed entity");

    let uri = format!("/api/caldav/{collection_id}/idemp-test.ics");
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            &uri,
            "text/calendar",
            "\"idemp-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_test_service();

    // First DELETE
    let response = TestRequest::delete(&uri).send(service).await;
    response.assert_status(StatusCode::NO_CONTENT);

    // Second DELETE on same resource
    let response = TestRequest::delete(&uri).send(service).await;

    // Either 404 (resource gone) or 204 (idempotent success) are acceptable
    assert!(
        response.status == StatusCode::NOT_FOUND || response.status == StatusCode::NO_CONTENT,
        "Second DELETE should return 404 or 204, got {}",
        response.status
    );
}

// ============================================================================
// If-Match Precondition Tests
// ============================================================================

/// ## Summary
/// Test that DELETE with correct If-Match succeeds.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn delete_if_match_success() {
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
        .seed_collection(principal_id, "calendar", "ifm", None)
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("icalendar", Some("ifm-test@example.com"))
        .await
        .expect("Failed to seed entity");

    let uri = format!("/api/caldav/{collection_id}/ifm-test.ics");
    let etag = "\"ifm-etag-123\"";
    let _instance_id = test_db
        .seed_instance(collection_id, entity_id, &uri, "text/calendar", etag, 1)
        .await
        .expect("Failed to seed instance");

    let service = create_test_service();

    let response = TestRequest::delete(&uri).if_match(etag).send(service).await;

    response.assert_status(StatusCode::NO_CONTENT);
}

/// ## Summary
/// Test that DELETE with mismatched If-Match returns 412.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn delete_if_match_mismatch_412() {
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
        .seed_collection(principal_id, "calendar", "ifmm", None)
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("icalendar", Some("ifmm-test@example.com"))
        .await
        .expect("Failed to seed entity");

    let uri = format!("/api/caldav/{collection_id}/ifmm-test.ics");
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            &uri,
            "text/calendar",
            "\"actual-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_test_service();

    let response = TestRequest::delete(&uri)
        .if_match("\"wrong-etag\"")
        .send(service)
        .await;

    response.assert_status(StatusCode::PRECONDITION_FAILED);

    // Verify resource was NOT deleted
    let exists = test_db
        .instance_exists(&uri)
        .await
        .expect("Failed to check instance");
    assert!(exists, "Resource should still exist after failed DELETE");
}

// ============================================================================
// Collection DELETE Tests
// ============================================================================

/// ## Summary
/// Test that DELETE on collection is handled appropriately.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn delete_collection() {
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
        .seed_collection(
            principal_id,
            "calendar",
            "to-delete",
            Some("To Delete"),
        )
        .await
        .expect("Failed to seed collection");

    // Add some items to the collection
    let entity_id = test_db
        .seed_entity("icalendar", Some("coll-item@example.com"))
        .await
        .expect("Failed to seed entity");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            &format!("/api/caldav/{collection_id}/item.ics"),
            "text/calendar",
            "\"item-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_test_service();

    let response =
        TestRequest::delete(&format!("/api/caldav/{collection_id}/"))
            .send(service)
            .await;

    // DELETE on collection might be:
    // - 204 No Content (recursive delete supported)
    // - 403 Forbidden (recursive delete not supported)
    // Document actual behavior
    assert!(
        response.status == StatusCode::NO_CONTENT || response.status == StatusCode::FORBIDDEN,
        "Expected 204 or 403 for collection DELETE, got {}",
        response.status
    );
}

/// ## Summary
/// Test that DELETE collection does not leave orphaned instances.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn delete_collection_no_orphans() {
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
        .seed_collection(principal_id, "calendar", "orphan", None)
        .await
        .expect("Failed to seed collection");

    // Add multiple items
    for i in 0..3 {
        let entity_id = test_db
            .seed_entity("icalendar", Some(&format!("orphan-{i}@example.com")))
            .await
            .expect("Failed to seed entity");

        let _instance_id = test_db
            .seed_instance(
                collection_id,
                entity_id,
                &format!("/api/caldav/{collection_id}/item-{i}.ics"),
                "text/calendar",
                &format!("\"item-{i}-etag\""),
                1,
            )
            .await
            .expect("Failed to seed instance");
    }

    // Verify items exist
    let initial_count = test_db
        .count_collection_instances(collection_id)
        .await
        .expect("Failed to count instances");
    assert_eq!(initial_count, 3, "Should have 3 items before delete");

    let service = create_test_service();

    let response =
        TestRequest::delete(&format!("/api/caldav/{collection_id}/"))
            .send(service)
            .await;

    // If delete succeeded, verify no orphans
    if response.status == StatusCode::NO_CONTENT {
        let remaining = test_db
            .count_collection_instances(collection_id)
            .await
            .expect("Failed to count instances");
        assert_eq!(remaining, 0, "No instances should remain after collection delete");
    }
}

// ============================================================================
// Sync Token Tests
// ============================================================================

/// ## Summary
/// Test that DELETE bumps collection sync token.
#[tokio::test]
#[ignore = "requires database seeding"]
async fn delete_bumps_synctoken() {
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
        .seed_collection(principal_id, "calendar", "sync", None)
        .await
        .expect("Failed to seed collection");

    let entity_id = test_db
        .seed_entity("icalendar", Some("sync-del@example.com"))
        .await
        .expect("Failed to seed entity");

    let uri = format!("/api/caldav/{collection_id}/sync-del.ics");
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            &uri,
            "text/calendar",
            "\"sync-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    // Get initial sync token
    let initial_synctoken = test_db
        .get_collection_synctoken(collection_id)
        .await
        .expect("Failed to get synctoken");

    let service = create_test_service();

    let response = TestRequest::delete(&uri).send(service).await;

    response.assert_status(StatusCode::NO_CONTENT);

    // Verify sync token increased
    let new_synctoken = test_db
        .get_collection_synctoken(collection_id)
        .await
        .expect("Failed to get synctoken");
    assert!(
        new_synctoken > initial_synctoken,
        "Sync token should increase after DELETE"
    );
}
