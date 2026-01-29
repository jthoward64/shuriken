//! Database component tree -> canonical RFC serialization.

use std::collections::HashMap;

use anyhow::{Context, Result};
use base64::{Engine as _, engine::general_purpose::STANDARD};

use crate::model::dav::component::DavComponent;
use crate::model::dav::parameter::DavParameter;
use crate::model::dav::property::DavProperty;
use shuriken_rfc::rfc::ical::build as ical_build;
use shuriken_rfc::rfc::ical::core::{
    Component, ComponentKind, ContentLine, ICalendar, Parameter, Property,
};
use shuriken_rfc::rfc::vcard::build as vcard_build;
use shuriken_rfc::rfc::vcard::core::{
    VCard, VCardParameter, VCardProperty, VCardValue, VCardVersion,
};

/// Component tree returned by `get_entity_with_tree` (component, properties, parameters).
pub type EntityComponentTree = Vec<(DavComponent, Vec<(DavProperty, Vec<DavParameter>)>)>;

#[derive(Debug)]
struct IcalNode {
    component: DavComponent,
    properties: Vec<Property>,
    children: Vec<uuid::Uuid>,
}

/// ## Summary
/// Builds an `ICalendar` model from a DAV component tree.
///
/// ## Errors
/// Returns an error if the tree is empty or lacks a root `VCALENDAR` component.
#[must_use]
#[expect(
    clippy::double_must_use,
    reason = "Result is already #[must_use], but we want explicit intent"
)]
pub fn ical_from_tree(tree: EntityComponentTree) -> Result<ICalendar> {
    let mut nodes = build_ical_nodes(tree);

    let root_id =
        select_root_component(&nodes, "VCALENDAR").context("missing VCALENDAR root component")?;

    let root = build_ical_component(root_id, &mut nodes)?;
    Ok(ICalendar { root })
}

/// ## Summary
/// Serializes an iCalendar string from a DAV component tree.
///
/// ## Errors
/// Returns an error if the tree cannot be reconstructed.
#[must_use]
#[expect(
    clippy::double_must_use,
    reason = "Result is already #[must_use], but we want explicit intent"
)]
pub fn serialize_ical_tree(tree: EntityComponentTree) -> Result<String> {
    let ical = ical_from_tree(tree)?;
    Ok(ical_build::serialize(&ical))
}

/// ## Summary
/// Builds a `VCard` model from a DAV component tree.
///
/// ## Errors
/// Returns an error if the tree is empty or lacks a root `VCARD` component.
#[must_use]
#[expect(
    clippy::double_must_use,
    reason = "Result is already #[must_use], but we want explicit intent"
)]
pub fn vcard_from_tree(tree: &EntityComponentTree) -> Result<VCard> {
    let root = tree
        .iter()
        .find(|(component, _)| component.parent_component_id.is_none())
        .map(|(component, props)| (component, props))
        .context("missing VCARD root component")?;

    if !root.0.name.eq_ignore_ascii_case("VCARD") {
        anyhow::bail!("expected VCARD root component, found {}", root.0.name);
    }

    let mut properties = Vec::new();
    let mut version = VCardVersion::V4;

    for (prop, params) in root.1 {
        if prop.name.eq_ignore_ascii_case("VERSION") {
            let raw = property_raw_value(prop, ValueFormat::Vcard);
            if let Some(parsed) = VCardVersion::from_str(&raw) {
                version = parsed;
            }
            continue;
        }

        properties.push(build_vcard_property(prop, params));
    }

    Ok(VCard {
        version,
        properties,
    })
}

/// ## Summary
/// Serializes a vCard string from a DAV component tree.
///
/// ## Errors
/// Returns an error if the tree cannot be reconstructed.
#[must_use]
#[expect(
    clippy::double_must_use,
    reason = "Result is already #[must_use], but we want explicit intent"
)]
pub fn serialize_vcard_tree(tree: &EntityComponentTree) -> Result<String> {
    let vcard = vcard_from_tree(tree)?;
    Ok(vcard_build::serialize_single(&vcard))
}

fn build_ical_nodes(tree: EntityComponentTree) -> HashMap<uuid::Uuid, IcalNode> {
    let mut nodes = HashMap::new();
    let mut parent_links = Vec::new();

    for (component, props) in tree {
        let properties = props
            .into_iter()
            .map(|(prop, params)| build_ical_property(prop, params))
            .collect::<Vec<_>>();

        let id = component.id;
        if let Some(parent_id) = component.parent_component_id {
            parent_links.push((parent_id, id));
        }

        nodes.insert(
            id,
            IcalNode {
                component,
                properties,
                children: Vec::new(),
            },
        );
    }

    for (parent_id, child_id) in parent_links {
        if let Some(parent) = nodes.get_mut(&parent_id) {
            parent.children.push(child_id);
        }
    }

    let ids: Vec<uuid::Uuid> = nodes.keys().copied().collect();
    for id in ids {
        let Some(node) = nodes.get(&id) else {
            continue;
        };
        let mut sorted_children = node.children.clone();
        sorted_children.sort_by_key(|child_id| {
            nodes
                .get(child_id)
                .map(|child| child.component.ordinal)
                .unwrap_or_default()
        });

        if let Some(node_mut) = nodes.get_mut(&id) {
            node_mut.children = sorted_children;
        }
    }

    nodes
}

fn build_ical_component(
    id: uuid::Uuid,
    nodes: &mut HashMap<uuid::Uuid, IcalNode>,
) -> Result<Component> {
    let node = nodes
        .remove(&id)
        .with_context(|| format!("missing component {id}"))?;

    let mut component = Component::custom(node.component.name);
    component.kind = Some(ComponentKind::parse(&component.name));
    component.properties = node.properties;

    for child_id in node.children {
        component
            .children
            .push(build_ical_component(child_id, nodes)?);
    }

    Ok(component)
}

fn build_ical_property(prop: DavProperty, params: Vec<DavParameter>) -> Property {
    let raw_value = property_raw_value(&prop, ValueFormat::Ical);
    let params = params.into_iter().map(build_ical_parameter).collect();
    let line = ContentLine::with_params(prop.name, params, raw_value);
    Property::from_content_line(line)
}

fn build_ical_parameter(param: DavParameter) -> Parameter {
    Parameter::with_values(param.name, split_param_values(&param.value))
}

fn build_vcard_property(prop: &DavProperty, params: &[DavParameter]) -> VCardProperty {
    let raw_value = property_raw_value(prop, ValueFormat::Vcard);
    let params = params
        .iter()
        .cloned()
        .map(build_vcard_parameter)
        .collect::<Vec<_>>();

    VCardProperty {
        group: prop.group.clone(),
        name: prop.name.clone(),
        params,
        value: VCardValue::Unknown(raw_value.clone()),
        raw_value,
    }
}

fn build_vcard_parameter(param: DavParameter) -> VCardParameter {
    VCardParameter::multi(param.name, split_param_values(&param.value))
}

#[derive(Debug, Clone, Copy)]
enum ValueFormat {
    Ical,
    Vcard,
}

fn property_raw_value(prop: &DavProperty, format: ValueFormat) -> String {
    if let Some(text) = &prop.value_text {
        return text.clone();
    }

    if let Some(bytes) = &prop.value_bytes {
        return STANDARD.encode(bytes);
    }

    if let Some(json) = &prop.value_json {
        return json.to_string();
    }

    if let Some(value) = prop.value_int {
        return value.to_string();
    }

    if let Some(value) = prop.value_float {
        return value.to_string();
    }

    if let Some(value) = prop.value_bool {
        return match format {
            ValueFormat::Ical => if value { "TRUE" } else { "FALSE" }.to_string(),
            ValueFormat::Vcard => if value { "true" } else { "false" }.to_string(),
        };
    }

    if let Some(value) = prop.value_date {
        return value.format("%Y%m%d").to_string();
    }

    if let Some(value) = prop.value_tstz {
        return value.format("%Y%m%dT%H%M%SZ").to_string();
    }

    String::new()
}

fn split_param_values(value: &str) -> Vec<String> {
    if value.is_empty() {
        return vec![String::new()];
    }

    value
        .split(',')
        .map(std::string::ToString::to_string)
        .collect()
}

fn select_root_component(
    nodes: &HashMap<uuid::Uuid, IcalNode>,
    expected_name: &str,
) -> Option<uuid::Uuid> {
    let mut roots: Vec<_> = nodes
        .values()
        .filter(|node| node.component.parent_component_id.is_none())
        .collect();

    roots.sort_by_key(|node| node.component.ordinal);

    roots
        .iter()
        .find(|node| node.component.name.eq_ignore_ascii_case(expected_name))
        .map(|node| node.component.id)
        .or_else(|| roots.first().map(|node| node.component.id))
}
