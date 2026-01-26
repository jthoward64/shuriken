#![allow(clippy::unused_async)]
//! Example test demonstrating test infrastructure usage.
//!
//! This test serves as a template showing how to use the TestDb helpers
//! to seed data and verify database state in integration tests.

use super::helpers::*;

/// ## Summary
/// Example test showing how to use the test infrastructure to seed a principal.
#[tokio::test]
#[ignore = "requires running database"]
async fn example_seed_principal() {
    // Create test database connection
    let test_db = TestDb::new().await.expect("Failed to create test database");

    // Clean slate for test
    test_db
        .truncate_all()
        .await
        .expect("Failed to truncate tables");

    // Seed a test principal
    let principal_id = test_db
        .seed_principal("user", "/principals/testuser/", Some("Test User"))
        .await
        .expect("Failed to seed principal");

    // Verify principal was created
    assert!(!principal_id.is_nil());
}

/// ## Summary
/// Example test showing how to seed a complete calendar collection hierarchy.
#[tokio::test]
#[ignore = "requires running database"]
async fn example_seed_calendar_collection() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .truncate_all()
        .await
        .expect("Failed to truncate tables");

    // 1. Create principal
    let principal_id = test_db
        .seed_principal("user", "/principals/alice/", Some("Alice"))
        .await
        .expect("Failed to seed principal");

    // 2. Create user linked to principal
    let user_id = test_db
        .seed_user("Alice", "alice@example.com", principal_id)
        .await
        .expect("Failed to seed user");

    // 3. Create calendar collection
    let collection_id = test_db
        .seed_collection(
            principal_id,
            "calendar",
            "testcal",
            Some("Personal Calendar"),
        )
        .await
        .expect("Failed to seed collection");

    // 4. Create entity for a calendar event
    let entity_id = test_db
        .seed_entity("icalendar", Some("event-123@example.com"))
        .await
        .expect("Failed to seed entity");

    // 5. Create component for the VCALENDAR
    let vcal_component_id = test_db
        .seed_component(entity_id, None, "VCALENDAR", 0)
        .await
        .expect("Failed to seed VCALENDAR component");

    // 6. Create component for the VEVENT inside VCALENDAR
    let _vevent_component_id = test_db
        .seed_component(entity_id, Some(vcal_component_id), "VEVENT", 0)
        .await
        .expect("Failed to seed VEVENT component");

    // 7. Create instance linking entity to collection
    let instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "testcal",
            "text/calendar",
            "\"abc123\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    // All IDs should be valid
    assert!(!user_id.is_nil());
    assert!(!collection_id.is_nil());
    assert!(!entity_id.is_nil());
    assert!(!instance_id.is_nil());
}

/// ## Summary
/// Example test showing how to seed an addressbook collection.
#[tokio::test]
#[ignore = "requires running database"]
async fn example_seed_addressbook_collection() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .truncate_all()
        .await
        .expect("Failed to truncate tables");

    // 1. Create principal
    let principal_id = test_db
        .seed_principal("user", "/principals/bob/", Some("Bob"))
        .await
        .expect("Failed to seed principal");

    // 2. Create addressbook collection
    let collection_id = test_db
        .seed_collection(
            principal_id,
            "addressbook",
            "/addressbooks/bob/contacts/",
            Some("Contacts"),
        )
        .await
        .expect("Failed to seed collection");

    // 3. Create entity for a vCard
    let entity_id = test_db
        .seed_entity("vcard", Some("contact-456@example.com"))
        .await
        .expect("Failed to seed entity");

    // 4. Create component for the VCARD
    let _vcard_component_id = test_db
        .seed_component(entity_id, None, "VCARD", 0)
        .await
        .expect("Failed to seed VCARD component");

    // 5. Create instance linking entity to collection
    let instance_id = test_db
        .seed_instance(
            collection_id,
            entity_id,
            "/addressbooks/bob/contacts/contact-456.vcf",
            "text/vcard",
            "\"def456\"",
            1,
        )
        .await
        .expect("Failed to seed instance");

    // Verify IDs are valid
    assert!(!collection_id.is_nil());
    assert!(!entity_id.is_nil());
    assert!(!instance_id.is_nil());
}
