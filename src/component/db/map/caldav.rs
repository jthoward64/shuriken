//! DB <-> CalDAV mapping helpers.

use uuid::Uuid;

use crate::component::caldav::recurrence::ical_datetime_to_utc;
use crate::component::model::caldav::cal_index::NewCalIndex;
use crate::component::rfc::ical::core::{Component, ICalendar};

/// ## Summary
/// Builds calendar index entries for all indexable components in an `iCalendar` document.
///
/// Walks through the component tree and builds index entries for `VEVENT`, `VTODO`, and `VJOURNAL`
/// components. Returns a vector of index entries ready for batch insertion.
///
/// Note: Uses a placeholder UUID for `component_id` since we don't have access to the database
/// component IDs yet. This will be improved in a future iteration.
#[must_use]
pub fn build_cal_indexes(
    entity_id: Uuid,
    ical: &ICalendar,
) -> Vec<NewCalIndex> {
    let mut indexes = Vec::new();
    build_indexes_recursive(entity_id, &ical.root, &mut indexes);
    indexes
}

/// Recursively builds index entries for a component and its children.
fn build_indexes_recursive(
    entity_id: Uuid,
    component: &Component,
    indexes: &mut Vec<NewCalIndex>,
) {
    // Build index for this component if it's schedulable
    if let Some(component_kind) = component.kind
        && component_kind.is_schedulable()
    {
        // Use a deterministic component ID based on the UID and component type
        // If UID is missing, use the entity ID to ensure uniqueness
        let uid = component.uid().unwrap_or("no-uid");
        let component_id = uuid::Uuid::new_v5(
            &entity_id,
            format!("{}-{}-{}", component.name, uid, entity_id).as_bytes(),
        );

        if let Some(index) = build_cal_index(entity_id, component_id, component) {
            indexes.push(index);
        }
    }

    // Recurse into children
    for child in &component.children {
        build_indexes_recursive(entity_id, child, indexes);
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
) -> Option<NewCalIndex> {
    let component_kind = component.kind?;
    
    // Only index schedulable components (VEVENT, VTODO, VJOURNAL)
    if !component_kind.is_schedulable() {
        return None;
    }

    let component_type = component_kind.as_str().to_string();
    let uid = component.uid().map(String::from);

    // Extract DTSTART
    let dtstart_utc = component
        .get_property("DTSTART")
        .and_then(|prop| {
            let tzid = prop.get_param_value("TZID");
            let dt = prop.as_datetime()?;
            ical_datetime_to_utc(dt, tzid)
        });

    // Extract DTEND
    let dtend_utc = component
        .get_property("DTEND")
        .and_then(|prop| {
            let tzid = prop.get_param_value("TZID");
            let dt = prop.as_datetime()?;
            ical_datetime_to_utc(dt, tzid)
        });

    // Extract all-day flag (only if VALUE=DATE is explicitly set)
    let all_day = component
        .get_property("DTSTART")
        .and_then(|prop| {
            prop.get_param_value("VALUE")
                .map(|value_type| value_type == "DATE")
        });

    // Extract RRULE
    let rrule_text = component
        .get_property("RRULE")
        .and_then(|prop| prop.as_text())
        .map(String::from);

    // Extract RECURRENCE-ID
    let recurrence_id_utc = component
        .get_property("RECURRENCE-ID")
        .and_then(|prop| {
            let tzid = prop.get_param_value("TZID");
            let dt = prop.as_datetime()?;
            ical_datetime_to_utc(dt, tzid)
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
