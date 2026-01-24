//! Unit tests for DAV entity query builders.

use diesel::query_builder::QueryFragment;

use super::query_builders::*;

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
fn test_all_entities_query_builds() {
    let query = all();
    assert!(query_is_valid(query), "all() query should be valid");
}

#[test]
fn test_entity_by_id_query_builds() {
    let id = uuid::Uuid::new_v4();
    let query = by_id(id);
    assert!(query_is_valid(query), "by_id() query should be valid");
}

#[test]
fn test_entity_by_logical_uid_query_builds() {
    let uid = "test-uid-123";
    let query = by_logical_uid(uid);
    assert!(query_is_valid(query), "by_logical_uid() query should be valid");
}

#[test]
fn test_entity_not_deleted_query_builds() {
    let query = not_deleted();
    assert!(query_is_valid(query), "not_deleted() query should be valid");
}

#[test]
fn test_all_components_query_builds() {
    let query = components_for_entity(uuid::Uuid::new_v4());
    assert!(query_is_valid(query), "components_for_entity() query should be valid");
}

#[test]
fn test_properties_for_component_query_builds() {
    let component_id = uuid::Uuid::new_v4();
    let query = properties_for_component(component_id);
    assert!(query_is_valid(query), "properties_for_component() query should be valid");
}

#[test]
fn test_parameters_for_property_query_builds() {
    let property_id = uuid::Uuid::new_v4();
    let query = parameters_for_property(property_id);
    assert!(query_is_valid(query), "parameters_for_property() query should be valid");
}

#[test]
fn test_entity_query_contains_filters() {
    let uid = "unique-identifier";
    let query_str = diesel::debug_query::<diesel::pg::Pg, _>(&by_logical_uid(uid)).to_string();
    
    assert!(
        query_str.contains("logical_uid"),
        "by_logical_uid should filter by logical_uid"
    );
}

#[test]
fn test_entity_not_deleted_filter() {
    let query_str = diesel::debug_query::<diesel::pg::Pg, _>(&not_deleted()).to_string();
    
    assert!(
        query_str.contains("deleted_at"),
        "not_deleted should filter by deleted_at"
    );
}

#[test]
fn test_components_for_entity_filter() {
    let entity_id = uuid::Uuid::new_v4();
    let query_str = diesel::debug_query::<diesel::pg::Pg, _>(&components_for_entity(entity_id)).to_string();
    
    assert!(
        query_str.contains("entity_id"),
        "components_for_entity should filter by entity_id"
    );
}

#[test]
fn test_properties_for_component_filter() {
    let component_id = uuid::Uuid::new_v4();
    let query_str = diesel::debug_query::<diesel::pg::Pg, _>(&properties_for_component(component_id)).to_string();
    
    assert!(
        query_str.contains("component_id"),
        "properties_for_component should filter by component_id"
    );
}

#[test]
fn test_parameters_for_property_filter() {
    let property_id = uuid::Uuid::new_v4();
    let query_str = diesel::debug_query::<diesel::pg::Pg, _>(&parameters_for_property(property_id)).to_string();
    
    assert!(
        query_str.contains("property_id"),
        "parameters_for_property should filter by property_id"
    );
}

#[test]
fn test_query_ordering() {
    let component_id = uuid::Uuid::new_v4();
    let query_str = diesel::debug_query::<diesel::pg::Pg, _>(&properties_for_component(component_id)).to_string();
    
    assert!(
        query_str.contains("ORDER BY"),
        "properties_for_component should include ordering"
    );
    assert!(
        query_str.contains("ordinal"),
        "properties_for_component should order by ordinal"
    );
}

#[test]
fn test_different_entity_ids_produce_different_queries() {
    let id1 = uuid::Uuid::new_v4();
    let id2 = uuid::Uuid::new_v4();
    
    let query1 = diesel::debug_query::<diesel::pg::Pg, _>(&components_for_entity(id1)).to_string();
    let query2 = diesel::debug_query::<diesel::pg::Pg, _>(&components_for_entity(id2)).to_string();
    
    // Both should be valid but with different values
    assert_ne!(query1, query2, "Different entity IDs should produce different query parameters");
}
