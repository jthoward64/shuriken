//! Property builder for REPORT responses.
//!
//! Constructs DAV properties for calendar and addressbook resources
//! in response to REPORT requests (multiget, query).

use crate::db::connection::DbConnection;
use crate::db::map::dav::{serialize_ical_tree, serialize_vcard_tree};
use crate::db::query::dav::entity;
use crate::model::dav::instance::DavInstance;
use shuriken_rfc::rfc::dav::core::{DavProperty, PropertyName, QName};
use shuriken_rfc::rfc::filter::{filter_address_data, filter_calendar_data};

/// ## Summary
/// Builds properties for a DAV instance based on requested property names.
///
/// Supports:
/// - `getetag` - Returns the instance's `ETag`
/// - `calendar-data` - Returns iCalendar data reconstructed from component tree (with optional partial retrieval)
/// - `address-data` - Returns vCard data reconstructed from component tree (with optional partial retrieval)
///
/// ## Errors
/// Returns database errors if queries fail.
pub async fn build_instance_properties(
    conn: &mut DbConnection<'_>,
    instance: &DavInstance,
    property_names: &[PropertyName],
) -> anyhow::Result<Vec<DavProperty>> {
    let mut properties = Vec::new();

    for prop_name in property_names {
        let qname = prop_name.qname();

        // Handle getetag
        if qname.namespace_uri() == "DAV:" && qname.local_name() == "getetag" {
            properties.push(DavProperty::text(
                QName::dav("getetag"),
                format!("\"{}\"", instance.etag),
            ));
            continue;
        }

        // Handle calendar-data with partial retrieval
        if qname.namespace_uri() == "urn:ietf:params:xml:ns:caldav"
            && qname.local_name() == "calendar-data"
        {
            if let Some(data) = load_calendar_data(conn, instance, prop_name).await? {
                properties.push(DavProperty::xml(
                    QName::new("urn:ietf:params:xml:ns:caldav", "calendar-data"),
                    data,
                ));
            }
            continue;
        }

        // Handle address-data with partial retrieval
        if qname.namespace_uri() == "urn:ietf:params:xml:ns:carddav"
            && qname.local_name() == "address-data"
        {
            if let Some(data) = load_address_data(conn, instance, prop_name).await? {
                properties.push(DavProperty::xml(
                    QName::new("urn:ietf:params:xml:ns:carddav", "address-data"),
                    data,
                ));
            }
            continue;
        }

        // Unknown property - return as not found
        properties.push(DavProperty::not_found(qname));
    }

    Ok(properties)
}

/// ## Summary
/// Loads calendar data (iCalendar) from the component tree for an instance.
///
/// Applies partial retrieval filtering if specified in the property name.
///
/// ## Errors
/// Returns database errors if the query fails.
async fn load_calendar_data(
    conn: &mut DbConnection<'_>,
    instance: &DavInstance,
    prop_name: &PropertyName,
) -> anyhow::Result<Option<String>> {
    let tree = entity::get_entity_with_tree(conn, instance.entity_id)
        .await?
        .map(|(_, tree)| tree);

    let Some(tree) = tree else {
        return Ok(None);
    };

    let data = serialize_ical_tree(tree)?;

    if let Some(request) = prop_name.calendar_data_request() {
        let filtered = filter_calendar_data(&data, request)?;
        Ok(Some(filtered))
    } else {
        Ok(Some(data))
    }
}

/// ## Summary
/// Loads address data (vCard) from the component tree for an instance.
///
/// Applies partial retrieval filtering if specified in the property name.
///
/// ## Errors
/// Returns database errors if the query fails.
async fn load_address_data(
    conn: &mut DbConnection<'_>,
    instance: &DavInstance,
    prop_name: &PropertyName,
) -> anyhow::Result<Option<String>> {
    let tree = entity::get_entity_with_tree(conn, instance.entity_id)
        .await?
        .map(|(_, tree)| tree);

    let Some(tree) = tree else {
        return Ok(None);
    };

    let data = serialize_vcard_tree(&tree)?;

    if let Some(request) = prop_name.address_data_request() {
        let filtered = filter_address_data(&data, request)?;
        Ok(Some(filtered))
    } else {
        Ok(Some(data))
    }
}
