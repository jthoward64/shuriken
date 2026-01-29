//! Query builder functions for DAV entities.

use diesel::prelude::*;

use crate::db::schema::{dav_component, dav_entity, dav_parameter, dav_property};

/// ## Summary
/// Returns a query to select all entities.
#[must_use]
pub fn all() -> dav_entity::BoxedQuery<'static, diesel::pg::Pg> {
    dav_entity::table.into_boxed()
}

/// ## Summary
/// Returns a query to find an entity by ID.
#[must_use]
pub fn by_id(id: uuid::Uuid) -> dav_entity::BoxedQuery<'static, diesel::pg::Pg> {
    all().filter(dav_entity::id.eq(id))
}

/// ## Summary
/// Returns a query to find entities by logical UID.
#[must_use]
pub fn by_logical_uid(uid: &str) -> dav_entity::BoxedQuery<'_, diesel::pg::Pg> {
    all().filter(dav_entity::logical_uid.eq(uid))
}

/// ## Summary
/// Returns a query to find non-deleted entities.
#[must_use]
pub fn not_deleted() -> dav_entity::BoxedQuery<'static, diesel::pg::Pg> {
    all().filter(dav_entity::deleted_at.is_null())
}

/// ## Summary
/// Returns a query to find components for an entity.
#[must_use]
pub fn components_for_entity(
    entity_id: uuid::Uuid,
) -> dav_component::BoxedQuery<'static, diesel::pg::Pg> {
    dav_component::table
        .filter(dav_component::entity_id.eq(entity_id))
        .filter(dav_component::deleted_at.is_null())
        .order(dav_component::ordinal.asc())
        .into_boxed()
}

/// ## Summary
/// Returns a query to find properties for a component.
#[must_use]
pub fn properties_for_component(
    component_id: uuid::Uuid,
) -> dav_property::BoxedQuery<'static, diesel::pg::Pg> {
    dav_property::table
        .filter(dav_property::component_id.eq(component_id))
        .filter(dav_property::deleted_at.is_null())
        .order(dav_property::ordinal.asc())
        .into_boxed()
}

/// ## Summary
/// Returns a query to find parameters for a property.
#[must_use]
pub fn parameters_for_property(
    property_id: uuid::Uuid,
) -> dav_parameter::BoxedQuery<'static, diesel::pg::Pg> {
    dav_parameter::table
        .filter(dav_parameter::property_id.eq(property_id))
        .filter(dav_parameter::deleted_at.is_null())
        .order(dav_parameter::ordinal.asc())
        .into_boxed()
}
