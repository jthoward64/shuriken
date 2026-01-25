//! DAV entity query operations.

mod crud;
mod query_builders;
mod tree;
mod tree_insert;
mod uid_conflict;

// Re-export public APIs
pub use crud::{
    create_entity,
    insert_components,
    insert_parameters,
    insert_properties,
    soft_delete_components,
    soft_delete_parameters_for_entity,
    soft_delete_properties_for_entity,
};
pub use query_builders::{
    all,
    by_id,
    by_logical_uid,
    components_for_entity,
    not_deleted,
    parameters_for_property,
    properties_for_component,
};
pub use tree::{get_entity_with_tree, replace_entity_tree};
pub use tree_insert::{insert_ical_tree, insert_vcard_tree};
pub use uid_conflict::check_uid_conflict;

#[cfg(test)]
mod query_builder_tests;
