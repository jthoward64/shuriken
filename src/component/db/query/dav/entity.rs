//! Query functions for DAV entities and their component trees.

use diesel::prelude::*;
use diesel_async::RunQueryDsl;

use crate::component::db::schema::{dav_component, dav_entity, dav_parameter, dav_property};
use crate::component::model::dav::component::{DavComponent, NewDavComponent};
use crate::component::model::dav::entity::{DavEntity, NewDavEntity};
use crate::component::model::dav::parameter::{DavParameter, NewDavParameter};
use crate::component::model::dav::property::{DavProperty, NewDavProperty};

type BoxedQuery<'a, T> = dav_entity::BoxedQuery<'a, diesel::pg::Pg, T>;

/// ## Summary
/// Returns a query to select all entities.
#[diesel::dsl::auto_type]
#[must_use]
pub fn all() -> BoxedQuery<'static, DavEntity> {
    dav_entity::table
        .select(DavEntity::as_select())
        .into_boxed()
}

/// ## Summary
/// Returns a query to find an entity by ID.
#[diesel::dsl::auto_type]
#[must_use]
pub fn by_id(id: uuid::Uuid) -> BoxedQuery<'static, DavEntity> {
    all().filter(dav_entity::id.eq(id)).into_boxed()
}

/// ## Summary
/// Returns a query to find entities by logical UID.
#[must_use]
pub fn by_logical_uid(uid: &str) -> dav_entity::BoxedQuery<'_, diesel::pg::Pg, DavEntity> {
    all()
        .filter(dav_entity::logical_uid.eq(uid))
        .into_boxed()
}

/// ## Summary
/// Returns a query to find non-deleted entities.
#[diesel::dsl::auto_type]
#[must_use]
pub fn not_deleted() -> BoxedQuery<'static, DavEntity> {
    all()
        .filter(dav_entity::deleted_at.is_null())
        .into_boxed()
}

/// ## Summary
/// Returns a query to find components for an entity.
#[diesel::dsl::auto_type]
#[must_use]
pub fn components_for_entity(
    entity_id: uuid::Uuid,
) -> dav_component::BoxedQuery<'static, diesel::pg::Pg, DavComponent> {
    dav_component::table
        .select(DavComponent::as_select())
        .filter(dav_component::entity_id.eq(entity_id))
        .filter(dav_component::deleted_at.is_null())
        .order(dav_component::ordinal.asc())
        .into_boxed()
}

/// ## Summary
/// Returns a query to find properties for a component.
#[diesel::dsl::auto_type]
#[must_use]
pub fn properties_for_component(
    component_id: uuid::Uuid,
) -> dav_property::BoxedQuery<'static, diesel::pg::Pg, DavProperty> {
    dav_property::table
        .select(DavProperty::as_select())
        .filter(dav_property::component_id.eq(component_id))
        .filter(dav_property::deleted_at.is_null())
        .order(dav_property::ordinal.asc())
        .into_boxed()
}

/// ## Summary
/// Returns a query to find parameters for a property.
#[diesel::dsl::auto_type]
#[must_use]
pub fn parameters_for_property(
    property_id: uuid::Uuid,
) -> dav_parameter::BoxedQuery<'static, diesel::pg::Pg, DavParameter> {
    dav_parameter::table
        .select(DavParameter::as_select())
        .filter(dav_parameter::property_id.eq(property_id))
        .filter(dav_parameter::deleted_at.is_null())
        .order(dav_parameter::ordinal.asc())
        .into_boxed()
}

/// ## Summary
/// Inserts a new entity and returns the inserted record.
///
/// ## Errors
/// Returns a database error if the insert fails.
pub async fn create_entity(
    conn: &mut crate::component::db::connection::DbConnection<'_>,
    new_entity: &NewDavEntity<'_>,
) -> diesel::QueryResult<DavEntity> {
    diesel::insert_into(dav_entity::table)
        .values(new_entity)
        .returning(DavEntity::as_returning())
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
) -> diesel::QueryResult<Vec<DavComponent>> {
    diesel::insert_into(dav_component::table)
        .values(components)
        .returning(DavComponent::as_returning())
        .get_results(conn)
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
) -> diesel::QueryResult<Vec<DavProperty>> {
    diesel::insert_into(dav_property::table)
        .values(properties)
        .returning(DavProperty::as_returning())
        .get_results(conn)
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
) -> diesel::QueryResult<Vec<DavParameter>> {
    diesel::insert_into(dav_parameter::table)
        .values(parameters)
        .returning(DavParameter::as_returning())
        .get_results(conn)
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
) -> diesel::QueryResult<usize> {
    diesel::update(dav_component::table)
        .filter(dav_component::entity_id.eq(entity_id))
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
) -> diesel::QueryResult<usize> {
    diesel::update(dav_property::table)
        .filter(
            dav_property::component_id.eq_any(
                dav_component::table
                    .select(dav_component::id)
                    .filter(dav_component::entity_id.eq(entity_id)),
            ),
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
) -> diesel::QueryResult<usize> {
    diesel::update(dav_parameter::table)
        .filter(
            dav_parameter::property_id.eq_any(
                dav_property::table
                    .select(dav_property::id)
                    .filter(
                        dav_property::component_id.eq_any(
                            dav_component::table
                                .select(dav_component::id)
                                .filter(dav_component::entity_id.eq(entity_id)),
                        ),
                    ),
            ),
        )
        .set(dav_parameter::deleted_at.eq(diesel::dsl::now))
        .execute(conn)
        .await
}

/// ## Summary
/// Retrieves an entity with its full component tree (components, properties, parameters).
///
/// ## Errors
/// Returns a database error if any query fails.
pub async fn get_entity_with_tree(
    conn: &mut crate::component::db::connection::DbConnection<'_>,
    entity_id: uuid::Uuid,
) -> diesel::QueryResult<
    Option<(
        DavEntity,
        Vec<(DavComponent, Vec<(DavProperty, Vec<DavParameter>)>)>,
    )>,
> {
    let entity: Option<DavEntity> = by_id(entity_id)
        .get_result::<DavEntity>(conn)
        .await
        .optional()?;

    let Some(entity) = entity else {
        return Ok(None);
    };

    let components: Vec<DavComponent> = components_for_entity(entity_id)
        .get_results::<DavComponent>(conn)
        .await?;

    let mut component_tree = Vec::new();
    for component in components {
        let properties: Vec<DavProperty> = properties_for_component(component.id)
            .get_results::<DavProperty>(conn)
            .await?;

        let mut property_tree = Vec::new();
        for property in properties {
            let parameters: Vec<DavParameter> = parameters_for_property(property.id)
                .get_results::<DavParameter>(conn)
                .await?;
            property_tree.push((property, parameters));
        }

        component_tree.push((component, property_tree));
    }

    Ok(Some((entity, component_tree)))
}

/// ## Summary
/// Updates an entity's component tree by soft-deleting old data and inserting new.
///
/// This replaces the entire component tree for an entity with new data.
///
/// ## Errors
/// Returns a database error if any operation fails.
pub async fn replace_entity_tree(
    conn: &mut crate::component::db::connection::DbConnection<'_>,
    entity_id: uuid::Uuid,
    components: &[NewDavComponent<'_>],
    properties: &[NewDavProperty<'_>],
    parameters: &[NewDavParameter<'_>],
) -> diesel::QueryResult<()> {
    // Soft-delete existing tree
    soft_delete_parameters_for_entity(conn, entity_id).await?;
    soft_delete_properties_for_entity(conn, entity_id).await?;
    soft_delete_components(conn, entity_id).await?;

    // Insert new tree
    if !components.is_empty() {
        insert_components(conn, components).await?;
    }
    if !properties.is_empty() {
        insert_properties(conn, properties).await?;
    }
    if !parameters.is_empty() {
        insert_parameters(conn, parameters).await?;
    }

    Ok(())
}
