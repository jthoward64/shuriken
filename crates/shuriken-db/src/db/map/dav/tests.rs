//! Tests for DAV mapping module

use super::ical::icalendar_to_db_models;
use super::vcard::vcard_to_db_models;
use shuriken_rfc::rfc::ical::core::{
    Component, ComponentKind, ICalendar, Parameter, Property, Value,
};
use shuriken_rfc::rfc::vcard::core::{
    VCard, VCardParameter, VCardProperty, VCardValue, VCardVersion,
};

#[expect(clippy::too_many_lines)]
#[test]
fn test_icalendar_to_db_models_simple_event() {
    let ical = ICalendar {
        root: Component {
            kind: Some(ComponentKind::Calendar),
            name: "VCALENDAR".to_string(),
            properties: vec![
                Property {
                    name: "VERSION".to_string(),
                    params: vec![],
                    value: Value::Text("2.0".to_string()),
                    raw_value: "2.0".to_string(),
                },
                Property {
                    name: "PRODID".to_string(),
                    params: vec![],
                    value: Value::Text("-//Test//Test//EN".to_string()),
                    raw_value: "-//Test//Test//EN".to_string(),
                },
                Property {
                    name: "UID".to_string(),
                    params: vec![],
                    value: Value::Text("event-123".to_string()),
                    raw_value: "event-123".to_string(),
                },
            ],
            children: vec![Component {
                kind: Some(ComponentKind::Event),
                name: "VEVENT".to_string(),
                properties: vec![
                    Property {
                        name: "SUMMARY".to_string(),
                        params: vec![Parameter {
                            name: "LANGUAGE".to_string(),
                            values: vec!["en".to_string()],
                        }],
                        value: Value::Text("Test Event".to_string()),
                        raw_value: "Test Event".to_string(),
                    },
                    Property {
                        name: "DTSTART".to_string(),
                        params: vec![],
                        value: Value::Text("20260124T120000Z".to_string()),
                        raw_value: "20260124T120000Z".to_string(),
                    },
                ],
                children: vec![],
            }],
        },
    };

    let result = icalendar_to_db_models(&ical, crate::db::enums::EntityType::ICalendar);
    assert!(result.is_ok());

    let (entity, components, properties, parameters) = result.unwrap();

    // Check entity
    assert_eq!(
        entity.entity_type,
        crate::db::enums::EntityType::ICalendar
    );
    assert_eq!(entity.logical_uid, Some("event-123".to_string()));

    // Check components
    assert_eq!(components.len(), 2); // VCALENDAR + VEVENT
    assert_eq!(components[0].name, "VCALENDAR");
    assert_eq!(components[1].name, "VEVENT");

    // Check properties (3 from VCALENDAR + 2 from VEVENT)
    assert_eq!(properties.len(), 5);

    // Check parameters (1 from SUMMARY property)
    assert_eq!(parameters.len(), 1);
    assert_eq!(parameters[0].name, "LANGUAGE");
}

#[test]
fn test_icalendar_to_db_models_without_uid() {
    let ical = ICalendar {
        root: Component {
            kind: Some(ComponentKind::Calendar),
            name: "VCALENDAR".to_string(),
            properties: vec![],
            children: vec![Component {
                kind: Some(ComponentKind::Event),
                name: "VEVENT".to_string(),
                properties: vec![Property {
                    name: "SUMMARY".to_string(),
                    params: vec![],
                    value: Value::Text("No UID Event".to_string()),
                    raw_value: "No UID Event".to_string(),
                }],
                children: vec![],
            }],
        },
    };

    let result = icalendar_to_db_models(&ical, crate::db::enums::EntityType::ICalendar);
    assert!(result.is_ok());

    let (entity, _, _, _) = result.unwrap();
    assert_eq!(entity.logical_uid, None);
}

#[test]
fn test_icalendar_to_db_models_nested_components() {
    let ical = ICalendar {
        root: Component {
            kind: Some(ComponentKind::Calendar),
            name: "VCALENDAR".to_string(),
            properties: vec![Property {
                name: "UID".to_string(),
                params: vec![],
                value: Value::Text("event-with-alarm".to_string()),
                raw_value: "event-with-alarm".to_string(),
            }],
            children: vec![Component {
                kind: Some(ComponentKind::Event),
                name: "VEVENT".to_string(),
                properties: vec![],
                children: vec![Component {
                    kind: Some(ComponentKind::Alarm),
                    name: "VALARM".to_string(),
                    properties: vec![Property {
                        name: "ACTION".to_string(),
                        params: vec![],
                        value: Value::Text("DISPLAY".to_string()),
                        raw_value: "DISPLAY".to_string(),
                    }],
                    children: vec![],
                }],
            }],
        },
    };

    let result = icalendar_to_db_models(&ical, crate::db::enums::EntityType::ICalendar);
    assert!(result.is_ok());

    let (_, components, properties, _) = result.unwrap();

    // Should have VCALENDAR, VEVENT, and VALARM
    assert_eq!(components.len(), 3);
    assert_eq!(components[0].name, "VCALENDAR");
    assert_eq!(components[1].name, "VEVENT");
    assert_eq!(components[2].name, "VALARM");

    // Check ordinals (relative to parent)
    // VCALENDAR is root (ordinal 0)
    // VEVENT is first child of VCALENDAR (ordinal 0)
    // VALARM is first child of VEVENT (ordinal 0)
    assert_eq!(components[0].ordinal, 0);
    assert_eq!(components[1].ordinal, 0);
    assert_eq!(components[2].ordinal, 0);

    // Should have 1 property from VCALENDAR + 1 from VALARM
    assert_eq!(properties.len(), 2);
}

#[test]
fn test_vcard_to_db_models_simple() {
    let vcard = VCard {
        version: VCardVersion::V4,
        properties: vec![
            VCardProperty {
                group: None,
                name: "FN".to_string(),
                params: vec![],
                value: VCardValue::Text("John Doe".to_string()),
                raw_value: "John Doe".to_string(),
            },
            VCardProperty {
                group: None,
                name: "EMAIL".to_string(),
                params: vec![VCardParameter {
                    name: "TYPE".to_string(),
                    values: vec!["work".to_string()],
                }],
                value: VCardValue::Text("john@example.com".to_string()),
                raw_value: "john@example.com".to_string(),
            },
            VCardProperty {
                group: None,
                name: "UID".to_string(),
                params: vec![],
                value: VCardValue::Text("vcard-123".to_string()),
                raw_value: "vcard-123".to_string(),
            },
        ],
    };

    let result = vcard_to_db_models(&vcard, crate::db::enums::EntityType::VCard);
    assert!(result.is_ok());

    let (entity, components, properties, parameters) = result.unwrap();

    // Check entity
    assert_eq!(
        entity.entity_type,
        crate::db::enums::EntityType::VCard
    );
    assert_eq!(entity.logical_uid, Some("vcard-123".to_string()));

    // Check components (should be 1 root vCard component)
    assert_eq!(components.len(), 1);
    assert_eq!(components[0].name, "VCARD");

    // Check properties (VERSION + 3 from vCard)
    assert_eq!(properties.len(), 4);

    // Check parameters (1 from EMAIL property)
    assert_eq!(parameters.len(), 1);
    assert_eq!(parameters[0].name, "TYPE");
}

#[test]
fn test_vcard_to_db_models_without_uid() {
    let vcard = VCard {
        version: VCardVersion::V3,
        properties: vec![VCardProperty {
            group: None,
            name: "FN".to_string(),
            params: vec![],
            value: VCardValue::Text("Jane Smith".to_string()),
            raw_value: "Jane Smith".to_string(),
        }],
    };

    let result = vcard_to_db_models(&vcard, crate::db::enums::EntityType::VCard);
    assert!(result.is_ok());

    let (entity, _, _, _) = result.unwrap();
    assert_eq!(entity.logical_uid, None);
}

#[test]
fn test_vcard_to_db_models_with_multiple_parameters() {
    let vcard = VCard {
        version: VCardVersion::V4,
        properties: vec![VCardProperty {
            group: None,
            name: "TEL".to_string(),
            params: vec![
                VCardParameter {
                    name: "TYPE".to_string(),
                    values: vec!["cell".to_string()],
                },
                VCardParameter {
                    name: "PREF".to_string(),
                    values: vec!["1".to_string()],
                },
            ],
            value: VCardValue::Text("+1-555-1234".to_string()),
            raw_value: "+1-555-1234".to_string(),
        }],
    };

    let result = vcard_to_db_models(&vcard, crate::db::enums::EntityType::VCard);
    assert!(result.is_ok());

    let (_, _, _, parameters) = result.unwrap();

    // Should have 2 parameters
    assert_eq!(parameters.len(), 2);
    assert_eq!(parameters[0].name, "TYPE");
    assert_eq!(parameters[1].name, "PREF");
}
