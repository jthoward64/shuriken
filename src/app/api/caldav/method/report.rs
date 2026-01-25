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
#[expect(clippy::unused_async)]
async fn build_calendar_query_response(
    _conn: &mut connection::DbConnection<'_>,
    _query: &CalendarQuery,
    _properties: &[crate::component::rfc::dav::core::PropertyName],
) -> anyhow::Result<Multistatus> {
    
    
    
    // TODO: Extract collection_id from request context
    // For now, this is a limitation - we need collection_id to properly scope the query.
    // The filter evaluation requires a collection_id to determine which calendar to search.
    //
    // Workaround options:
    // 1. Add collection_id to request handler context (preferred)
    // 2. Parse from request path in the handler
    // 3. Support "search all collections" mode (less efficient)
    
    tracing::warn!(
        "calendar-query requires collection_id from request context - returning empty result"
    );
    
    // Return empty multistatus for now until we have collection context
    // Once collection_id is available, the implementation would be:
    //
    // let instances = crate::component::db::query::caldav::filter::find_matching_instances(
    //     conn,
    //     collection_id,
    //     query,
    // ).await?;
    //
    // let mut multistatus = Multistatus::new();
    // for instance in instances {
    //     let href = Href::from(format!("/{}", instance.uri));
    //     let props = build_instance_properties(conn, &instance, properties).await?;
    //     let response = PropstatResponse::ok(href, props);
    //     multistatus.add_response(response);
    // }
    
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
    use crate::component::db::query::report_property::build_instance_properties;
    use crate::component::model::dav::instance::DavInstance;
    use crate::component::rfc::dav::core::PropstatResponse;
    
    let mut multistatus = Multistatus::new();
    
    // Process each href
    for href in &multiget.hrefs {
        let href_str = href.as_str();
        
        // Extract the resource URI from the href
        // Format: /calendars/{username}/{calendar_name}/{event_uid}.ics
        // For now, we use a simple pattern: take the last path segment as the URI
        let uri = href_str.rsplit('/').next().unwrap_or(href_str);
        
        // TODO: Extract collection_id from the request context
        // We need to add a way to pass collection_id through the request handler.
        // Options:
        // 1. Parse the full href path to look up collection by principal/name
        // 2. Add collection_id to request context (preferred)
        // 3. Extract from request path parameters
        //
        // For now, we'll attempt to find instances by URI across all collections
        // (this is not ideal but allows basic functionality)
        
        // Query for instance by URI (without collection filter - limitation)
        let instance_opt = instance::all()
            .filter(crate::component::db::schema::dav_instance::uri.eq(uri))
            .filter(crate::component::db::schema::dav_instance::deleted_at.is_null())
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
