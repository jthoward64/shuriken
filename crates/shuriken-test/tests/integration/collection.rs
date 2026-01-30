#![allow(clippy::unused_async)]
//! Integration tests for collection operations.
//!
//! Tests:
//! - Sync token behavior on read operations
//! - Multi-principal scenarios with same collection URI
//! - Listing collections by principal

use salvo::http::StatusCode;

use super::helpers::*;

/// ## Summary
/// Test that sync token does NOT increment on read operations (PROPFIND, GET).
///
/// ## Side Effects
/// Creates a test database with collection and instances, then performs multiple
/// read operations to verify sync token remains stable.
#[test_log::test(tokio::test)]
async fn synctoken_unchanged_on_reads() {
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
        .seed_collection(principal_id, CollectionType::Calendar, "readtest", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    // Add a few items
    for i in 0..3 {
        let entity_id = test_db
            .seed_entity("icalendar", Some(&format!("read-{i}@example.com")))
            .await
            .expect("Failed to seed entity");

        let _instance_id = test_db
            .seed_instance(
                collection_id,
                entity_id,
                &format!("item-{i}.ics"),
                "text/calendar",
                &format!("\"item-{i}\""),
                1,
            )
            .await
            .expect("Failed to seed instance");
    }

    // Capture initial sync token
    let initial_synctoken = test_db
        .get_collection_synctoken(collection_id)
        .await
        .expect("Failed to get initial synctoken");

    let service = create_db_test_service(&test_db.url()).await;

    // Perform multiple read operations
    // 1. PROPFIND Depth:0 on collection
    let response = TestRequest::propfind(&caldav_collection_path("testuser", "readtest"))
        .depth("0")
        .xml_body(propfind_allprop())
        .send(&service)
        .await;
    #[expect(unused_must_use)]
    response.assert_status(StatusCode::MULTI_STATUS);

    // 2. PROPFIND Depth:1 on collection
    let response = TestRequest::propfind(&caldav_collection_path("testuser", "readtest"))
        .depth("1")
        .xml_body(propfind_allprop())
        .send(&service)
        .await;
    #[expect(unused_must_use)]
    response.assert_status(StatusCode::MULTI_STATUS);

    // 3. Another PROPFIND on an item (using specific properties)
    let response = TestRequest::propfind(&caldav_item_path("testuser", "readtest", "item-1.ics"))
        .depth("0")
        .xml_body(propfind_allprop())
        .send(&service)
        .await;
    #[expect(unused_must_use)]
    response.assert_status(StatusCode::MULTI_STATUS);

    // Verify sync token has NOT changed
    let final_synctoken = test_db
        .get_collection_synctoken(collection_id)
        .await
        .expect("Failed to get final synctoken");

    assert_eq!(
        initial_synctoken, final_synctoken,
        "Sync token should not change on read operations"
    );
}

/// ## Summary
/// Test that different principals can have collections with the same URI/slug.
///
/// ## Side Effects
/// Creates two principals and verifies each can create and access collections
/// with the same slug independently.
#[test_log::test(tokio::test)]
async fn multi_principal_same_collection_uri() {
    use diesel::prelude::*;
    use diesel_async::RunQueryDsl;
    use shuriken_test::component::db::schema::dav_collection;

    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    // Create two principals with different users
    let principal1_id = test_db
        .seed_principal(PrincipalType::User, "user1", Some("User One"))
        .await
        .expect("Failed to seed principal 1");

    let _user1_id = test_db
        .seed_user("User One", "user1@example.com", principal1_id)
        .await
        .expect("Failed to seed user 1");

    let principal2_id = test_db
        .seed_principal(PrincipalType::User, "user2", Some("User Two"))
        .await
        .expect("Failed to seed principal 2");

    let _user2_id = test_db
        .seed_user("User Two", "user2@example.com", principal2_id)
        .await
        .expect("Failed to seed user 2");

    // Both principals create collections with the same slug "work"
    let collection1_id = test_db
        .seed_collection(
            principal1_id,
            CollectionType::Calendar,
            "work",
            Some("User 1 Work Calendar"),
        )
        .await
        .expect("Failed to seed collection 1");

    test_db
        .seed_collection_owner(principal1_id, collection1_id, "calendar")
        .await
        .expect("Failed to seed collection 1 owner");

    let collection2_id = test_db
        .seed_collection(
            principal2_id,
            CollectionType::Calendar,
            "work",
            Some("User 2 Work Calendar"),
        )
        .await
        .expect("Failed to seed collection 2");

    test_db
        .seed_collection_owner(principal2_id, collection2_id, "calendar")
        .await
        .expect("Failed to seed collection 2 owner");

    // Verify collections are different
    assert_ne!(
        collection1_id, collection2_id,
        "Collections should have different IDs"
    );

    // Add an item to each collection
    let entity1_id = test_db
        .seed_entity("icalendar", Some("user1-work@example.com"))
        .await
        .expect("Failed to seed entity 1");

    test_db
        .seed_instance(
            collection1_id,
            entity1_id,
            "meeting.ics",
            "text/calendar",
            "\"user1-meeting\"",
            1,
        )
        .await
        .expect("Failed to seed instance 1");

    let entity2_id = test_db
        .seed_entity("icalendar", Some("user2-work@example.com"))
        .await
        .expect("Failed to seed entity 2");

    test_db
        .seed_instance(
            collection2_id,
            entity2_id,
            "meeting.ics",
            "text/calendar",
            "\"user2-meeting\"",
            1,
        )
        .await
        .expect("Failed to seed instance 2");

    // Query database directly to verify both collections exist
    let mut conn = test_db.get_conn().await.expect("Failed to get connection");

    let collections: Vec<(uuid::Uuid, uuid::Uuid, String, Option<String>)> = dav_collection::table
        .filter(dav_collection::slug.eq("work"))
        .filter(dav_collection::deleted_at.is_null())
        .select((
            dav_collection::id,
            dav_collection::owner_principal_id,
            dav_collection::slug,
            dav_collection::display_name,
        ))
        .load(&mut conn)
        .await
        .expect("Failed to load collections");

    // Should have exactly 2 collections with slug "work"
    assert_eq!(
        collections.len(),
        2,
        "Should have 2 collections with slug 'work'"
    );

    // Verify they belong to different principals
    let principals: Vec<uuid::Uuid> = collections.iter().map(|(_, p, _, _)| *p).collect();
    assert!(
        principals.contains(&principal1_id),
        "Should include principal 1's collection"
    );
    assert!(
        principals.contains(&principal2_id),
        "Should include principal 2's collection"
    );

    // Verify display names are different
    let display_names: Vec<String> = collections
        .iter()
        .filter_map(|(_, _, _, name)| name.clone())
        .collect();
    assert!(
        display_names.contains(&"User 1 Work Calendar".to_string()),
        "Should include User 1's display name"
    );
    assert!(
        display_names.contains(&"User 2 Work Calendar".to_string()),
        "Should include User 2's display name"
    );
}

/// ## Summary
/// Test that listing collections filters by principal correctly.
///
/// ## Side Effects
/// Creates two principals with multiple collections each and verifies that
/// querying by principal returns only that principal's collections.
#[test_log::test(tokio::test)]
async fn list_collections_by_principal() {
    use diesel::prelude::*;
    use diesel_async::RunQueryDsl;
    use shuriken_test::component::db::schema::dav_collection;

    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    // Create two principals
    let principal1_id = test_db
        .seed_principal(PrincipalType::User, "owner1", Some("Owner One"))
        .await
        .expect("Failed to seed principal 1");

    let _user1_id = test_db
        .seed_user("Owner One", "owner1@example.com", principal1_id)
        .await
        .expect("Failed to seed user 1");

    let principal2_id = test_db
        .seed_principal(PrincipalType::User, "owner2", Some("Owner Two"))
        .await
        .expect("Failed to seed principal 2");

    let _user2_id = test_db
        .seed_user("Owner Two", "owner2@example.com", principal2_id)
        .await
        .expect("Failed to seed user 2");

    // Principal 1 creates 3 collections
    let slugs1 = ["home", "work", "personal"];
    let mut collection1_ids = Vec::new();

    for slug in &slugs1 {
        let collection_id = test_db
            .seed_collection(
                principal1_id,
                CollectionType::Calendar,
                slug,
                Some(&format!("Principal 1 - {slug}")),
            )
            .await
            .expect("Failed to seed collection");

        test_db
            .seed_collection_owner(principal1_id, collection_id, "calendar")
            .await
            .expect("Failed to seed collection owner");

        collection1_ids.push(collection_id);
    }

    // Principal 2 creates 2 collections
    let slugs2 = ["vacation", "sports"];
    let mut collection2_ids = Vec::new();

    for slug in &slugs2 {
        let collection_id = test_db
            .seed_collection(
                principal2_id,
                CollectionType::Calendar,
                slug,
                Some(&format!("Principal 2 - {slug}")),
            )
            .await
            .expect("Failed to seed collection");

        test_db
            .seed_collection_owner(principal2_id, collection_id, "calendar")
            .await
            .expect("Failed to seed collection owner");

        collection2_ids.push(collection_id);
    }

    // Query database for principal 1's collections
    let mut conn = test_db.get_conn().await.expect("Failed to get connection");

    let principal1_collections: Vec<uuid::Uuid> = dav_collection::table
        .filter(dav_collection::owner_principal_id.eq(principal1_id))
        .filter(dav_collection::deleted_at.is_null())
        .select(dav_collection::id)
        .load(&mut conn)
        .await
        .expect("Failed to load principal 1 collections");

    // Verify principal 1 has exactly 3 collections
    assert_eq!(
        principal1_collections.len(),
        3,
        "Principal 1 should have 3 collections"
    );

    // Verify all of principal 1's collections are in the result
    for collection_id in &collection1_ids {
        assert!(
            principal1_collections.contains(collection_id),
            "Should include principal 1's collection {collection_id}"
        );
    }

    // Verify none of principal 2's collections are in the result
    for collection_id in &collection2_ids {
        assert!(
            !principal1_collections.contains(collection_id),
            "Should NOT include principal 2's collection {collection_id}"
        );
    }

    // Query database for principal 2's collections
    let principal2_collections: Vec<uuid::Uuid> = dav_collection::table
        .filter(dav_collection::owner_principal_id.eq(principal2_id))
        .filter(dav_collection::deleted_at.is_null())
        .select(dav_collection::id)
        .load(&mut conn)
        .await
        .expect("Failed to load principal 2 collections");

    // Verify principal 2 has exactly 2 collections
    assert_eq!(
        principal2_collections.len(),
        2,
        "Principal 2 should have 2 collections"
    );

    // Verify all of principal 2's collections are in the result
    for collection_id in &collection2_ids {
        assert!(
            principal2_collections.contains(collection_id),
            "Should include principal 2's collection {collection_id}"
        );
    }

    // Verify none of principal 1's collections are in the result
    for collection_id in &collection1_ids {
        assert!(
            !principal2_collections.contains(collection_id),
            "Should NOT include principal 1's collection {collection_id}"
        );
    }
}
