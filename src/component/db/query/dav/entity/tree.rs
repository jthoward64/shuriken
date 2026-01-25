//! Entity tree operations (get/replace full component trees).

use diesel::prelude::*;
use diesel_async::RunQueryDsl;

use crate::component::model::dav::component::{DavComponent, NewDavComponent};
use crate::component::model::dav::entity::DavEntity;
use crate::component::model::dav::parameter::{DavParameter, NewDavParameter};
use crate::component::model::dav::property::{DavProperty, NewDavProperty};

use super::crud;
use super::query_builders::{
    by_id, components_for_entity, parameters_for_property, properties_for_component,
};

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
    let entity: Option<DavEntity> = by_id(entity_id).first(conn).await.optional()?;

    let Some(entity) = entity else {
        return Ok(None);
    };

    let components: Vec<DavComponent> = components_for_entity(entity_id).load(conn).await?;

    let mut component_tree = Vec::new();
    for component in components {
        let properties: Vec<DavProperty> =
            properties_for_component(component.id).load(conn).await?;

        let mut property_tree = Vec::new();
        for property in properties {
            let parameters: Vec<DavParameter> =
                parameters_for_property(property.id).load(conn).await?;
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
    crud::soft_delete_parameters_for_entity(conn, entity_id).await?;
    crud::soft_delete_properties_for_entity(conn, entity_id).await?;
    crud::soft_delete_components(conn, entity_id).await?;

    // Insert new tree
    if !components.is_empty() {
        crud::insert_components(conn, components).await?;
    }
    if !properties.is_empty() {
        crud::insert_properties(conn, properties).await?;
    }
    if !parameters.is_empty() {
        crud::insert_parameters(conn, parameters).await?;
    }

    Ok(())
}
