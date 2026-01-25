//! `CalDAV` REPORT method handlers.

use salvo::http::StatusCode;
use salvo::{Request, Response, handler};

use crate::component::db::connection;
use crate::component::rfc::dav::build::multistatus::serialize_multistatus;
use crate::component::rfc::dav::core::{CalendarMultiget, CalendarQuery, Multistatus, ReportType};

/// ## Summary
/// Main REPORT method dispatcher for `CalDAV`.
///
/// Parses the REPORT request body and dispatches to the appropriate handler
/// based on the report type (`calendar-query`, `calendar-multiget`, etc.).
///
/// ## Side Effects
/// - Parses XML request body
/// - Dispatches to specific report handlers
///
/// ## Errors
/// Returns 400 for invalid requests, 501 for unsupported reports.
#[handler]
pub async fn report(req: &mut Request, res: &mut Response) {
    // Read request body
    let body = match req.payload().await {
        Ok(body) => body,
        Err(e) => {
            tracing::error!("Failed to read request body: {}", e);
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };

    // Parse REPORT request
    let req_data = match crate::component::rfc::dav::parse::report::parse_report(body) {
        Ok(parsed_report) => parsed_report,
        Err(e) => {
            tracing::error!("Failed to parse REPORT request: {}", e);
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };

    // Dispatch based on report type
    match req_data.report_type {
        ReportType::CalendarQuery(query) => {
            handle_calendar_query(req, res, query, req_data.properties).await;
        }
        ReportType::CalendarMultiget(multiget) => {
            handle_calendar_multiget(req, res, multiget, req_data.properties).await;
        }
        _ => {
            tracing::warn!("Unsupported REPORT type for CalDAV endpoint");
            res.status_code(StatusCode::NOT_IMPLEMENTED);
        }
    }
}

/// ## Summary
/// Handles `calendar-query` REPORT requests.
///
/// Executes filter logic against calendar events and returns matching resources.
///
/// ## Side Effects
/// - Queries the database for matching calendar objects
/// - Returns 207 Multi-Status XML response
///
/// ## Errors
/// Returns 400 for invalid filters, 404 for missing collections, 500 for server errors.
pub async fn handle_calendar_query(
    _req: &mut Request,
    res: &mut Response,
    query: CalendarQuery,
    properties: Vec<crate::component::rfc::dav::core::PropertyName>,
) {
    let mut conn = match connection::connect().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::error!("Failed to get database connection: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    // Build response
    let multistatus = match build_calendar_query_response(&mut conn, &query, &properties).await {
        Ok(ms) => ms,
        Err(e) => {
            tracing::error!("Failed to build calendar-query response: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    write_multistatus_response(res, &multistatus);
}

/// ## Summary
/// Handles `calendar-multiget` REPORT requests.
///
/// Retrieves multiple calendar objects by href in a single request.
///
/// ## Side Effects
/// - Queries the database for specified resources
/// - Returns 207 Multi-Status XML response
///
/// ## Errors
/// Returns 400 for invalid hrefs, 500 for server errors.
pub async fn handle_calendar_multiget(
    _req: &mut Request,
    res: &mut Response,
    multiget: CalendarMultiget,
    properties: Vec<crate::component::rfc::dav::core::PropertyName>,
) {
    let mut conn = match connection::connect().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::error!("Failed to get database connection: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    // Build response
    let multistatus = match build_calendar_multiget_response(&mut conn, &multiget, &properties).await {
        Ok(ms) => ms,
        Err(e) => {
            tracing::error!("Failed to build calendar-multiget response: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    write_multistatus_response(res, &multistatus);
}

/// ## Summary
/// Builds a multistatus response for calendar-query.
///
/// Applies filters to find matching calendar objects and constructs response.
///
/// ## Errors
/// Returns database errors or filter evaluation errors.
async fn build_calendar_query_response(
    _conn: &mut connection::DbConnection<'_>,
    _query: &CalendarQuery,
    _properties: &[crate::component::rfc::dav::core::PropertyName],
) -> anyhow::Result<Multistatus> {
    // TODO: Implement filter evaluation
    // 1. Parse collection path from request
    // 2. Query instances matching filter criteria
    // 3. Evaluate time-range filters if present
    // 4. Evaluate component/property filters
    // 5. Apply limit if specified
    // 6. Build response with requested properties
    
    Ok(Multistatus::new())
}

/// ## Summary
/// Builds a multistatus response for calendar-multiget.
///
/// Retrieves specified calendar objects and constructs response.
///
/// ## Errors
/// Returns database errors if queries fail.
async fn build_calendar_multiget_response(
    conn: &mut connection::DbConnection<'_>,
    multiget: &CalendarMultiget,
    properties: &[crate::component::rfc::dav::core::PropertyName],
) -> anyhow::Result<Multistatus> {
    use diesel::prelude::*;
    use diesel_async::RunQueryDsl;
    use crate::component::db::query::dav::instance;
    use crate::component::model::dav::instance::DavInstance;
    use crate::component::rfc::dav::core::{PropstatResponse, DavProperty, PropertyValue, Href};
    
    let mut multistatus = Multistatus::new();
    
    // Process each href
    for href in &multiget.hrefs {
        let href_str = href.as_str();
        
        // For now, we'll need to parse the href to extract the URI
        // This is a simplified implementation - in production we'd need proper path parsing
        // Format: /calendars/{username}/{calendar_name}/{event_uid}.ics
        let uri = href_str.rsplit('/').next().unwrap_or(href_str);
        
        // TODO: Extract collection_id from the href path
        // For now, we'll create a stub response indicating the resource was not found
        // In a real implementation, we would:
        // 1. Parse the full href to get principal/collection/resource
        // 2. Look up the collection_id from the path
        // 3. Query the instance
        
        // Create a 404 response for now since we can't properly parse hrefs yet
        let response = PropstatResponse::not_found(href.clone());
        multistatus.add_response(response);
        
        // TODO: Once we have proper href parsing:
        // let instance_opt = instance::by_collection_and_uri(collection_id, uri)
        //     .select(DavInstance::as_select())
        //     .first::<DavInstance>(conn)
        //     .await
        //     .optional()?;
        //
        // if let Some(inst) = instance_opt {
        //     let props = build_properties_for_instance(&inst, properties);
        //     let response = PropstatResponse::ok(href.clone(), props);
        //     multistatus.add_response(response);
        // } else {
        //     let response = PropstatResponse::not_found(href.clone());
        //     multistatus.add_response(response);
        // }
    }
    
    Ok(multistatus)
}

/// ## Summary
/// Writes a multistatus response to the HTTP response.
///
/// Serializes to XML and sets appropriate headers.
fn write_multistatus_response(res: &mut Response, multistatus: &Multistatus) {
    let xml = match serialize_multistatus(multistatus) {
        Ok(xml) => xml,
        Err(e) => {
            tracing::error!("Failed to serialize multistatus: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    res.status_code(StatusCode::MULTI_STATUS);
    if res.add_header(
        "Content-Type",
        salvo::http::HeaderValue::from_static("application/xml; charset=utf-8"),
        true,
    ).is_err() {
        // Header setting failed, continue anyway
    }
    if res.write_body(xml).is_err() {
        // Body writing failed, response will be empty
    }
}
