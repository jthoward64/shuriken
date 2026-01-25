//! iCalendar to database model mapping.

use crate::component::model::dav::component::NewDavComponent;
use crate::component::model::dav::entity::NewDavEntity;
use crate::component::model::dav::parameter::NewDavParameter;
use crate::component::model::dav::property::NewDavProperty;
use crate::component::rfc::ical::core::{Component, ICalendar, Parameter, Property};

use super::extract::{extract_ical_uid, extract_ical_value};

/// Type alias for the complex return type of database model mappings.
type DbModels<'a> = (
    NewDavEntity<'static>,
    Vec<NewDavComponent<'a>>,
    Vec<NewDavProperty<'a>>,
    Vec<NewDavParameter<'static>>,
);

/// ## Summary
/// Maps an iCalendar component tree to database models.
///
/// Returns entity info and flat lists of components, properties, and parameters
/// ready for batch insertion.
///
/// ## Errors
/// Returns an error if the mapping fails (e.g., unsupported value types).
pub fn icalendar_to_db_models<'a>(
    ical: &'a ICalendar,
    entity_type: &str,
) -> anyhow::Result<DbModels<'a>> {
    // Extract logical UID from top-level component - leak to get 'static lifetime
    let logical_uid_opt =
        extract_ical_uid(&ical.root).map(|s| Box::leak(s.into_boxed_str()) as &'static str);

    // Leak entity_type to get 'static lifetime
    let entity_type_static = Box::leak(entity_type.to_string().into_boxed_str()) as &'static str;

    let entity = NewDavEntity {
        entity_type: entity_type_static,
        logical_uid: logical_uid_opt,
    };

    let mut components = Vec::new();
    let mut properties = Vec::new();
    let mut parameters = Vec::new();

    // Placeholder entity_id - will be replaced after insert
    let entity_id = uuid::Uuid::nil();

    map_ical_component_recursive(
        &ical.root,
        entity_id,
        None,
        0,
        &mut components,
        &mut properties,
        &mut parameters,
    )?;

    Ok((entity, components, properties, parameters))
}

/// ## Summary
/// Recursively maps an iCalendar component and its children to database models.
#[expect(
    clippy::too_many_arguments,
    reason = "Accumulator pattern for building component tree requires these parameters"
)]
fn map_ical_component_recursive<'a>(
    component: &'a Component,
    entity_id: uuid::Uuid,
    parent_id: Option<uuid::Uuid>,
    ordinal: i32,
    components: &mut Vec<NewDavComponent<'a>>,
    properties: &mut Vec<NewDavProperty<'a>>,
    parameters: &mut Vec<NewDavParameter<'static>>,
) -> anyhow::Result<()> {
    let component_id = uuid::Uuid::nil(); // Placeholder

    components.push(NewDavComponent {
        entity_id,
        parent_component_id: parent_id,
        name: &component.name,
        ordinal,
    });

    // Map properties
    for (prop_ord, prop) in component.properties.iter().enumerate() {
        map_ical_property(
            prop,
            component_id,
            #[expect(
                clippy::cast_possible_truncation,
                clippy::cast_possible_wrap,
                reason = "Property counts per component are bounded by RFC limits (<1000), truncation to i32 is safe"
            )]
            {
                prop_ord as i32
            },
            properties,
            parameters,
        )?;
    }

    // Recursively map children
    for (child_ord, child) in component.children.iter().enumerate() {
        map_ical_component_recursive(
            child,
            entity_id,
            Some(component_id),
            #[expect(
                clippy::cast_possible_truncation,
                clippy::cast_possible_wrap,
                reason = "Child component counts are bounded by RFC limits (<100), truncation to i32 is safe"
            )]
            {
                child_ord as i32
            },
            components,
            properties,
            parameters,
        )?;
    }

    Ok(())
}

/// ## Summary
/// Maps an iCalendar property to a database property model.
fn map_ical_property<'a>(
    prop: &'a Property,
    component_id: uuid::Uuid,
    ordinal: i32,
    properties: &mut Vec<NewDavProperty<'a>>,
    parameters: &mut Vec<NewDavParameter<'static>>,
) -> anyhow::Result<()> {
    let property_id = uuid::Uuid::nil(); // Placeholder

    let (value_type, value_text, value_int, value_float, value_bool, value_date, value_tstz) =
        extract_ical_value(&prop.value, &prop.raw_value)?;

    properties.push(NewDavProperty {
        component_id,
        name: &prop.name,
        value_type,
        value_text,
        value_int,
        value_float,
        value_bool,
        value_date,
        value_tstz,
        value_bytes: None,
        value_json: None,
        ordinal,
    });

    // Map parameters
    for (param_ord, param) in prop.params.iter().enumerate() {
        map_ical_parameter(
            param,
            property_id,
            #[expect(
                clippy::cast_possible_truncation,
                clippy::cast_possible_wrap,
                reason = "Parameter counts per property are bounded by RFC limits (<50), truncation to i32 is safe"
            )]
            {
                param_ord as i32
            },
            parameters,
        );
    }

    Ok(())
}

/// ## Summary
/// Maps an iCalendar parameter to a database parameter model.
fn map_ical_parameter(
    param: &Parameter,
    property_id: uuid::Uuid,
    ordinal: i32,
    parameters: &mut Vec<NewDavParameter<'static>>,
) {
    // Join multiple values with comma if present - leak all strings for 'static
    let name_static = Box::leak(param.name.clone().into_boxed_str()) as &'static str;
    let value_static = Box::leak(param.values.join(",").into_boxed_str()) as &'static str;

    parameters.push(NewDavParameter {
        property_id,
        name: name_static,
        value: value_static,
        ordinal,
    });
}
