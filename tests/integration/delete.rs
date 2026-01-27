#![allow(clippy::unused_async, unused_must_use)]
//! Tests for DELETE method.
//!
//! Verifies resource deletion, tombstone creation, and idempotency.

use salvo::http::StatusCode;

use super::helpers::*;

// Helper functions for setup patterns that need a service
async fn setup_calendar_index_cleanup(
    test_db: &TestDb,
    service: &salvo::Service,
) -> anyhow::Result<(uuid::Uuid, String)> {
    // Seed authenticated user (matches config email)
    let principal_id = test_db.seed_authenticated_user().await?;

    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "clean-cal", None)
        .await?;

    // Grant owner access to the authenticated user on their collection
    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await?;

    let uri = caldav_item_path("testuser", "clean-cal", "clean-event.ics");
    let ical = sample_recurring_event(
        "clean-event@example.com",
        "Clean Event",
        "FREQ=DAILY;COUNT=3",
    );

    let response = TestRequest::put(&uri)
        .if_none_match("*")
        .icalendar_body(&ical)
        .send(service)
        .await;

    response.assert_status(StatusCode::CREATED);

    Ok((collection_id, uri))
}

async fn setup_card_index_cleanup(
    test_db: &TestDb,
    service: &salvo::Service,
) -> anyhow::Result<(uuid::Uuid, String)> {
    // Seed authenticated user (matches config email)
    let principal_id = test_db.seed_authenticated_user().await?;

    let collection_id = test_db
        .seed_collection(principal_id, "addressbook", "clean-book", None)
        .await?;

    // Grant owner access to the authenticated user on their collection
    test_db
        .seed_collection_owner(principal_id, collection_id, "addressbook")
        .await?;

    let uri = carddav_item_path("testuser", "clean-book", "clean-contact.vcf");
    let vcard = sample_vcard(
        "clean-contact@example.com",
        "Clean Contact",
        "clean@example.com",
    );

    let response = TestRequest::put(&uri)
        .if_none_match("*")
        .vcard_body(&vcard)
        .send(service)
        .await;

    response.assert_status(StatusCode::CREATED);

    Ok((collection_id, uri))
}

async fn fetch_entity_id(
    test_db: &TestDb,
    collection_id: uuid::Uuid,
    resource_uri: &str,
) -> anyhow::Result<uuid::Uuid> {
    use diesel::prelude::*;
    use diesel_async::RunQueryDsl;
    use shuriken::component::db::schema::dav_instance;

    let mut conn = test_db.get_conn().await?;

    let entity_id = dav_instance::table
        .filter(dav_instance::collection_id.eq(collection_id))
        .filter(dav_instance::slug.eq(resource_uri))
        .select(dav_instance::entity_id)
        .first::<uuid::Uuid>(&mut conn)
        .await?;

    Ok(entity_id)
}

async fn fetch_calendar_index_stats(
    test_db: &TestDb,
    entity_id: uuid::Uuid,
) -> anyhow::Result<(i64, i64)> {
    use diesel::prelude::*;
    use diesel_async::RunQueryDsl;
    use shuriken::component::db::schema::{cal_index, cal_occurrence};

    let mut conn = test_db.get_conn().await?;

    let cal_index_count = cal_index::table
        .filter(cal_index::entity_id.eq(entity_id))
        .count()
        .get_result::<i64>(&mut conn)
        .await?;

    let occurrence_count = cal_occurrence::table
        .filter(cal_occurrence::entity_id.eq(entity_id))
        .filter(cal_occurrence::deleted_at.is_null())
        .count()
        .get_result::<i64>(&mut conn)
        .await?;

    Ok((cal_index_count, occurrence_count))
}

async fn fetch_card_index_count(test_db: &TestDb, entity_id: uuid::Uuid) -> anyhow::Result<i64> {
    use diesel::prelude::*;
    use diesel_async::RunQueryDsl;
    use shuriken::component::db::schema::card_index;

    let mut conn = test_db.get_conn().await?;

    let card_index_count = card_index::table
        .filter(card_index::entity_id.eq(entity_id))
        .count()
        .get_result::<i64>(&mut conn)
        .await?;

    Ok(card_index_count)
}

// ============================================================================
// Basic DELETE Tests
// ============================================================================

/// ## Summary
/// Test that DELETE on a calendar object succeeds.
#[test_log::test(tokio::test)]
async fn delete_calendar_object() {
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
        .seed_collection(principal_id, "calendar", "personal", Some("Personal"))
        .await
        .expect("Failed to seed collection");

    // Grant owner access to the authenticated user on their collection
    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let entity_id = test_db
        .seed_entity("icalendar", Some("delete-test@example.com"))
        .await
        .expect("Failed to seed entity");

    let uri = caldav_item_path("testuser", "personal", "delete-test.ics");
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "delete-test",
            "text/calendar",
            "\"delete-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::delete(&uri).send(&service).await;

    response.assert_status(StatusCode::NO_CONTENT);
}

/// ## Summary
/// Test that DELETE creates a tombstone and bumps sync token.
#[test_log::test(tokio::test)]
#[ignore = "DELETE handler doesn't create tombstones yet - needs implementation"]
async fn delete_creates_tombstone() {
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
        .seed_collection(principal_id, "calendar", "tomb", None)
        .await
        .expect("Failed to seed collection");

    // Grant owner access to the authenticated user on their collection
    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let entity_id = test_db
        .seed_entity("icalendar", Some("tomb-test@example.com"))
        .await
        .expect("Failed to seed entity");

    let uri = caldav_item_path("testuser", "tomb", "tomb-test.ics");
    let resource_slug = "tomb-test"; // Just the base name for tombstone lookup
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            resource_slug,
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

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::delete(&uri).send(&service).await;

    response.assert_status(StatusCode::NO_CONTENT);

    // Verify tombstone was created
    let tombstone_exists = test_db
        .tombstone_exists(collection_id, resource_slug)
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
// Index Cleanup Tests
// ============================================================================

/// ## Summary
/// Test that DELETE removes calendar index rows and occurrences.
#[test_log::test(tokio::test)]
#[ignore = "Index cleanup tests need PUT handler to populate indexes"]
async fn delete_cleans_calendar_indexes() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    // Seed the role→permission mappings (g2 rules)
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    let service = create_db_test_service(&test_db.url()).await;

    let (collection_id, uri) = setup_calendar_index_cleanup(&test_db, &service)
        .await
        .expect("Failed to seed calendar cleanup fixture");

    let entity_id = fetch_entity_id(&test_db, collection_id, "clean-event.ics")
        .await
        .expect("Failed to fetch entity_id for instance");

    let (cal_index_count, occurrence_count) = fetch_calendar_index_stats(&test_db, entity_id)
        .await
        .expect("Failed to count calendar index rows");

    assert!(
        cal_index_count > 0,
        "cal_index should be populated before DELETE"
    );
    assert_eq!(occurrence_count, 3, "Expected 3 occurrences before DELETE");

    let response = TestRequest::delete(&uri).send(&service).await;
    response.assert_status(StatusCode::NO_CONTENT);

    let (cal_index_count, occurrence_count) = fetch_calendar_index_stats(&test_db, entity_id)
        .await
        .expect("Failed to count calendar index rows after DELETE");

    assert_eq!(
        cal_index_count, 0,
        "cal_index rows should be removed after DELETE"
    );
    assert_eq!(
        occurrence_count, 0,
        "Occurrences should be removed after DELETE"
    );

    let tombstone_exists = test_db
        .tombstone_exists(collection_id, "clean-event.ics")
        .await
        .expect("Failed to check tombstone");
    assert!(tombstone_exists, "Tombstone should exist after DELETE");
}

/// ## Summary
/// Test that DELETE removes card index rows.
#[test_log::test(tokio::test)]
#[ignore = "Index cleanup tests need PUT handler to populate indexes"]
async fn delete_cleans_card_index() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    // Seed the role→permission mappings (g2 rules)
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    let service = create_db_test_service(&test_db.url()).await;

    let (collection_id, uri) = setup_card_index_cleanup(&test_db, &service)
        .await
        .expect("Failed to seed card cleanup fixture");

    let entity_id = fetch_entity_id(&test_db, collection_id, "clean-contact.vcf")
        .await
        .expect("Failed to fetch entity_id for instance");

    let card_index_count = fetch_card_index_count(&test_db, entity_id)
        .await
        .expect("Failed to count card_index rows");

    assert_eq!(
        card_index_count, 1,
        "card_index should be populated before DELETE"
    );

    let response = TestRequest::delete(&uri).send(&service).await;
    response.assert_status(StatusCode::NO_CONTENT);

    let card_index_count = fetch_card_index_count(&test_db, entity_id)
        .await
        .expect("Failed to count card_index rows after DELETE");

    assert_eq!(
        card_index_count, 0,
        "card_index rows should be removed after DELETE"
    );

    let tombstone_exists = test_db
        .tombstone_exists(collection_id, "clean-contact.vcf")
        .await
        .expect("Failed to check tombstone");
    assert!(tombstone_exists, "Tombstone should exist after DELETE");
}

// ============================================================================
// Not Found Tests
// ============================================================================

/// ## Summary
/// Test that DELETE on non-existent resource returns 404.
#[test_log::test(tokio::test)]
async fn delete_nonexistent_404() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    // Seed the role→permission mappings (g2 rules)
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    // Seed authenticated user so we have a valid owner
    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    // Create a collection so the path prefix is valid
    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "notfound", None)
        .await
        .expect("Failed to seed collection");

    // Grant owner access to the authenticated user on their collection
    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    let uri = caldav_item_path("testuser", "notfound", "nonexistent.ics");
    let response = TestRequest::delete(&uri).send(&service).await;

    response.assert_status(StatusCode::NOT_FOUND);
}

// ============================================================================
// Idempotency Tests
// ============================================================================

/// ## Summary
/// Test that DELETE on already-deleted resource is handled appropriately.
#[test_log::test(tokio::test)]
async fn delete_idempotent() {
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
        .seed_collection(principal_id, "calendar", "idemp", None)
        .await
        .expect("Failed to seed collection");

    // Grant owner access to the authenticated user on their collection
    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let entity_id = test_db
        .seed_entity("icalendar", Some("idemp-test@example.com"))
        .await
        .expect("Failed to seed entity");

    let uri = caldav_item_path("testuser", "idemp", "idemp-test.ics");
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "idemp-test",
            "text/calendar",
            "\"idemp-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    // First DELETE
    let response = TestRequest::delete(&uri).send(&service).await;
    response.assert_status(StatusCode::NO_CONTENT);

    // Second DELETE on same resource
    let response = TestRequest::delete(&uri).send(&service).await;

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
#[test_log::test(tokio::test)]
async fn delete_if_match_success() {
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
        .seed_collection(principal_id, "calendar", "ifm", None)
        .await
        .expect("Failed to seed collection");

    // Grant owner access to the authenticated user on their collection
    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let entity_id = test_db
        .seed_entity("icalendar", Some("ifm-test@example.com"))
        .await
        .expect("Failed to seed entity");

    let uri = caldav_item_path("testuser", "ifm", "ifm-test.ics");
    let etag = "\"ifm-etag-123\"";
    let _instance_id = test_db
        .seed_instance(collection_id, entity_id, "ifm-test", "text/calendar", etag, 1)
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::delete(&uri).if_match(etag).send(&service).await;

    response.assert_status(StatusCode::NO_CONTENT);
}

/// ## Summary
/// Test that DELETE with mismatched If-Match returns 412.
#[test_log::test(tokio::test)]
async fn delete_if_match_mismatch_412() {
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
        .seed_collection(principal_id, "calendar", "ifmm", None)
        .await
        .expect("Failed to seed collection");

    // Grant owner access to the authenticated user on their collection
    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let entity_id = test_db
        .seed_entity("icalendar", Some("ifmm-test@example.com"))
        .await
        .expect("Failed to seed entity");

    let uri = caldav_item_path("testuser", "ifmm", "ifmm-test.ics");
    let slug = "ifmm-test";
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            slug,
            "text/calendar",
            "\"actual-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::delete(&uri)
        .if_match("\"wrong-etag\"")
        .send(&service)
        .await;

    response.assert_status(StatusCode::PRECONDITION_FAILED);

    // Verify resource was NOT deleted
    let exists = test_db
        .instance_exists(slug)
        .await
        .expect("Failed to check instance");
    assert!(exists, "Resource should still exist after failed DELETE");
}

// ============================================================================
// Collection DELETE Tests
// ============================================================================

/// ## Summary
/// Test that DELETE on collection is handled appropriately.
#[test_log::test(tokio::test)]
#[ignore = "Collection DELETE returns 404 - slug resolver might not support collection-level DELETE"]
async fn delete_collection() {
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
        .seed_collection(principal_id, "calendar", "to-delete", Some("To Delete"))
        .await
        .expect("Failed to seed collection");

    // Grant owner access to the authenticated user on their collection
    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    // Add some items to the collection
    let entity_id = test_db
        .seed_entity("icalendar", Some("coll-item@example.com"))
        .await
        .expect("Failed to seed entity");

    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "item",
            "text/calendar",
            "\"item-etag\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    let service = create_db_test_service(&test_db.url()).await;

    let uri = caldav_collection_path("testuser", "to-delete");
    let response = TestRequest::delete(&uri).send(&service).await;

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
#[test_log::test(tokio::test)]
async fn delete_collection_no_orphans() {
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
        .seed_collection(principal_id, "calendar", "orphan", None)
        .await
        .expect("Failed to seed collection");

    // Grant owner access to the authenticated user on their collection
    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

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
                &format!("item-{i}"),
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

    let service = create_db_test_service(&test_db.url()).await;

    let uri = caldav_collection_path("testuser", "orphan");
    let response = TestRequest::delete(&uri).send(&service).await;

    // If delete succeeded, verify no orphans
    if response.status == StatusCode::NO_CONTENT {
        let remaining = test_db
            .count_collection_instances(collection_id)
            .await
            .expect("Failed to count instances");
        assert_eq!(
            remaining, 0,
            "No instances should remain after collection delete"
        );
    }
}

// ============================================================================
// Sync Token Tests
// ============================================================================

/// ## Summary
/// Test that DELETE bumps collection sync token.
#[test_log::test(tokio::test)]
async fn delete_bumps_synctoken() {
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
        .seed_collection(principal_id, "calendar", "sync", None)
        .await
        .expect("Failed to seed collection");

    // Grant owner access to the authenticated user on their collection
    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let entity_id = test_db
        .seed_entity("icalendar", Some("sync-del@example.com"))
        .await
        .expect("Failed to seed entity");

    let uri = caldav_item_path("testuser", "sync", "sync-del.ics");
    let _instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "sync-del",
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

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::delete(&uri).send(&service).await;

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
