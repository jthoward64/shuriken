//! DB <-> CalDAV mapping helpers.

use std::collections::HashMap;

use uuid::Uuid;

use crate::component::caldav::recurrence::ical_datetime_to_utc_with_resolver;
use crate::component::model::caldav::cal_index::NewCalIndex;
use crate::component::rfc::ical::core::{Component, ICalendar};
use crate::component::rfc::ical::expand::TimeZoneResolver;

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
#[allow(clippy::implicit_hasher)]
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
/// Extracts indexable properties (UID, DTSTART, DTEND, SUMMARY, LOCATION, ORGANIZER, etc.)
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

    let component_type = crate::component::db::enums::ComponentType::from(component_kind);
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

    // Extract ORGANIZER
    let organizer = component
        .get_property("ORGANIZER")
        .and_then(|prop| prop.as_text())
        .map(String::from);

    // Extract SUMMARY
    let summary = component.summary().map(String::from);

    // Extract LOCATION
    let location = component
        .get_property("LOCATION")
        .and_then(|prop| prop.as_text())
        .map(String::from);

    // Extract SEQUENCE
    let sequence = component
        .get_property("SEQUENCE")
        .and_then(|prop| prop.as_text())
        .and_then(|text| text.parse::<i32>().ok());

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
        organizer,
        summary,
        location,
        sequence,
    })
}
