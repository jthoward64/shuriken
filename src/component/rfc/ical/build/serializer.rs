//! iCalendar serializer (RFC 5545).
//!
//! Serializes iCalendar structures to compliant text format.

use super::escape::{escape_param_value, escape_text};
use super::fold::fold_line;
use crate::component::rfc::ical::core::{
    Component, ComponentKind, ICalendar, Parameter, Property, Value,
};

/// Serializes an iCalendar document to a string.
#[must_use]
pub fn serialize(ical: &ICalendar) -> String {
    serialize_component(&ical.root)
}

/// Serializes a component to a string.
#[must_use]
pub fn serialize_component(component: &Component) -> String {
    let mut result = String::new();

    // BEGIN line
    result.push_str(&fold_line(&format!("BEGIN:{}", component.name)));

    // Serialize properties in canonical order
    let ordered_props = canonical_property_order(&component.properties, component.kind);
    for prop in ordered_props {
        result.push_str(&serialize_property(prop));
    }

    // Serialize child components in canonical order
    let ordered_children = canonical_component_order(&component.children);
    for child in ordered_children {
        result.push_str(&serialize_component(child));
    }

    // END line
    result.push_str(&fold_line(&format!("END:{}", component.name)));

    result
}

/// Serializes a property to a string.
#[must_use]
pub fn serialize_property(prop: &Property) -> String {
    let mut line = prop.name.clone();

    // Serialize parameters in canonical order
    let ordered_params = canonical_param_order(&prop.params);
    for param in ordered_params {
        line.push(';');
        line.push_str(&serialize_parameter(param));
    }

    line.push(':');

    // Use raw_value for round-trip fidelity, or serialize the parsed value
    line.push_str(&serialize_value(&prop.value, &prop.raw_value, &prop.name));

    fold_line(&line)
}

/// Serializes a parameter to a string.
#[must_use]
pub fn serialize_parameter(param: &Parameter) -> String {
    let mut result = param.name.clone();
    result.push('=');

    let values: Vec<String> = param.values.iter().map(|v| escape_param_value(v)).collect();
    result.push_str(&values.join(","));

    result
}

/// Serializes a value, preferring the raw value for round-trip fidelity.
fn serialize_value(value: &Value, raw_value: &str, _prop_name: &str) -> String {
    // For text properties, we need to escape the value
    // For other properties, use the raw value for fidelity
    match value {
        Value::Text(s) => escape_text(s),
        Value::TextList(list) => list
            .iter()
            .map(|s| escape_text(s))
            .collect::<Vec<_>>()
            .join(","),
        _ => raw_value.to_string(),
    }
}

/// Returns properties in canonical order for deterministic output.
#[expect(clippy::too_many_lines)]
fn canonical_property_order(props: &[Property], kind: Option<ComponentKind>) -> Vec<&Property> {
    let order: &[&str] = match kind {
        Some(ComponentKind::Calendar) => &[
            "VERSION",
            "PRODID",
            "CALSCALE",
            "METHOD",
            "NAME",
            "DESCRIPTION",
            "COLOR",
            "SOURCE",
            "REFRESH-INTERVAL",
        ],
        Some(ComponentKind::Event | ComponentKind::Todo | ComponentKind::Journal) => &[
            "UID",
            "DTSTAMP",
            "DTSTART",
            "DTEND",
            "DUE",
            "DURATION",
            "RRULE",
            "RDATE",
            "EXDATE",
            "RECURRENCE-ID",
            "SUMMARY",
            "DESCRIPTION",
            "LOCATION",
            "GEO",
            "CLASS",
            "STATUS",
            "PRIORITY",
            "TRANSP",
            "ORGANIZER",
            "ATTENDEE",
            "CATEGORIES",
            "COMMENT",
            "CONTACT",
            "RELATED-TO",
            "URL",
            "ATTACH",
            "CREATED",
            "LAST-MODIFIED",
            "SEQUENCE",
            "COLOR",
            "CONFERENCE",
            "IMAGE",
        ],
        Some(ComponentKind::Timezone) => &["TZID", "LAST-MODIFIED", "TZURL"],
        Some(ComponentKind::Standard | ComponentKind::Daylight) => &[
            "DTSTART",
            "TZOFFSETFROM",
            "TZOFFSETTO",
            "RRULE",
            "RDATE",
            "TZNAME",
            "COMMENT",
        ],
        Some(ComponentKind::Alarm) => &[
            "ACTION",
            "TRIGGER",
            "DESCRIPTION",
            "SUMMARY",
            "DURATION",
            "REPEAT",
            "ATTACH",
            "ATTENDEE",
        ],
        Some(ComponentKind::FreeBusy) => &[
            "UID",
            "DTSTAMP",
            "DTSTART",
            "DTEND",
            "ORGANIZER",
            "ATTENDEE",
            "FREEBUSY",
            "URL",
            "COMMENT",
        ],
        _ => &[],
    };

    let mut ordered: Vec<&Property> = Vec::with_capacity(props.len());

    // First, add properties in defined order
    for &name in order {
        for prop in props {
            if prop.name.eq_ignore_ascii_case(name) {
                ordered.push(prop);
            }
        }
    }

    // Then add remaining properties (including X-properties) in original order
    for prop in props {
        if !order.iter().any(|&n| prop.name.eq_ignore_ascii_case(n)) {
            ordered.push(prop);
        }
    }

    ordered
}

/// Returns parameters in canonical order.
fn canonical_param_order(params: &[Parameter]) -> Vec<&Parameter> {
    let order = [
        "VALUE",
        "TZID",
        "ENCODING",
        "FMTTYPE",
        "LANGUAGE",
        "ALTREP",
        "CN",
        "DIR",
        "CUTYPE",
        "ROLE",
        "PARTSTAT",
        "RSVP",
        "DELEGATED-FROM",
        "DELEGATED-TO",
        "SENT-BY",
        "MEMBER",
        "RELATED",
        "RELTYPE",
        "FBTYPE",
        "RANGE",
    ];

    let mut ordered: Vec<&Parameter> = Vec::with_capacity(params.len());

    for name in &order {
        for param in params {
            if param.name.eq_ignore_ascii_case(name) {
                ordered.push(param);
            }
        }
    }

    // Add remaining parameters
    for param in params {
        if !order.iter().any(|n| param.name.eq_ignore_ascii_case(n)) {
            ordered.push(param);
        }
    }

    ordered
}

/// Returns child components in canonical order.
fn canonical_component_order(children: &[Component]) -> Vec<&Component> {
    let mut timezones: Vec<&Component> = Vec::new();
    let mut events: Vec<&Component> = Vec::new();
    let mut todos: Vec<&Component> = Vec::new();
    let mut journals: Vec<&Component> = Vec::new();
    let mut freebusy: Vec<&Component> = Vec::new();
    let mut standard: Vec<&Component> = Vec::new();
    let mut daylight: Vec<&Component> = Vec::new();
    let mut alarms: Vec<&Component> = Vec::new();
    let mut other: Vec<&Component> = Vec::new();

    for child in children {
        match child.kind {
            Some(ComponentKind::Timezone) => timezones.push(child),
            Some(ComponentKind::Event) => events.push(child),
            Some(ComponentKind::Todo) => todos.push(child),
            Some(ComponentKind::Journal) => journals.push(child),
            Some(ComponentKind::FreeBusy) => freebusy.push(child),
            Some(ComponentKind::Standard) => standard.push(child),
            Some(ComponentKind::Daylight) => daylight.push(child),
            Some(ComponentKind::Alarm) => alarms.push(child),
            _ => other.push(child),
        }
    }

    // Sort events, todos, journals by UID then RECURRENCE-ID
    events.sort_by(|a, b| cmp_by_uid_recurrence(a, b));
    todos.sort_by(|a, b| cmp_by_uid_recurrence(a, b));
    journals.sort_by(|a, b| cmp_by_uid_recurrence(a, b));

    let mut result = Vec::with_capacity(children.len());
    result.extend(timezones);
    result.extend(events);
    result.extend(todos);
    result.extend(journals);
    result.extend(freebusy);
    result.extend(standard);
    result.extend(daylight);
    result.extend(alarms);
    result.extend(other);
    result
}

/// Compares components by UID, then by RECURRENCE-ID.
fn cmp_by_uid_recurrence(a: &Component, b: &Component) -> std::cmp::Ordering {
    let uid_a = a.uid().unwrap_or("");
    let uid_b = b.uid().unwrap_or("");

    match uid_a.cmp(uid_b) {
        std::cmp::Ordering::Equal => {
            let recur_a = a
                .get_property("RECURRENCE-ID")
                .map_or("", |p| p.raw_value.as_str());
            let recur_b = b
                .get_property("RECURRENCE-ID")
                .map_or("", |p| p.raw_value.as_str());
            recur_a.cmp(recur_b)
        }
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::component::rfc::ical::parse;

    #[test]
    fn serialize_simple_vevent() {
        let ical = ICalendar::new("-//Test//Test//EN");
        let mut event = Component::event();
        event.add_property(Property::text("UID", "test-uid-123"));
        event.add_property(Property::text("SUMMARY", "Test Event"));

        let mut ical = ical;
        ical.add_event(event);

        let output = serialize(&ical);

        assert!(output.starts_with("BEGIN:VCALENDAR\r\n"));
        assert!(output.ends_with("END:VCALENDAR\r\n"));
        assert!(output.contains("VERSION:2.0\r\n"));
        assert!(output.contains("UID:test-uid-123\r\n"));
        assert!(output.contains("SUMMARY:Test Event\r\n"));
    }

    #[test]
    fn serialize_escapes_text() {
        let mut event = Component::event();
        event.add_property(Property::text("SUMMARY", "Meeting, important"));
        event.add_property(Property::text("DESCRIPTION", "Line 1\nLine 2"));

        let output = serialize_component(&event);

        assert!(output.contains("SUMMARY:Meeting\\, important\r\n"));
        assert!(output.contains("DESCRIPTION:Line 1\\nLine 2\r\n"));
    }

    #[test]
    fn serialize_folds_long_lines() {
        let mut event = Component::event();
        let long_summary = "A".repeat(100);
        event.add_property(Property::text("SUMMARY", &long_summary));

        let output = serialize_component(&event);

        // Should contain a fold
        assert!(output.contains("\r\n "));

        // Unfold and verify
        let unfolded = output.replace("\r\n ", "");
        assert!(unfolded.contains(&format!("SUMMARY:{long_summary}\r\n")));
    }

    #[test]
    fn roundtrip_simple() {
        let input = "\
BEGIN:VCALENDAR\r\n\
VERSION:2.0\r\n\
PRODID:-//Test//Test//EN\r\n\
BEGIN:VEVENT\r\n\
UID:roundtrip@example.com\r\n\
DTSTAMP:20260123T120000Z\r\n\
DTSTART:20260123T140000Z\r\n\
SUMMARY:Roundtrip Test\r\n\
END:VEVENT\r\n\
END:VCALENDAR\r\n";

        let parsed = parse::parse(input).unwrap();
        let output = serialize(&parsed);

        // Parse again and compare
        let reparsed = parse::parse(&output).unwrap();

        assert_eq!(parsed.version(), reparsed.version());
        assert_eq!(parsed.prodid(), reparsed.prodid());
        assert_eq!(parsed.events().len(), reparsed.events().len());

        let event1 = &parsed.events()[0];
        let event2 = &reparsed.events()[0];
        assert_eq!(event1.uid(), event2.uid());
        assert_eq!(event1.summary(), event2.summary());
    }

    #[test]
    fn canonical_order_preserved() {
        // Properties should be output in canonical order
        let mut event = Component::event();
        event.add_property(Property::text("SUMMARY", "Summary"));
        event.add_property(Property::text("UID", "uid"));
        event.add_property(Property::text("DESCRIPTION", "Desc"));

        let output = serialize_component(&event);

        // UID should come before SUMMARY
        let uid_pos = output.find("UID:").unwrap();
        let summary_pos = output.find("SUMMARY:").unwrap();
        assert!(uid_pos < summary_pos);
    }
}
