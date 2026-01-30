//! Unit tests for `path_parser` module
//!
//! These tests verify the pure functions in `path_parser` without requiring
//! database connections.

use shuriken_db::dav_types::CollectionChain;
use shuriken_test::component::auth::{PathSegment, ResourceType};
use shuriken_test::component::db::enums::{CollectionType, ContentType, PrincipalType};
use shuriken_test::component::middleware::path_parser::build_canonical_location;
use shuriken_test::component::model::dav::collection::DavCollection;
use shuriken_test::component::model::dav::instance::DavInstance;
use shuriken_test::component::model::principal::Principal;

fn create_test_principal(slug: &str) -> Principal {
    Principal {
        id: uuid::Uuid::new_v4(),
        principal_type: PrincipalType::User,
        display_name: Some("Test User".to_string()),
        updated_at: chrono::Utc::now(),
        deleted_at: None,
        slug: slug.to_string(),
    }
}

fn create_test_collection(owner_id: uuid::Uuid, slug: &str) -> DavCollection {
    DavCollection {
        id: uuid::Uuid::new_v4(),
        owner_principal_id: owner_id,
        collection_type: CollectionType::Calendar,
        display_name: Some("Test Collection".to_string()),
        description: None,
        timezone_tzid: None,
        synctoken: 1,
        updated_at: chrono::Utc::now(),
        deleted_at: None,
        supported_components: None,
        slug: slug.to_string(),
        parent_collection_id: None,
    }
}

fn create_test_instance(collection_id: uuid::Uuid, slug: &str) -> DavInstance {
    DavInstance {
        id: uuid::Uuid::new_v4(),
        collection_id,
        entity_id: uuid::Uuid::new_v4(),
        content_type: ContentType::TextCalendar,
        slug: slug.to_string(),
        etag: "test-etag".to_string(),
        sync_revision: 1,
        last_modified: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        deleted_at: None,
        schedule_tag: None,
    }
}

#[test]
fn test_build_canonical_location_full_path_with_ics() {
    let principal = create_test_principal("alice");
    let collection = create_test_collection(principal.id, "work");
    let instance = create_test_instance(collection.id, "event-1");
    let chain = CollectionChain::new(vec![collection.clone()]);

    let canonical = build_canonical_location(
        Some(ResourceType::Calendar),
        &Some(principal.clone()),
        Some(&chain),
        &Some(instance.clone()),
        Some("event-1.ics"),
    );

    assert!(canonical.is_some(), "Canonical location should exist");
    let loc = canonical.unwrap();
    let segments = loc.segments();

    assert_eq!(segments.len(), 4, "Should have 4 segments");

    // Verify resource type
    assert!(
        matches!(
            segments[0],
            PathSegment::ResourceType(ResourceType::Calendar)
        ),
        "First segment should be Calendar resource type"
    );

    // Verify owner UUID
    if let PathSegment::Owner(s) = &segments[1] {
        assert_eq!(
            s,
            &principal.id.to_string(),
            "Owner should be principal UUID"
        );
    } else {
        panic!("Second segment should be Owner");
    }

    // Verify collection UUID
    if let PathSegment::Collection(s) = &segments[2] {
        assert_eq!(
            s,
            &collection.id.to_string(),
            "Collection should be collection UUID"
        );
    } else {
        panic!("Third segment should be Collection");
    }

    // Verify item with extension
    if let PathSegment::Item(s) = &segments[3] {
        assert!(
            std::path::Path::new(s)
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("ics")),
            "Item should end with .ics"
        );
        assert!(
            s.starts_with(&instance.id.to_string()),
            "Item should start with instance UUID"
        );
    } else {
        panic!("Fourth segment should be Item");
    }
}

#[test]
fn test_build_canonical_location_with_vcf_extension() {
    let principal = create_test_principal("bob");
    let collection = create_test_collection(principal.id, "contacts");
    let instance = create_test_instance(collection.id, "john-doe");
    let chain = CollectionChain::new(vec![collection.clone()]);

    let canonical = build_canonical_location(
        Some(ResourceType::Addressbook),
        &Some(principal.clone()),
        Some(&chain),
        &Some(instance.clone()),
        Some("john-doe.vcf"),
    );

    assert!(canonical.is_some());
    let loc = canonical.unwrap();
    let segments = loc.segments();

    assert_eq!(segments.len(), 4);
    assert!(matches!(
        segments[0],
        PathSegment::ResourceType(ResourceType::Addressbook)
    ));

    if let PathSegment::Item(s) = &segments[3] {
        assert!(
            std::path::Path::new(s)
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("vcf")),
            "Addressbook item should end with .vcf"
        );
    } else {
        panic!("Expected Item segment");
    }
}

#[test]
fn test_build_canonical_location_without_extension() {
    let principal = create_test_principal("alice");
    let collection = create_test_collection(principal.id, "work");
    let instance = create_test_instance(collection.id, "event-1");
    let chain = CollectionChain::new(vec![collection.clone()]);

    let canonical = build_canonical_location(
        Some(ResourceType::Calendar),
        &Some(principal),
        Some(&chain),
        &Some(instance.clone()),
        Some("event-1"),
    );

    assert!(canonical.is_some());

    if let PathSegment::Item(s) = &canonical.unwrap().segments()[3] {
        assert_eq!(
            s,
            &instance.id.to_string(),
            "Without extension, should be just UUID"
        );
    } else {
        panic!("Expected Item segment");
    }
}

#[test]
fn test_build_canonical_location_collection_only() {
    let principal = create_test_principal("alice");
    let collection = create_test_collection(principal.id, "work");
    let chain = CollectionChain::new(vec![collection.clone()]);

    let canonical = build_canonical_location(
        Some(ResourceType::Calendar),
        &Some(principal.clone()),
        Some(&chain),
        &None,
        None,
    );

    assert!(canonical.is_some());
    let loc = canonical.unwrap();
    let segments = loc.segments();
    assert_eq!(segments.len(), 3, "Collection-only should have 3 segments");
    assert!(matches!(segments[2], PathSegment::Collection(_)));
}

#[test]
fn test_build_canonical_location_principal_only() {
    let principal = create_test_principal("alice");

    let canonical = build_canonical_location(
        Some(ResourceType::Calendar),
        &Some(principal.clone()),
        None,
        &None,
        None,
    );

    assert!(canonical.is_some());
    let loc = canonical.unwrap();
    let segments = loc.segments();
    assert_eq!(segments.len(), 2, "Principal-only should have 2 segments");
}

#[test]
fn test_build_canonical_location_missing_principal() {
    let canonical =
        build_canonical_location(Some(ResourceType::Calendar), &None, None, &None, None);

    assert!(canonical.is_none(), "Without principal, should return None");
}

#[test]
fn test_build_canonical_location_missing_resource_type() {
    let principal = create_test_principal("alice");
    let collection = create_test_collection(principal.id, "work");
    let chain = CollectionChain::new(vec![collection.clone()]);

    let canonical = build_canonical_location(None, &Some(principal), Some(&chain), &None, None);

    assert!(
        canonical.is_none(),
        "Without resource type, should return None"
    );
}

#[test]
fn test_build_canonical_location_instance_without_collection() {
    let principal = create_test_principal("alice");
    let instance = create_test_instance(uuid::Uuid::new_v4(), "event-1");

    let canonical = build_canonical_location(
        Some(ResourceType::Calendar),
        &Some(principal),
        None,
        &Some(instance),
        None,
    );

    // Should succeed but only have principal, no instance
    assert!(canonical.is_some());
    let loc = canonical.unwrap();
    let segments = loc.segments();
    assert_eq!(
        segments.len(),
        2,
        "Instance without collection should only have resource type and owner"
    );
}
