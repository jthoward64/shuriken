#![allow(clippy::unused_async)]
#![expect(dead_code, reason = "Test fixtures may have unused code")]
//! Test fixtures for DAV database tests.
//!
//! Provides helpers for creating test data: principals, collections, entities, and instances.

use uuid::Uuid;

use crate::model::dav::collection::NewDavCollection;
use crate::model::dav::component::NewDavComponent;
use crate::model::dav::entity::NewDavEntity;
use crate::model::dav::instance::NewDavInstance;
use crate::model::dav::parameter::NewDavParameter;
use crate::model::dav::property::NewDavProperty;
use crate::model::principal::NewPrincipal;
use crate::model::user::NewUser;

/// Creates a test principal for use in tests.
#[must_use]
pub fn test_principal<'a>(slug: &'a str, name: Option<&'a str>) -> NewPrincipal<'a> {
    NewPrincipal {
        id: Uuid::new_v4(),
        principal_type: crate::db::enums::PrincipalType::User,
        slug,
        display_name: name,
    }
}

/// Creates a test user linked to a principal.
#[must_use]
pub fn test_user<'a>(name: &'a str, email: &'a str, principal_id: Uuid) -> NewUser<'a> {
    NewUser {
        name,
        email,
        principal_id,
    }
}

/// Creates a test calendar collection.
#[must_use]
pub fn test_calendar_collection(slug: &str, owner_principal_id: Uuid) -> NewDavCollection<'_> {
    NewDavCollection {
        slug,
        owner_principal_id,
        collection_type: crate::db::enums::CollectionType::Calendar,
        display_name: Some("Test Calendar"),
        description: None,
        timezone_tzid: None,
    }
}

/// Creates a test addressbook collection.
#[must_use]
pub fn test_addressbook_collection(slug: &str, owner_principal_id: Uuid) -> NewDavCollection<'_> {
    NewDavCollection {
        slug,
        owner_principal_id,
        collection_type: crate::db::enums::CollectionType::Addressbook,
        display_name: Some("Test Addressbook"),
        description: None,
        timezone_tzid: None,
    }
}

/// Creates a minimal iCalendar entity (VEVENT).
#[must_use]
pub fn test_ical_entity(logical_uid: Option<String>) -> NewDavEntity {
    NewDavEntity {
        entity_type: crate::db::enums::EntityType::ICalendar,
        logical_uid,
    }
}

/// Creates a minimal vCard entity.
#[must_use]
pub fn test_vcard_entity(logical_uid: Option<String>) -> NewDavEntity {
    NewDavEntity {
        entity_type: crate::db::enums::EntityType::VCard,
        logical_uid,
    }
}

/// Creates a VCALENDAR root component for testing.
#[must_use]
pub fn test_vcalendar_component(entity_id: Uuid, ordinal: i32) -> NewDavComponent<'static> {
    NewDavComponent {
        entity_id,
        parent_component_id: None,
        name: "VCALENDAR",
        ordinal,
    }
}

/// Creates a VEVENT component for testing.
#[must_use]
pub fn test_vevent_component(
    entity_id: Uuid,
    parent_component_id: Option<Uuid>,
    ordinal: i32,
) -> NewDavComponent<'static> {
    NewDavComponent {
        entity_id,
        parent_component_id,
        name: "VEVENT",
        ordinal,
    }
}

/// Creates a VCARD component for testing.
#[must_use]
pub fn test_vcard_component(
    entity_id: Uuid,
    parent_component_id: Option<Uuid>,
    ordinal: i32,
) -> NewDavComponent<'static> {
    NewDavComponent {
        entity_id,
        parent_component_id,
        name: "VCARD",
        ordinal,
    }
}

/// Creates a test property.
#[must_use]
pub fn test_property<'a>(
    component_id: Uuid,
    name: &'a str,
    text_value: Option<&'a str>,
    ordinal: i32,
) -> NewDavProperty<'a> {
    NewDavProperty {
        component_id,
        name,
        group: None,
        value_type: crate::db::enums::ValueType::Text,
        ordinal,
        value_text: text_value,
        value_int: None,
        value_float: None,
        value_bool: None,
        value_date: None,
        value_tstz: None,
        value_bytes: None,
        value_json: None,
    }
}

/// Creates a test parameter.
#[must_use]
pub fn test_parameter<'a>(
    property_id: Uuid,
    name: &'a str,
    value: &'a str,
    ordinal: i32,
) -> NewDavParameter<'a> {
    NewDavParameter {
        property_id,
        name,
        value,
        ordinal,
    }
}

/// Creates a test DAV instance.
#[must_use]
pub fn test_instance<'a>(
    collection_id: Uuid,
    entity_id: Uuid,
    slug: &'a str,
    etag: &'a str,
) -> NewDavInstance<'a> {
    NewDavInstance {
        collection_id,
        entity_id,
        slug,
        content_type: crate::db::enums::ContentType::TextCalendar,
        etag,
        sync_revision: 1,
        last_modified: chrono::Utc::now(),
    }
}

/// Sample minimal iCalendar VEVENT (RFC 5545).
pub const SAMPLE_VEVENT: &str = "\
BEGIN:VCALENDAR\r\n\
VERSION:2.0\r\n\
PRODID:-//Test//Test//EN\r\n\
BEGIN:VEVENT\r\n\
UID:test-event-001@example.com\r\n\
DTSTAMP:20240101T120000Z\r\n\
DTSTART:20240115T140000Z\r\n\
DTEND:20240115T150000Z\r\n\
SUMMARY:Test Meeting\r\n\
END:VEVENT\r\n\
END:VCALENDAR\r\n";

/// Sample minimal vCard (RFC 6350).
pub const SAMPLE_VCARD: &str = "\
BEGIN:VCARD\r\n\
VERSION:4.0\r\n\
FN:Jane Doe\r\n\
N:Doe;Jane;;;\r\n\
EMAIL:jane@example.com\r\n\
UID:test-vcard-001@example.com\r\n\
END:VCARD\r\n";
