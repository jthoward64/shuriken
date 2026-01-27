#![allow(clippy::unused_async)]
//! Integration tests for slug resolver middleware.
//!
//! Uses `tests/integration/helpers.rs` for database setup and request utilities.

use super::helpers::TestDb;
use shuriken::component::auth::ResourceId;
use shuriken::component::middleware::slug_resolver::resolve_path_for_testing;

/// Resolves a calendar owner-only path and verifies principal resolution.
#[tokio::test]
#[ignore = "requires running database"]
async fn resolve_owner_only_calendar_path() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    // Seed principal
    let principal_id = test_db
        .seed_principal("user", "alice", Some("Alice"))
        .await
        .expect("Failed to seed principal");

    let mut conn = test_db.get_conn().await.expect("conn");
    let (owner, _collection, _instance, resource_id) =
        resolve_path_for_testing("/calendars/alice/**", &mut conn)
            .await
            .expect("resolve ok");

    // Verify owner principal
    let principal = owner.expect("owner principal present");
    assert_eq!(principal.id, principal_id);
    assert_eq!(principal.slug, "alice");

    // Verify ResourceId shape
    let resource_id: ResourceId = resource_id.expect("resource id present");
    assert!(resource_id.segments().len() >= 3);
}

/// Resolves a calendar collection path and verifies collection resolution.
#[tokio::test]
#[ignore = "requires running database"]
async fn resolve_calendar_collection_path() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    // Seed principal and collection
    let principal_id = test_db
        .seed_principal("user", "alice", Some("Alice"))
        .await
        .expect("Failed to seed principal");
    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "work", Some("Work"))
        .await
        .expect("Failed to seed collection");

    let mut conn = test_db.get_conn().await.expect("conn");
    let (_owner, collection_opt, _instance, _rid) =
        resolve_path_for_testing("/calendars/alice/work/**", &mut conn)
            .await
            .expect("resolve ok");

    // Verify collection
    let collection = collection_opt.expect("collection present");
    assert_eq!(collection.id, collection_id);
    assert_eq!(collection.slug, "work");
}

/// Resolves a calendar instance path and verifies instance resolution.
#[tokio::test]
#[ignore = "requires running database"]
async fn resolve_calendar_instance_path() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    // Seed principal, collection, entity, and instance
    let principal_id = test_db
        .seed_principal("user", "alice", Some("Alice"))
        .await
        .expect("Failed to seed principal");
    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "work", Some("Work"))
        .await
        .expect("Failed to seed collection");
    let entity_id = test_db
        .seed_entity("icalendar", Some("uid-1"))
        .await
        .expect("Failed to seed entity");
    let instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "event-1",
            "text/calendar",
            "etag",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let mut conn = test_db.get_conn().await.expect("conn");
    let (_owner, _collection, instance_opt, _rid) =
        resolve_path_for_testing("/calendars/alice/work/event-1.ics", &mut conn)
            .await
            .expect("resolve ok");

    // Verify instance
    let instance = instance_opt.expect("instance present");
    assert_eq!(instance.id, instance_id);
    assert_eq!(instance.slug, "event-1");
}
