//! CRUD operations for DAV entities.

use diesel::prelude::*;
use diesel_async::RunQueryDsl;

use crate::component::db::schema::{dav_component, dav_parameter, dav_property};
use crate::component::model::dav::component::NewDavComponent;
use crate::component::model::dav::entity::{DavEntity, NewDavEntity};
use crate::component::model::dav::parameter::NewDavParameter;
use crate::component::model::dav::property::NewDavProperty;

/// ## Summary
/// Inserts a new entity and returns the inserted record.
///
/// ## Errors
/// Returns a database error if the insert fails.
pub async fn create_entity(
    conn: &mut crate::component::db::connection::DbConnection<'_>,
    entity: &NewDavEntity<'_>,
) -> Result<DavEntity, diesel::result::Error> {
    use crate::component::db::schema::dav_entity;
    diesel::insert_into(dav_entity::table)
        .values(entity)
        .get_result(conn)
        .await
}

/// ## Summary
/// Inserts multiple components for an entity.
///
/// ## Errors
/// Returns a database error if the insert fails.
pub async fn insert_components(
    conn: &mut crate::component::db::connection::DbConnection<'_>,
    components: &[NewDavComponent<'_>],
) -> Result<usize, diesel::result::Error> {
    diesel::insert_into(dav_component::table)
        .values(components)
        .execute(conn)
        .await
}

/// ## Summary
/// Inserts multiple properties for components.
///
/// ## Errors
/// Returns a database error if the insert fails.
pub async fn insert_properties(
    conn: &mut crate::component::db::connection::DbConnection<'_>,
    properties: &[NewDavProperty<'_>],
) -> Result<usize, diesel::result::Error> {
    diesel::insert_into(dav_property::table)
        .values(properties)
        .execute(conn)
        .await
}

/// ## Summary
/// Inserts multiple parameters for properties.
///
/// ## Errors
/// Returns a database error if the insert fails.
pub async fn insert_parameters(
    conn: &mut crate::component::db::connection::DbConnection<'_>,
    parameters: &[NewDavParameter<'_>],
) -> Result<usize, diesel::result::Error> {
    diesel::insert_into(dav_parameter::table)
        .values(parameters)
        .execute(conn)
        .await
}

/// ## Summary
/// Soft-deletes components by entity ID.
///
/// ## Errors
/// Returns a database error if the update fails.
pub async fn soft_delete_components(
    conn: &mut crate::component::db::connection::DbConnection<'_>,
    entity_id: uuid::Uuid,
) -> Result<usize, diesel::result::Error> {
    diesel::update(dav_component::table.filter(dav_component::entity_id.eq(entity_id)))
        .set(dav_component::deleted_at.eq(diesel::dsl::now))
        .execute(conn)
        .await
}

/// ## Summary
/// Soft-deletes properties for an entity's components.
///
/// ## Errors
/// Returns a database error if the update fails.
pub async fn soft_delete_properties_for_entity(
    conn: &mut crate::component::db::connection::DbConnection<'_>,
    entity_id: uuid::Uuid,
) -> Result<usize, diesel::result::Error> {
    diesel::update(
        dav_property::table.filter(
            dav_property::component_id.eq_any(
                dav_component::table
                    .filter(dav_component::entity_id.eq(entity_id))
                    .select(dav_component::id)
            )
        )
    )
    .set(dav_property::deleted_at.eq(diesel::dsl::now))
    .execute(conn)
    .await
}

/// ## Summary
/// Soft-deletes parameters for an entity's properties.
///
/// ## Errors
/// Returns a database error if the update fails.
pub async fn soft_delete_parameters_for_entity(
    conn: &mut crate::component::db::connection::DbConnection<'_>,
    entity_id: uuid::Uuid,
) -> Result<usize, diesel::result::Error> {
    diesel::update(
        dav_parameter::table.filter(
            dav_parameter::property_id.eq_any(
                dav_property::table
                    .filter(
                        dav_property::component_id.eq_any(
                            dav_component::table
                                .filter(dav_component::entity_id.eq(entity_id))
                                .select(dav_component::id)
                        )
                    )
                    .select(dav_property::id)
            )
        )
    )
    .set(dav_parameter::deleted_at.eq(diesel::dsl::now))
    .execute(conn)
    .await
}
