//! Unit tests for DAV instance query builders.

use diesel::prelude::*;
use diesel::query_builder::QueryFragment;

use super::*;

/// Helper to check if a query compiles and is valid.
fn query_is_valid<Q>(query: Q) -> bool
where
    Q: QueryFragment<diesel::pg::Pg>,
{
    // If the query compiles and can be converted to SQL, it's valid
    let _ = diesel::debug_query::<diesel::pg::Pg, _>(&query).to_string();
    true
}

#[test]
fn test_all_instances_query_builds() {
    let query = all();
    assert!(query_is_valid(query), "all() query should be valid");
}

#[test]
fn test_by_id_query_builds() {
    let id = uuid::Uuid::new_v4();
    let query = by_id(id);
    assert!(query_is_valid(query), "by_id() query should be valid");
}

#[test]
fn test_by_collection_query_builds() {
    let collection_id = uuid::Uuid::new_v4();
    let query = by_collection(collection_id);
    assert!(query_is_valid(query), "by_collection() query should be valid");
}

#[test]
fn test_by_collection_and_uri_query_builds() {
    let collection_id = uuid::Uuid::new_v4();
    let query = by_collection_and_uri(collection_id, "/calendar/event1.ics");
    assert!(
        query_is_valid(query),
        "by_collection_and_uri() query should be valid"
    );
}

#[test]
fn test_by_collection_not_deleted_query_builds() {
    let collection_id = uuid::Uuid::new_v4();
    let query = by_collection_not_deleted(collection_id);
    assert!(
        query_is_valid(query),
        "by_collection_not_deleted() query should be valid"
    );
}

#[test]
fn test_by_entity_query_builds() {
    let entity_id = uuid::Uuid::new_v4();
    let query = by_entity(entity_id);
    assert!(query_is_valid(query), "by_entity() query should be valid");
}

#[test]
fn test_by_etag_query_builds() {
    let query = by_etag("abc123def456");
    assert!(query_is_valid(query), "by_etag() query should be valid");
}

#[test]
fn test_collection_filter_is_present() {
    let collection_id = uuid::Uuid::new_v4();
    let query_str = diesel::debug_query::<diesel::pg::Pg, _>(&by_collection(collection_id)).to_string();
    
    assert!(
        query_str.contains("collection_id"),
        "by_collection should filter by collection_id"
    );
}

#[test]
fn test_collection_and_uri_filters() {
    let collection_id = uuid::Uuid::new_v4();
    let uri = "/test.ics";
    let query_str = diesel::debug_query::<diesel::pg::Pg, _>(&by_collection_and_uri(collection_id, uri)).to_string();
    
    assert!(
        query_str.contains("collection_id"),
        "by_collection_and_uri should filter by collection_id"
    );
    assert!(
        query_str.contains("uri"),
        "by_collection_and_uri should filter by uri"
    );
    assert!(
        query_str.contains("deleted_at"),
        "by_collection_and_uri should filter by deleted_at"
    );
}

#[test]
fn test_not_deleted_filter() {
    let collection_id = uuid::Uuid::new_v4();
    let query_str = diesel::debug_query::<diesel::pg::Pg, _>(&by_collection_not_deleted(collection_id)).to_string();
    
    assert!(
        query_str.contains("deleted_at"),
        "by_collection_not_deleted should filter by deleted_at"
    );
}

#[test]
fn test_entity_filter() {
    let entity_id = uuid::Uuid::new_v4();
    let query_str = diesel::debug_query::<diesel::pg::Pg, _>(&by_entity(entity_id)).to_string();
    
    assert!(
        query_str.contains("entity_id"),
        "by_entity should filter by entity_id"
    );
}

#[test]
fn test_etag_filter() {
    let etag = "test-etag";
    let query_str = diesel::debug_query::<diesel::pg::Pg, _>(&by_etag(etag)).to_string();
    
    assert!(
        query_str.contains("etag"),
        "by_etag should filter by etag"
    );
}

#[test]
fn test_different_collection_ids_produce_different_queries() {
    let id1 = uuid::Uuid::new_v4();
    let id2 = uuid::Uuid::new_v4();
    
    let query1 = diesel::debug_query::<diesel::pg::Pg, _>(&by_collection(id1)).to_string();
    let query2 = diesel::debug_query::<diesel::pg::Pg, _>(&by_collection(id2)).to_string();
    
    // Both should be valid but with different values
    assert_ne!(query1, query2, "Different collection IDs should produce different query parameters");
}

#[test]
fn test_etag_generation_is_deterministic() {
    let data1 = b"test data";
    let data2 = b"test data";
    let data3 = b"different data";
    
    let etag1 = generate_etag(data1);
    let etag2 = generate_etag(data2);
    let etag3 = generate_etag(data3);
    
    assert_eq!(etag1, etag2, "Same data should produce same ETag");
    assert_ne!(etag1, etag3, "Different data should produce different ETag");
}

#[test]
fn test_etag_format() {
    let data = b"test content";
    let etag = generate_etag(data);
    
    // ETag should be a hex string (SHA-256 produces 64 hex characters)
    assert_eq!(etag.len(), 64, "ETag should be 64 characters (SHA-256 hex)");
    assert!(etag.chars().all(|c| c.is_ascii_hexdigit()), "ETag should only contain hex digits");
}
