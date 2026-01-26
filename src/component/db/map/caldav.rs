//! DB <-> CalDAV mapping helpers.

use uuid::Uuid;

use crate::component::caldav::recurrence::ical_datetime_to_utc;
use crate::component::model::caldav::cal_index::NewCalIndex;
use crate::component::model::dav::component::DavComponent;
use crate::component::rfc::ical::core::Component;

/// ## Summary
/// Builds a `NewCalIndex` from a parsed iCalendar component and its database ID.
///
/// Extracts indexable properties (UID, DTSTART, DTEND, SUMMARY, LOCATION, ORGANIZER, etc.)
/// from the component for efficient calendar-query operations.
///
/// ## Errors
/// Returns `None` if the component lacks required properties or the component type is unsupported.
#[must_use]
pub fn build_cal_index(
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

    // Extract all-day flag
    let all_day = component
        .get_property("DTSTART")
        .and_then(|prop| {
            let value_type = prop.get_param_value("VALUE");
            Some(value_type == Some("DATE"))
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

/// ## Summary
/// Builds calendar index entries for all indexable components in an entity.
///
/// Walks through the component tree and builds index entries for VEVENT, VTODO, and VJOURNAL
/// components. Returns a vector of index entries ready for batch insertion.
#[must_use]
pub fn build_cal_indexes_for_entity(
    entity_id: Uuid,
    components: &[DavComponent],
    ical: &Component,
) -> Vec<NewCalIndex> {
    let mut indexes = Vec::new();

    // Walk through all components in the iCalendar tree
    build_indexes_recursive(entity_id, components, ical, &mut indexes);

    indexes
}

/// Recursively builds index entries for a component and its children.
fn build_indexes_recursive(
    entity_id: Uuid,
    db_components: &[DavComponent],
    ical_component: &Component,
    indexes: &mut Vec<NewCalIndex>,
) {
    // Find the database component ID for this iCalendar component
    // This is a simplified approach - in a full implementation, we'd need proper ID mapping
    if let Some(db_comp) = db_components.iter().find(|c| {
        c.name == ical_component.name
    }) {
        if let Some(index) = build_cal_index(entity_id, db_comp.id, ical_component) {
            indexes.push(index);
        }
    }

    // Recurse into children
    for child in &ical_component.children {
        build_indexes_recursive(entity_id, db_components, child, indexes);
    }
}
