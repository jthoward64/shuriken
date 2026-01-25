//! Property builder for REPORT responses.
//!
//! Constructs DAV properties for calendar and addressbook resources
//! in response to REPORT requests (multiget, query).

use crate::component::db::connection::DbConnection;
use crate::component::db::schema::dav_shadow;
use crate::component::model::dav::instance::DavInstance;
use crate::component::rfc::dav::core::{DavProperty, PropertyName, QName};
use crate::component::rfc::filter::{filter_address_data, filter_calendar_data};
use diesel::prelude::*;
use diesel_async::RunQueryDsl;

/// ## Summary
/// Builds properties for a DAV instance based on requested property names.
///
/// Supports:
/// - `getetag` - Returns the instance's `ETag`
/// - `calendar-data` - Returns iCalendar data from shadow table (with optional partial retrieval)
/// - `address-data` - Returns vCard data from shadow table (with optional partial retrieval)
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
/// Loads calendar data (iCalendar) from the shadow table for an instance.
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
    // Query the shadow table for canonical bytes
    let canonical_bytes: Option<Vec<u8>> = dav_shadow::table
        .filter(dav_shadow::entity_id.eq(instance.entity_id))
        .filter(dav_shadow::direction.eq("outbound"))
        .filter(dav_shadow::deleted_at.is_null())
        .select(dav_shadow::raw_canonical)
        .order(dav_shadow::updated_at.desc())
        .first::<Option<Vec<u8>>>(conn)
        .await
        .optional()?
        .flatten();

    if let Some(bytes) = canonical_bytes {
        // Convert bytes to string
        let data = String::from_utf8_lossy(&bytes).into_owned();
        
        // Apply partial retrieval filtering if specified
        if let Some(request) = prop_name.calendar_data_request() {
            let filtered = filter_calendar_data(&data, request)?;
            Ok(Some(filtered))
        } else {
            Ok(Some(data))
        }
    } else {
        Ok(None)
    }
}

/// ## Summary
/// Loads address data (vCard) from the shadow table for an instance.
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
    // Query the shadow table for canonical bytes
    let canonical_bytes: Option<Vec<u8>> = dav_shadow::table
        .filter(dav_shadow::entity_id.eq(instance.entity_id))
        .filter(dav_shadow::direction.eq("outbound"))
        .filter(dav_shadow::deleted_at.is_null())
        .select(dav_shadow::raw_canonical)
        .order(dav_shadow::updated_at.desc())
        .first::<Option<Vec<u8>>>(conn)
        .await
        .optional()?
        .flatten();

    if let Some(bytes) = canonical_bytes {
        // Convert bytes to string
        let data = String::from_utf8_lossy(&bytes).into_owned();
        
        // Apply partial retrieval filtering if specified
        if let Some(request) = prop_name.address_data_request() {
            let filtered = filter_address_data(&data, request)?;
            Ok(Some(filtered))
        } else {
            Ok(Some(data))
        }
    } else {
        Ok(None)
    }
}
