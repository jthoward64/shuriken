//! Component tree insertion functions for storing parsed iCalendar/vCard trees.

#![allow(clippy::too_many_lines)] // Recursive tree insertion logic

use std::collections::HashMap;

use diesel::prelude::*;
use diesel_async::RunQueryDsl;

use crate::db::schema::{dav_component, dav_parameter, dav_property};
use crate::model::dav::component::{DavComponent, NewDavComponent};
use crate::model::dav::parameter::NewDavParameter;
use crate::model::dav::property::{DavProperty, NewDavProperty};
use shuriken_rfc::rfc::ical::core::ICalendar;
use shuriken_rfc::rfc::vcard::core::VCard;

/// Type alias for the component ID mapping returned by tree insertion.
/// Maps `(component_name, uid)` tuples to their database `component_id` values.
pub type ComponentIdMap = HashMap<(String, Option<String>), uuid::Uuid>;

/// ## Summary
/// Inserts an iCalendar component tree with proper ID mapping.
///
/// Processes components recursively, ensuring each level gets proper parent IDs.
/// Returns a `HashMap` mapping `(component_name, uid)` tuples to their database component IDs.
/// This allows calendar indexing to reference real component IDs.
///
/// ## Errors
/// Returns a database error if any insert fails.
#[tracing::instrument(skip(conn, ical))]
pub async fn insert_ical_tree(
    conn: &mut crate::db::connection::DbConnection<'_>,
    entity_id: uuid::Uuid,
    ical: &ICalendar,
) -> diesel::QueryResult<ComponentIdMap> {
    tracing::debug!("Inserting iCalendar component tree");

    let mut component_map = HashMap::new();
    insert_component_recursive(conn, entity_id, &ical.root, None, 0, &mut component_map).await?;

    tracing::debug!("iCalendar component tree inserted successfully");
    Ok(component_map)
}

/// ## Summary
/// Inserts a vCard as a flat property list.
///
/// vCards don't have a component tree like iCalendar - they're just a flat list of properties.
/// We create a single root component named "VCARD" and attach all properties to it.
///
/// ## Errors
/// Returns a database error if any insert fails.
#[tracing::instrument(skip(conn, vcard), fields(property_count = vcard.properties.len()))]
#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    reason = "Property/parameter counts are bounded by RFC limits, truncation safe"
)]
pub async fn insert_vcard_tree(
    conn: &mut crate::db::connection::DbConnection<'_>,
    entity_id: uuid::Uuid,
    vcard: &VCard,
) -> diesel::QueryResult<()> {
    tracing::debug!("Inserting vCard property tree");

    // Insert root VCARD component
    let new_component = NewDavComponent {
        entity_id,
        parent_component_id: None,
        name: "VCARD",
        ordinal: 0,
    };

    let inserted_component: DavComponent = diesel::insert_into(dav_component::table)
        .values(&new_component)
        .returning(DavComponent::as_returning())
        .get_result(conn)
        .await?;

    let component_id = inserted_component.id;

    tracing::trace!(component_id = %component_id, "Root VCARD component created");

    // Insert VERSION property explicitly (vCard parser stores version separately)
    let version_property = NewDavProperty {
        component_id,
        name: "VERSION",
        group: None,
        value_type: crate::db::enums::ValueType::Text,
        value_text: Some(vcard.version.as_str()),
        value_int: None,
        value_float: None,
        value_bool: None,
        value_date: None,
        value_tstz: None,
        value_bytes: None,
        value_json: None,
        ordinal: 0,
    };

    let _version_property: DavProperty = diesel::insert_into(dav_property::table)
        .values(&version_property)
        .returning(DavProperty::as_returning())
        .get_result(conn)
        .await?;

    // Insert all vCard properties
    for (prop_ord, vcard_prop) in vcard.properties.iter().enumerate() {
        let new_property = NewDavProperty {
            component_id,
            name: &vcard_prop.name,
            group: vcard_prop.group.as_deref(),
            value_type: crate::db::enums::ValueType::Text,
            value_text: Some(&vcard_prop.raw_value),
            value_int: None,
            value_float: None,
            value_bool: None,
            value_date: None,
            value_tstz: None,
            value_bytes: None,
            value_json: None,
            ordinal: (prop_ord + 1) as i32,
        };

        let inserted_property: DavProperty = diesel::insert_into(dav_property::table)
            .values(&new_property)
            .returning(DavProperty::as_returning())
            .get_result(conn)
            .await?;

        let property_id = inserted_property.id;

        // Insert parameters for this property
        for (param_ord, param) in vcard_prop.params.iter().enumerate() {
            let param_value = param.values.join(",");
            let new_parameter = NewDavParameter {
                property_id,
                name: Box::leak(param.name.clone().into_boxed_str()),
                value: Box::leak(param_value.into_boxed_str()),
                ordinal: param_ord as i32,
            };

            diesel::insert_into(dav_parameter::table)
                .values(&new_parameter)
                .execute(conn)
                .await?;
        }
    }

    tracing::debug!("vCard property tree inserted successfully");
    Ok(())
}

/// Recursively inserts a component and its children.
/// Builds a mapping of `(component_name, uid)` to `component_id` for indexing.
#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    clippy::too_many_arguments,
    reason = "Component tree depth and property counts are bounded by RFC limits, truncation safe; component_map accumulator required for mapping"
)]
fn insert_component_recursive<'a>(
    conn: &'a mut crate::db::connection::DbConnection<'_>,
    entity_id: uuid::Uuid,
    component: &'a shuriken_rfc::rfc::ical::core::Component,
    parent_id: Option<uuid::Uuid>,
    ordinal: i32,
    component_map: &'a mut ComponentIdMap,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = diesel::QueryResult<()>> + Send + 'a>> {
    Box::pin(async move {
        // Insert this component
        let new_component = NewDavComponent {
            entity_id,
            parent_component_id: parent_id,
            name: &component.name,
            ordinal,
        };

        let inserted_component: DavComponent = diesel::insert_into(dav_component::table)
            .values(&new_component)
            .returning(DavComponent::as_returning())
            .get_result(conn)
            .await?;

        let component_id = inserted_component.id;

        // Store component ID mapping for indexable components
        if let Some(kind) = component.kind
            && kind.is_schedulable()
        {
            let uid = component.uid().map(String::from);
            let key = (component.name.clone(), uid);
            component_map.insert(key, component_id);
        }

        // Insert properties for this component
        for (prop_ord, prop) in component.properties.iter().enumerate() {
            // Use raw_value for text storage
            let new_property = NewDavProperty {
                component_id,
                name: &prop.name,
                group: None,
                value_type: crate::db::enums::ValueType::Text,
                value_text: Some(&prop.raw_value),
                value_int: None,
                value_float: None,
                value_bool: None,
                value_date: None,
                value_tstz: None,
                value_bytes: None,
                value_json: None,
                ordinal: prop_ord as i32,
            };

            let inserted_property: DavProperty = diesel::insert_into(dav_property::table)
                .values(&new_property)
                .returning(DavProperty::as_returning())
                .get_result(conn)
                .await?;

            let property_id = inserted_property.id;

            // Insert parameters for this property
            for (param_ord, param) in prop.params.iter().enumerate() {
                let param_value = param.value().unwrap_or("");
                let new_parameter = NewDavParameter {
                    property_id,
                    name: Box::leak(param.name.clone().into_boxed_str()),
                    value: Box::leak(param_value.to_string().into_boxed_str()),
                    ordinal: param_ord as i32,
                };

                diesel::insert_into(dav_parameter::table)
                    .values(&new_parameter)
                    .execute(conn)
                    .await?;
            }
        }

        // Recursively insert children
        for (child_ord, child) in component.children.iter().enumerate() {
            insert_component_recursive(
                conn,
                entity_id,
                child,
                Some(component_id),
                child_ord as i32,
                component_map,
            )
            .await?;
        }

        Ok(())
    })
}

#[cfg(test)]
mod tests {
    #[expect(unused_imports)]
    use super::*;

    #[test]
    fn test_insert_tree_functions_compile() {
        // This test just verifies the function signatures compile
    }
}
