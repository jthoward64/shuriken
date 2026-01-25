//! CalDAV REPORT service layer.

//! Business logic for calendar-query and calendar-multiget reports.

use crate::component::db::connection::DbConnection;
use crate::component::db::query::caldav::filter::find_matching_instances;
use crate::component::db::query::dav::instance;
use crate::component::db::query::report_property::build_instance_properties;
use crate::component::model::dav::instance::DavInstance;
use crate::component::rfc::dav::core::{CalendarMultiget, CalendarQuery, Href, Multistatus, PropstatResponse, PropertyName};
use diesel::prelude::*;
use diesel_async::RunQueryDsl;

/// ## Summary
/// Executes a calendar-query report.
///
/// Applies filters to find matching calendar objects and builds a multistatus response.
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
    for instance in instances {
        let href = Href::new(format!("/{}", instance.uri));
        let props = build_instance_properties(conn, &instance, properties).await?;
        let response = PropstatResponse::ok(href, props);
        multistatus.add_response(response);
    }
    
    Ok(multistatus)
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
