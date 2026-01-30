//! vCard to database model mapping.

use crate::model::dav::component::NewDavComponent;
use crate::model::dav::entity::NewDavEntity;
use crate::model::dav::parameter::NewDavParameter;
use crate::model::dav::property::NewDavProperty;
use shuriken_rfc::rfc::vcard::core::{VCard, VCardParameter, VCardProperty};

use super::extract::{extract_vcard_uid, extract_vcard_value};

/// Type alias for the complex return type of database model mappings.
type DbModels<'a> = (
    NewDavEntity,
    Vec<NewDavComponent<'a>>,
    Vec<NewDavProperty<'a>>,
    Vec<NewDavParameter<'static>>,
);

/// ## Summary
/// Maps a vCard to database models.
///
/// Returns entity info and flat lists of components, properties, and parameters.
///
/// ## Errors
/// Returns an error if the mapping fails.
pub fn vcard_to_db_models(
    vcard: &VCard,
    entity_type: crate::db::enums::EntityType,
) -> anyhow::Result<DbModels<'_>> {
    let logical_uid = extract_vcard_uid(vcard);

    let entity = NewDavEntity {
        entity_type,
        logical_uid,
    };

    let mut components = Vec::new();
    let mut properties = Vec::new();
    let mut parameters = Vec::new();

    // Placeholder IDs - will be replaced after insert
    let entity_id = uuid::Uuid::nil();
    let component_id = uuid::Uuid::nil();

    // vCard has a single component (VCARD)
    components.push(NewDavComponent {
        entity_id,
        parent_component_id: None,
        name: "VCARD",
        ordinal: 0,
    });

    // Store VERSION explicitly (parser keeps it separate)
    properties.push(NewDavProperty {
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
        value_text_array: None,
        value_date_array: None,
        value_tstz_array: None,
        value_time: None,
        value_interval: None,
        value_tstzrange: None,
    });

    // Map all properties
    for (ordinal, prop) in vcard.properties.iter().enumerate() {
        map_vcard_property(
            prop,
            component_id,
            #[expect(
                clippy::cast_possible_truncation,
                clippy::cast_possible_wrap,
                reason = "vCard property counts are bounded by RFC limits (<500), truncation to i32 is safe"
            )]
            {
                (ordinal + 1) as i32
            },
            &mut properties,
            &mut parameters,
        );
    }

    Ok((entity, components, properties, parameters))
}

/// ## Summary
/// Maps a vCard property to a database property model.
fn map_vcard_property<'a>(
    prop: &'a VCardProperty,
    component_id: uuid::Uuid,
    ordinal: i32,
    properties: &mut Vec<NewDavProperty<'a>>,
    parameters: &mut Vec<NewDavParameter<'static>>,
) {
    let property_id = uuid::Uuid::nil(); // Placeholder

    let (value_type, value_text, value_int, value_float, value_bool, value_date, value_tstz) =
        extract_vcard_value(&prop.value, &prop.raw_value);

    properties.push(NewDavProperty {
        component_id,
        name: &prop.name,
        group: prop.group.as_deref(),
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
        value_text_array: None,
        value_date_array: None,
        value_tstz_array: None,
        value_time: None,
        value_interval: None,
        value_tstzrange: None,
    });

    // Map parameters
    for (param_ord, param) in prop.params.iter().enumerate() {
        map_vcard_parameter(
            param,
            property_id,
            #[expect(
                clippy::cast_possible_truncation,
                clippy::cast_possible_wrap,
                reason = "Parameter counts per vCard property are bounded by RFC limits (<50), truncation to i32 is safe"
            )]
            {
                param_ord as i32
            },
            parameters,
        );
    }
}

/// ## Summary
/// Maps a vCard parameter to a database parameter model.
fn map_vcard_parameter(
    param: &VCardParameter,
    property_id: uuid::Uuid,
    ordinal: i32,
    parameters: &mut Vec<NewDavParameter<'static>>,
) {
    // Leak all strings for 'static lifetime
    let name_static = Box::leak(param.name.clone().into_boxed_str()) as &'static str;
    let value_static = Box::leak(param.values.join(",").into_boxed_str()) as &'static str;

    parameters.push(NewDavParameter {
        property_id,
        name: name_static,
        value: value_static,
        ordinal,
    });
}
