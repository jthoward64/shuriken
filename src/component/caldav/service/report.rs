//! CalDAV REPORT service layer.
#![expect(clippy::doc_markdown, reason = "CalDAV is a proper term, not a code identifier")]

//! Business logic for calendar-query and calendar-multiget reports.

use crate::component::caldav::expand::{expand_recurrence_set, should_expand_instance};
use crate::component::db::connection::DbConnection;
use crate::component::db::query::caldav::filter::find_matching_instances;
use crate::component::db::query::dav::instance;
use crate::component::db::query::report_property::build_instance_properties;
use crate::component::model::dav::instance::DavInstance;
use crate::component::rfc::dav::core::{CalendarMultiget, CalendarQuery, Href, Multistatus, PropstatResponse, PropertyName};
use crate::component::rfc::ical::expand::TimezoneDatabase;
use crate::component::rfc::ical::parse::parse;
use diesel::prelude::*;
use diesel_async::RunQueryDsl;

/// ## Summary
/// Executes a calendar-query report.
///
/// Applies filters to find matching calendar objects and builds a multistatus response.
/// Handles expand and limit-recurrence-set options if specified in the query.
///
/// ## Side Effects
/// Queries the database for matching instances.
///
/// ## Errors
/// Returns database errors or filter evaluation errors.
pub async fn execute_calendar_query(
    conn: &mut DbConnection<'_>,
    collection_id: uuid::Uuid,
    query: &CalendarQuery,
    properties: &[PropertyName],
) -> anyhow::Result<Multistatus> {
    // Find instances matching the filter
    let instances = find_matching_instances(conn, collection_id, query).await?;
    
    // Build multistatus response
    let mut multistatus = Multistatus::new();
    
    // Initialize timezone database for expansion
    let tz_db = TimezoneDatabase::new();
    
    for instance in instances {
        // Check if we need to expand this instance
        if let (Some(expand_range), None) = (&query.expand, &query.limit_recurrence) {
            // Attempt to expand the instance
            if let Ok(expanded) = try_expand_instance(conn, &instance, expand_range, &tz_db).await {
                // Add a response for each expanded occurrence
                for (idx, expanded_component) in expanded.iter().enumerate() {
                    // Create unique href for each occurrence (append index or recurrence-id)
                    let href = if idx == 0 {
                        Href::new(format!("/{}", instance.uri))
                    } else {
                        // For subsequent occurrences, append instance identifier
                        Href::new(format!("/{}?instance={}", instance.uri, idx))
                    };
                    
                    let props = build_expanded_properties(expanded_component, properties);
                    let response = PropstatResponse::ok(href, props);
                    multistatus.add_response(response);
                }
                continue;
            }
        }
        
        // No expansion or expansion failed - return as regular instance
        let href = Href::new(format!("/{}", instance.uri));
        let props = build_instance_properties(conn, &instance, properties).await?;
        let response = PropstatResponse::ok(href, props);
        multistatus.add_response(response);
    }
    
    Ok(multistatus)
}

/// ## Summary
/// Attempts to expand a recurring calendar instance.
///
/// Loads the calendar data, parses it, and expands any RRULE into individual instances.
///
/// ## Errors
/// Returns an error if the calendar data cannot be loaded, parsed, or expanded.
async fn try_expand_instance(
    conn: &mut DbConnection<'_>,
    instance: &DavInstance,
    expand_range: &crate::component::rfc::dav::core::TimeRange,
    tz_db: &TimezoneDatabase,
) -> anyhow::Result<Vec<crate::component::rfc::ical::core::Component>> {
    // Load calendar data from shadow table
    let calendar_data = load_instance_calendar_data(conn, instance).await?;
    
    // Parse the iCalendar data
    let ical = parse(&calendar_data)?;
    
    // Find the first event component (VEVENT)
    let events = ical.events();
    let event = events
        .get(0)
        .ok_or_else(|| anyhow::anyhow!("No VEVENT found in calendar data"))?;
    
    // Check if it has RRULE
    let has_rrule = event.properties.iter().any(|p| p.name == "RRULE");
    
    if !should_expand_instance(has_rrule, Some(expand_range), None) {
        return Err(anyhow::anyhow!("Instance does not need expansion"));
    }
    
    // Expand the recurrence set
    expand_recurrence_set(event, expand_range, tz_db)
}

/// ## Summary
/// Loads calendar data for an instance from the shadow table.
///
/// ## Errors
/// Returns an error if the data cannot be loaded.
async fn load_instance_calendar_data(
    conn: &mut DbConnection<'_>,
    instance: &DavInstance,
) -> anyhow::Result<String> {
    use crate::component::db::schema::dav_shadow;
    
    let canonical_bytes: Vec<u8> = dav_shadow::table
        .filter(dav_shadow::entity_id.eq(instance.entity_id))
        .filter(dav_shadow::direction.eq("outbound"))
        .filter(dav_shadow::deleted_at.is_null())
        .select(dav_shadow::raw_canonical)
        .order(dav_shadow::updated_at.desc())
        .first::<Option<Vec<u8>>>(conn)
        .await
        .optional()?
        .flatten()
        .ok_or_else(|| anyhow::anyhow!("No calendar data found for instance"))?;
    
    Ok(String::from_utf8_lossy(&canonical_bytes).into_owned())
}

/// ## Summary
/// Builds properties for an expanded component.
fn build_expanded_properties(
    component: &crate::component::rfc::ical::core::Component,
    property_names: &[PropertyName],
) -> Vec<crate::component::rfc::dav::core::DavProperty> {
    use crate::component::rfc::dav::core::{DavProperty, QName};
    use crate::component::rfc::ical::build::serialize;
    
    let mut properties = Vec::new();
    
    for prop_name in property_names {
        let qname = prop_name.qname();
        
        // Handle calendar-data
        if qname.namespace_uri() == "urn:ietf:params:xml:ns:caldav"
            && qname.local_name() == "calendar-data"
        {
            // Serialize the expanded component back to iCalendar format
            // Wrap in VCALENDAR
            let mut ical = crate::component::rfc::ical::core::ICalendar::new("-//Shuriken//EN");
            ical.add_event(component.clone());
            let data = serialize(&ical);
            
            properties.push(DavProperty::xml(
                QName::new("urn:ietf:params:xml:ns:caldav", "calendar-data"),
                data,
            ));
        }
        // TODO: Handle other properties like getetag
    }
    
    properties
}

/// ## Summary
/// Executes a calendar-multiget report.
///
/// Retrieves specified calendar objects by href and builds a multistatus response.
///
/// ## Side Effects
/// Queries the database for each requested resource.
///
/// ## Errors
/// Returns database errors if queries fail.
pub async fn execute_calendar_multiget(
    conn: &mut DbConnection<'_>,
    collection_id: uuid::Uuid,
    multiget: &CalendarMultiget,
    properties: &[PropertyName],
) -> anyhow::Result<Multistatus> {
    let mut multistatus = Multistatus::new();
    
    // Process each href
    for href in &multiget.hrefs {
        let href_str = href.as_str();
        
        // Extract the resource URI from the href
        let Ok(uri) = crate::util::path::extract_resource_uri(href_str) else {
            // Invalid href format, return 404
            let response = PropstatResponse::not_found(href.clone());
            multistatus.add_response(response);
            continue;
        };
        
        // Query for instance by collection and URI
        let instance_opt = instance::by_collection_and_uri(collection_id, &uri)
            .select(DavInstance::as_select())
            .first::<DavInstance>(conn)
            .await
            .optional()?;
        
        if let Some(inst) = instance_opt {
            // Build requested properties for this instance
            let props = build_instance_properties(conn, &inst, properties).await?;
            let response = PropstatResponse::ok(href.clone(), props);
            multistatus.add_response(response);
        } else {
            // Resource not found
            let response = PropstatResponse::not_found(href.clone());
            multistatus.add_response(response);
        }
    }
    
    Ok(multistatus)
}
