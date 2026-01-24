//! Unit tests for DAV collection query builders.

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
fn test_all_query_builds() {
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
fn test_by_principal_query_builds() {
    let principal_id = uuid::Uuid::new_v4();
    let query = by_principal(principal_id);
    assert!(query_is_valid(query), "by_principal() query should be valid");
}

#[test]
fn test_by_principal_not_deleted_query_builds() {
    let principal_id = uuid::Uuid::new_v4();
    let query = by_principal_not_deleted(principal_id);
    assert!(
        query_is_valid(query),
        "by_principal_not_deleted() query should be valid"
    );
}

#[test]
fn test_by_uri_and_principal_query_builds() {
    let principal_id = uuid::Uuid::new_v4();
    let query = by_uri_and_principal("/calendars/user/work", principal_id);
    assert!(
        query_is_valid(query),
        "by_uri_and_principal() query should be valid"
    );
}

#[test]
fn test_not_deleted_query_builds() {
    let query = not_deleted();
    assert!(query_is_valid(query), "not_deleted() query should be valid");
}

#[test]
fn test_by_sync_token_query_builds() {
    let query = by_sync_token(42);
    assert!(
        query_is_valid(query),
        "by_sync_token() query should be valid"
    );
}

#[test]
fn test_query_filters_are_correct() {
    let principal_id = uuid::Uuid::new_v4();
    
    // Test that by_principal includes the filter
    let query_str = diesel::debug_query::<diesel::pg::Pg, _>(&by_principal(principal_id)).to_string();
    assert!(
        query_str.contains("owner_principal_id"),
        "by_principal should filter by owner_principal_id"
    );
    
    // Test that by_principal_not_deleted includes both filters
    let query_str = diesel::debug_query::<diesel::pg::Pg, _>(&by_principal_not_deleted(principal_id)).to_string();
    assert!(
        query_str.contains("owner_principal_id"),
        "by_principal_not_deleted should filter by owner_principal_id"
    );
    assert!(
        query_str.contains("deleted_at"),
        "by_principal_not_deleted should filter by deleted_at"
    );
}

#[test]
fn test_uri_filter_is_present() {
    let principal_id = uuid::Uuid::new_v4();
    let uri = "/calendars/test";
    let query_str = diesel::debug_query::<diesel::pg::Pg, _>(&by_uri_and_principal(uri, principal_id)).to_string();
    
    assert!(
        query_str.contains("uri"),
        "by_uri_and_principal should filter by uri"
    );
    assert!(
        query_str.contains("owner_principal_id"),
        "by_uri_and_principal should filter by owner_principal_id"
    );
}

#[test]
fn test_sync_token_filter() {
    let query_str = diesel::debug_query::<diesel::pg::Pg, _>(&by_sync_token(100)).to_string();
    
    assert!(
        query_str.contains("sync_token"),
        "by_sync_token should filter by sync_token"
    );
}

#[test]
fn test_different_uuids_produce_different_queries() {
    let id1 = uuid::Uuid::new_v4();
    let id2 = uuid::Uuid::new_v4();
    
    let query1 = diesel::debug_query::<diesel::pg::Pg, _>(&by_id(id1)).to_string();
    let query2 = diesel::debug_query::<diesel::pg::Pg, _>(&by_id(id2)).to_string();
    
    // Both should be valid but with different values
    assert_ne!(query1, query2, "Different UUIDs should produce different query parameters");
}
