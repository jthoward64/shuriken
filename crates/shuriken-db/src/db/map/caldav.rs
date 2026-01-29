//! DB <-> CalDAV mapping helpers.

use std::collections::HashMap;

use uuid::Uuid;

use shuriken_rfc::recurrence::ical_datetime_to_utc_with_resolver;
use crate::model::caldav::cal_index::NewCalIndex;
use shuriken_rfc::rfc::ical::core::{Component, ICalendar};
use shuriken_rfc::rfc::ical::expand::TimeZoneResolver;

/// ## Summary
/// Builds calendar index entries for all indexable components in an `iCalendar` document.
///
/// Walks through the component tree and builds index entries for `VEVENT`, `VTODO`, and `VJOURNAL`
/// components. Uses the `component_map` returned from tree insertion to look up real database
/// component IDs. Returns a vector of index entries ready for batch insertion.
///
/// ## Parameters
/// - `component_map`: `HashMap` from tree insertion mapping `(component_name, uid)` to `component_id`
#[must_use]
#[expect(clippy::implicit_hasher)]
pub fn build_cal_indexes(
    entity_id: Uuid,
    ical: &ICalendar,
    component_map: &HashMap<(String, Option<String>), Uuid>,
    resolver: &mut TimeZoneResolver,
) -> Vec<NewCalIndex> {
    let mut indexes = Vec::new();
    build_indexes_recursive(entity_id, &ical.root, component_map, resolver, &mut indexes);
    indexes
}

/// Recursively builds index entries for a component and its children.
fn build_indexes_recursive(
    entity_id: Uuid,
    component: &Component,
    component_map: &HashMap<(String, Option<String>), Uuid>,
    resolver: &mut TimeZoneResolver,
    indexes: &mut Vec<NewCalIndex>,
) {
    // Build index for this component if it's schedulable
    if let Some(component_kind) = component.kind
        && component_kind.is_schedulable()
    {
        // Look up the real component ID from the database mapping
        let uid = component.uid().map(String::from);
        let key = (component.name.clone(), uid.clone());

        if let Some(&component_id) = component_map.get(&key) {
            if let Some(index) = build_cal_index(entity_id, component_id, component, resolver) {
                indexes.push(index);
            }
        } else {
            tracing::warn!(
                "Component {:?} with UID {:?} not found in component map, skipping index",
                component.name,
                uid
            );
        }
    }

    // Recurse into children
    for child in &component.children {
        build_indexes_recursive(entity_id, child, component_map, resolver, indexes);
    }
}

/// ## Summary
/// Builds a `NewCalIndex` from a parsed iCalendar component.
///
/// Extracts indexable properties (UID, DTSTART, DTEND) and metadata (SUMMARY, LOCATION, ORGANIZER, etc.)
/// from the component for efficient calendar-query operations.
///
/// ## Errors
/// Returns `None` if the component lacks required properties or the component type is unsupported.
#[must_use]
#[expect(clippy::too_many_lines)]
fn build_cal_index(
    entity_id: Uuid,
    component_id: Uuid,
    component: &Component,
    resolver: &mut TimeZoneResolver,
) -> Option<NewCalIndex> {
    let component_kind = component.kind?;

    // Only index schedulable components (VEVENT, VTODO, VJOURNAL)
    if !component_kind.is_schedulable() {
        return None;
    }

    let component_type = crate::db::enums::ComponentType::from(component_kind);
    let uid = component.uid().map(String::from);

    // Extract DTSTART
    let dtstart_utc = component.get_property("DTSTART").and_then(|prop| {
        let tzid = prop.get_param_value("TZID");
        let dt = prop.as_datetime()?;
        ical_datetime_to_utc_with_resolver(dt, tzid, resolver)
    });

    // Extract DTEND
    let dtend_utc = component.get_property("DTEND").and_then(|prop| {
        let tzid = prop.get_param_value("TZID");
        let dt = prop.as_datetime()?;
        ical_datetime_to_utc_with_resolver(dt, tzid, resolver)
    });

    // Extract all-day flag (only if VALUE=DATE is explicitly set)
    let all_day = component.get_property("DTSTART").and_then(|prop| {
        prop.get_param_value("VALUE")
            .map(|value_type| value_type == "DATE")
    });

    // Extract RRULE
    let rrule_text = component
        .get_property("RRULE")
        .and_then(|prop| prop.as_text())
        .map(String::from);

    // Extract RECURRENCE-ID
    let recurrence_id_utc = component.get_property("RECURRENCE-ID").and_then(|prop| {
        let tzid = prop.get_param_value("TZID");
        let dt = prop.as_datetime()?;
        ical_datetime_to_utc_with_resolver(dt, tzid, resolver)
    });

    // Build metadata JSONB object with all non-indexed fields
    let mut metadata = serde_json::json!({});

    // Extract SUMMARY
    if let Some(summary) = component.summary() {
        metadata["summary"] = serde_json::Value::String(summary.to_string());
    }

    // Extract LOCATION
    if let Some(location) = component.get_property("LOCATION").and_then(|p| p.as_text()) {
        metadata["location"] = serde_json::Value::String(location.to_string());
    }

    // Extract DESCRIPTION
    if let Some(description) = component
        .get_property("DESCRIPTION")
        .and_then(|p| p.as_text())
    {
        metadata["description"] = serde_json::Value::String(description.to_string());
    }

    // Extract ORGANIZER
    if let Some(organizer) = component
        .get_property("ORGANIZER")
        .and_then(|p| p.as_text())
    {
        metadata["organizer"] = serde_json::Value::String(organizer.to_string());
        // Extract CN parameter if present
        if let Some(cn) = component
            .get_property("ORGANIZER")
            .and_then(|p| p.get_param_value("CN"))
        {
            metadata["organizer_cn"] = serde_json::Value::String(cn.to_string());
        }
    }

    // Extract SEQUENCE
    if let Some(sequence) = component
        .get_property("SEQUENCE")
        .and_then(|p| p.as_text())
        .and_then(|s| s.parse::<i32>().ok())
    {
        metadata["sequence"] = serde_json::Value::Number(sequence.into());
    }

    // Extract TRANSP
    if let Some(transp) = component.get_property("TRANSP").and_then(|p| p.as_text()) {
        metadata["transp"] = serde_json::Value::String(transp.to_string());
    }

    // Extract STATUS
    if let Some(status) = component.get_property("STATUS").and_then(|p| p.as_text()) {
        metadata["status"] = serde_json::Value::String(status.to_string());
    }

    // Extract ATTENDEEs as array
    let attendees: Vec<serde_json::Value> = component
        .get_properties("ATTENDEE")
        .iter()
        .filter_map(|att| {
            att.as_text().map(|email| {
                let mut attendee = serde_json::json!({"email": email});
                if let Some(cn) = att.get_param_value("CN") {
                    attendee["cn"] = serde_json::Value::String(cn.to_string());
                }
                if let Some(partstat) = att.get_param_value("PARTSTAT") {
                    attendee["partstat"] = serde_json::Value::String(partstat.to_string());
                }
                if let Some(role) = att.get_param_value("ROLE") {
                    attendee["role"] = serde_json::Value::String(role.to_string());
                }
                attendee
            })
        })
        .collect();

    if !attendees.is_empty() {
        metadata["attendees"] = serde_json::Value::Array(attendees);
    }

    Some(NewCalIndex {
        entity_id,
        component_id,
        component_type,
        uid,
        recurrence_id_utc,
        dtstart_utc,
        dtend_utc,
        all_day,
        rrule_text,
        metadata: Some(metadata),
    })
}
