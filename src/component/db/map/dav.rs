//! Database <-> canonical DAV mapping helpers.
//!
//! This module provides functions to convert between RFC-parsed types
//! (iCalendar/vCard) and database models (DavEntity, DavComponent, etc.).

use crate::component::model::dav::component::NewDavComponent;
use crate::component::model::dav::entity::NewDavEntity;
use crate::component::model::dav::parameter::NewDavParameter;
use crate::component::model::dav::property::NewDavProperty;
use crate::component::rfc::ical::core::{Component, ICalendar, Parameter, Property, Value};
use crate::component::rfc::vcard::core::{VCard, VCardParameter, VCardProperty, VCardValue};

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
    entity_type: &'a str,
) -> anyhow::Result<(
    NewDavEntity<'static>,
    Vec<NewDavComponent<'a>>,
    Vec<NewDavProperty<'a>>,
    Vec<NewDavParameter<'static>>,
)> {
    // Extract logical UID from top-level component - leak to get 'static lifetime
    let logical_uid_opt = extract_ical_uid(&ical.component)
        .map(|s| Box::leak(s.into_boxed_str()) as &'static str);

    let entity = NewDavEntity {
        entity_type,
        logical_uid: logical_uid_opt,
    };

    let mut components = Vec::new();
    let mut properties = Vec::new();
    let mut parameters = Vec::new();

    // Placeholder entity_id - will be replaced after insert
    let entity_id = uuid::Uuid::nil();

    map_ical_component_recursive(
        &ical.component,
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
/// Maps a vCard to database models.
///
/// Returns entity info and flat lists of components, properties, and parameters.
///
/// ## Errors
/// Returns an error if the mapping fails.
#[expect(clippy::needless_pass_by_value)]
pub fn vcard_to_db_models<'a>(
    vcard: &'a VCard,
    entity_type: &'a str,
) -> anyhow::Result<(
    NewDavEntity<'static>,
    Vec<NewDavComponent<'a>>,
    Vec<NewDavProperty<'a>>,
    Vec<NewDavParameter<'static>>,
)> {
    let logical_uid_opt = extract_vcard_uid(vcard)
        .map(|s| Box::leak(s.into_boxed_str()) as &'static str);

    let entity = NewDavEntity {
        entity_type,
        logical_uid: logical_uid_opt,
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

    // Map all properties
    for (ordinal, prop) in vcard.properties.iter().enumerate() {
        map_vcard_property(
            prop,
            component_id,
            ordinal as i32,
            &mut properties,
            &mut parameters,
        )?;
    }

    Ok((entity, components, properties, parameters))
}

/// ## Summary
/// Recursively maps an iCalendar component and its children to database models.
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
            prop_ord as i32,
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
            child_ord as i32,
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
        map_ical_parameter(param, property_id, param_ord as i32, parameters);
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

/// ## Summary
/// Maps a vCard property to a database property model.
fn map_vcard_property<'a>(
    prop: &'a VCardProperty,
    component_id: uuid::Uuid,
    ordinal: i32,
    properties: &mut Vec<NewDavProperty<'a>>,
    parameters: &mut Vec<NewDavParameter<'static>>,
) -> anyhow::Result<()> {
    let property_id = uuid::Uuid::nil(); // Placeholder

    let (value_type, value_text, value_int, value_float, value_bool, value_json) =
        extract_vcard_value(&prop.value, &prop.raw_value)?;

    properties.push(NewDavProperty {
        component_id,
        name: &prop.name,
        value_type,
        value_text,
        value_int,
        value_float,
        value_bool,
        value_date: None,
        value_tstz: None,
        value_bytes: None,
        value_json,
        ordinal,
    });

    // Map parameters
    for (param_ord, param) in prop.params.iter().enumerate() {
        map_vcard_parameter(param, property_id, param_ord as i32, parameters);
    }

    Ok(())
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

/// ## Summary
/// Extracts typed value fields from an iCalendar Value.
///
/// Returns a tuple of (value_type, value_text, value_int, value_float, value_bool, value_date, value_tstz).
#[expect(clippy::type_complexity)]
fn extract_ical_value<'a>(
    value: &Value,
    raw: &'a str,
) -> anyhow::Result<(
    &'static str,
    Option<&'a str>,
    Option<i64>,
    Option<f64>,
    Option<bool>,
    Option<chrono::NaiveDate>,
    Option<chrono::DateTime<chrono::Utc>>,
)> {
    match value {
        Value::Text(_) | Value::TextList(_) | Value::CalAddress(_) | Value::Uri(_) => {
            Ok(("text", Some(raw), None, None, None, None, None))
        }
        Value::Integer(i) => Ok(("integer", None, Some(i64::from(*i)), None, None, None, None)),
        Value::Float(f) => Ok(("float", None, None, Some(*f), None, None, None)),
        Value::Boolean(b) => Ok(("boolean", None, None, None, Some(*b), None, None)),
        Value::Date(d) => {
            let naive = chrono::NaiveDate::from_ymd_opt(
                i32::from(d.year),
                u32::from(d.month),
                u32::from(d.day),
            )
            .ok_or_else(|| anyhow::anyhow!("Invalid date"))?;
            Ok(("date", None, None, None, None, Some(naive), None))
        }
        Value::DateTime(dt) => {
            // Convert to UTC if possible
            let tstz = datetime_to_utc(dt)?;
            Ok(("datetime", None, None, None, None, None, Some(tstz)))
        }
        Value::Duration(_) | Value::Period(_) | Value::Recur(_) | Value::Time(_)
        | Value::UtcOffset(_) => {
            // Store complex types as text (raw value)
            Ok(("text", Some(raw), None, None, None, None, None))
        }
        Value::Binary(_) => Ok(("text", Some(raw), None, None, None, None, None)),
        Value::Unknown(_) => Ok(("text", Some(raw), None, None, None, None, None)),
    }
}

/// ## Summary
/// Extracts typed value fields from a vCard Value.
#[expect(clippy::type_complexity)]
fn extract_vcard_value<'a>(
    value: &VCardValue,
    raw: &'a str,
) -> anyhow::Result<(
    &'static str,
    Option<&'a str>,
    Option<i64>,
    Option<f64>,
    Option<bool>,
    Option<&'a serde_json::Value>,
)> {
    match value {
        VCardValue::Text(_)
        | VCardValue::TextList(_)
        | VCardValue::Uri(_)
        | VCardValue::LanguageTag(_) => Ok(("text", Some(raw), None, None, None, None)),
        VCardValue::Integer(i) => Ok(("integer", None, Some(*i), None, None, None)),
        VCardValue::Float(f) => Ok(("float", None, None, Some(*f), None, None)),
        VCardValue::Boolean(b) => Ok(("boolean", None, None, None, Some(*b), None)),
        VCardValue::DateAndOrTime(_)
        | VCardValue::Timestamp(_)
        | VCardValue::StructuredName(_)
        | VCardValue::Address(_)
        | VCardValue::Organization(_)
        | VCardValue::Gender(_)
        | VCardValue::ClientPidMap(_)
        | VCardValue::Related(_)
        | VCardValue::UtcOffset(_) => {
            // Store structured types as text (raw)
            Ok(("text", Some(raw), None, None, None, None))
        }
        VCardValue::Binary(_) => Ok(("text", Some(raw), None, None, None, None)),
        VCardValue::Unknown(_) => Ok(("text", Some(raw), None, None, None, None)),
    }
}

/// ## Summary
/// Converts an iCalendar DateTime to UTC.
fn datetime_to_utc(
    dt: &crate::component::rfc::ical::core::DateTime,
) -> anyhow::Result<chrono::DateTime<chrono::Utc>> {
    use crate::component::rfc::ical::core::DateTimeForm;

    let naive = chrono::NaiveDateTime::new(
        chrono::NaiveDate::from_ymd_opt(i32::from(dt.year), u32::from(dt.month), u32::from(dt.day))
            .ok_or_else(|| anyhow::anyhow!("Invalid date"))?,
        chrono::NaiveTime::from_hms_opt(u32::from(dt.hour), u32::from(dt.minute), u32::from(dt.second))
            .ok_or_else(|| anyhow::anyhow!("Invalid time"))?,
    );

    match &dt.form {
        DateTimeForm::Utc => {
            Ok(chrono::DateTime::from_naive_utc_and_offset(naive, chrono::Utc))
        }
        DateTimeForm::Floating | DateTimeForm::Zoned { .. } => {
            // Treat as UTC (without timezone info for now)
            // TODO: Handle TZID resolution in the future
            Ok(chrono::DateTime::from_naive_utc_and_offset(naive, chrono::Utc))
        }
    }
}

/// ## Summary
/// Extracts the UID property from an iCalendar component.
fn extract_ical_uid(component: &Component) -> Option<String> {
    component
        .properties
        .iter()
        .find(|p| p.name == "UID")
        .and_then(|p| p.value.as_text())
        .map(String::from)
}

/// ## Summary
/// Extracts the UID property from a vCard.
fn extract_vcard_uid(vcard: &VCard) -> Option<String> {
    vcard
        .get_property("UID")
        .and_then(|p| p.as_text())
        .map(String::from)
}

