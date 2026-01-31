#![allow(clippy::unused_async)]
//! Integration tests for path parser.
//!
//! Uses `tests/integration/helpers.rs` for database setup and request utilities.

use super::helpers::{
    CollectionType, PrincipalType, TestDb, cal_path,
};
use shuriken_test::component::middleware::path_parser::parse_and_resolve_path;

/// Resolves a calendar owner-only path and verifies principal resolution.
#[test_log::test(tokio::test)]
async fn resolve_owner_only_calendar_path() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    // Seed principal
    let principal_id = test_db
        .seed_principal(PrincipalType::User, "alice", Some("Alice"))
        .await
        .expect("Failed to seed principal");

    let mut conn = test_db.get_conn().await.expect("conn");
    // Owner-only path: /cal/alice/ (no collection)
    let result = parse_and_resolve_path("/cal/alice/", &mut conn)
        .await
        .expect("resolve ok");

    // Verify owner principal
    let principal = result.principal.expect("owner principal present");
    assert_eq!(principal.id, principal_id);
    assert_eq!(principal.slug, "alice");

    // Verify original location shape
    let segments = result.original_location.segments();
    assert!(segments.len() >= 2);
}

/// Resolves a calendar collection path and verifies collection resolution.
#[test_log::test(tokio::test)]
async fn resolve_calendar_collection_path() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    // Seed principal and collection
    let principal_id = test_db
        .seed_principal(PrincipalType::User, "alice", Some("Alice"))
        .await
        .expect("Failed to seed principal");
    let collection_id = test_db
        .seed_collection(principal_id, CollectionType::Calendar, "work", Some("Work"))
        .await
        .expect("Failed to seed collection");

    let mut conn = test_db.get_conn().await.expect("conn");
    let result = parse_and_resolve_path(&cal_path("alice", "work", None), &mut conn)
        .await
        .expect("resolve ok");

    // Verify collection chain
    let chain = result.collection_chain.expect("collection chain present");
    let terminal = chain.terminal().expect("terminal collection present");
    assert_eq!(terminal.id, collection_id);
    assert_eq!(terminal.slug, "work");
}

/// Resolves a nested calendar collection path and verifies child resolution.
#[test_log::test(tokio::test)]
async fn resolve_nested_calendar_collection_path() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    let principal_id = test_db
        .seed_principal(PrincipalType::User, "alice", Some("Alice"))
        .await
        .expect("Failed to seed principal");
    let parent_id = test_db
        .seed_collection(principal_id, CollectionType::Calendar, "work", Some("Work"))
        .await
        .expect("Failed to seed parent collection");
    let child_id = test_db
        .seed_child_collection(
            principal_id,
            CollectionType::Calendar,
            "team",
            Some("Team"),
            parent_id,
        )
        .await
        .expect("Failed to seed child collection");

    let mut conn = test_db.get_conn().await.expect("conn");
    // Nested collection path: /cal/alice/work/team/
    let result =
        parse_and_resolve_path("/cal/alice/work/team/", &mut conn)
            .await
            .expect("resolve ok");

    let chain = result.collection_chain.expect("collection chain present");
    let terminal = chain.terminal().expect("terminal collection present");
    assert_eq!(terminal.id, child_id);
    assert_eq!(terminal.slug, "team");

    // Verify chain contains both parent and child
    assert_eq!(chain.len(), 2);
}

/// Resolves a calendar instance path and verifies instance resolution.
#[test_log::test(tokio::test)]
async fn resolve_calendar_instance_path() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    // Seed principal, collection, entity, and instance
    let principal_id = test_db
        .seed_principal(PrincipalType::User, "alice", Some("Alice"))
        .await
        .expect("Failed to seed principal");
    let collection_id = test_db
        .seed_collection(principal_id, CollectionType::Calendar, "work", Some("Work"))
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
    let result = parse_and_resolve_path(&cal_path("alice", "work", Some("event-1.ics")), &mut conn)
        .await
        .expect("resolve ok");

    // Verify instance
    let instance = result.instance.expect("instance present");
    assert_eq!(instance.id, instance_id);
    assert_eq!(instance.slug, "event-1");
}

/// Resolves a nested calendar instance path and verifies instance resolution under child collection.
#[test_log::test(tokio::test)]
async fn resolve_nested_calendar_instance_path() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    let principal_id = test_db
        .seed_principal(PrincipalType::User, "alice", Some("Alice"))
        .await
        .expect("Failed to seed principal");
    let parent_id = test_db
        .seed_collection(principal_id, CollectionType::Calendar, "work", Some("Work"))
        .await
        .expect("Failed to seed parent collection");
    let child_id = test_db
        .seed_child_collection(
            principal_id,
            CollectionType::Calendar,
            "team",
            Some("Team"),
            parent_id,
        )
        .await
        .expect("Failed to seed child collection");
    let entity_id = test_db
        .seed_entity("icalendar", Some("uid-2"))
        .await
        .expect("Failed to seed entity");
    let instance_id = test_db
        .seed_instance(child_id, entity_id, "standup", "text/calendar", "etag2", 1)
        .await
        .expect("Failed to seed instance");

    let mut conn = test_db.get_conn().await.expect("conn");
    let result = parse_and_resolve_path(
        &cal_path("alice", "work/team", Some("standup.ics")),
        &mut conn,
    )
    .await
    .expect("resolve ok");

    let instance = result.instance.expect("instance present");
    assert_eq!(instance.id, instance_id);
    assert_eq!(instance.slug, "standup");
}
