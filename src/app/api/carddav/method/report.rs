//! `CardDAV` REPORT method handlers.

use salvo::http::StatusCode;
use salvo::{Request, Response, handler};

use crate::component::db::connection;
use crate::component::rfc::dav::build::multistatus::serialize_multistatus;
use crate::component::rfc::dav::core::{AddressbookMultiget, AddressbookQuery, Multistatus, ReportType};

/// ## Summary
/// Main REPORT method dispatcher for `CardDAV`.
///
/// Parses the REPORT request body and dispatches to the appropriate handler
/// based on the report type (`addressbook-query`, `addressbook-multiget`, etc.).
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
        ReportType::AddressbookQuery(query) => {
            handle_addressbook_query(req, res, query, req_data.properties).await;
        }
        ReportType::AddressbookMultiget(multiget) => {
            handle_addressbook_multiget(req, res, multiget, req_data.properties).await;
        }
        _ => {
            tracing::warn!("Unsupported REPORT type for CardDAV endpoint");
            res.status_code(StatusCode::NOT_IMPLEMENTED);
        }
    }
}

/// ## Summary
/// Handles `addressbook-query` REPORT requests.
///
/// Executes filter logic against vCard contacts and returns matching resources.
///
/// ## Side Effects
/// - Queries the database for matching vCard objects
/// - Returns 207 Multi-Status XML response
///
/// ## Errors
/// Returns 400 for invalid filters, 404 for missing addressbooks, 500 for server errors.
pub async fn handle_addressbook_query(
    req: &mut Request,
    res: &mut Response,
    query: AddressbookQuery,
    properties: Vec<crate::component::rfc::dav::core::PropertyName>,
) {
    // Extract collection_id from request path
    let collection_id = match crate::util::path::extract_collection_id(req.uri().path()) {
        Ok(id) => id,
        Err(e) => {
            tracing::error!("Failed to extract collection_id from path: {}", e);
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };

    let mut conn = match connection::connect().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::error!("Failed to get database connection: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    // Build response
    let multistatus = match build_addressbook_query_response(&mut conn, collection_id, &query, &properties).await {
        Ok(ms) => ms,
        Err(e) => {
            tracing::error!("Failed to build addressbook-query response: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    write_multistatus_response(res, &multistatus);
}

/// ## Summary
/// Handles `addressbook-multiget` REPORT requests.
///
/// Retrieves multiple vCard objects by href in a single request.
///
/// ## Side Effects
/// - Queries the database for specified resources
/// - Returns 207 Multi-Status XML response
///
/// ## Errors
/// Returns 400 for invalid hrefs, 500 for server errors.
pub async fn handle_addressbook_multiget(
    req: &mut Request,
    res: &mut Response,
    multiget: AddressbookMultiget,
    properties: Vec<crate::component::rfc::dav::core::PropertyName>,
) {
    // Extract collection_id from request path
    let collection_id = match crate::util::path::extract_collection_id(req.uri().path()) {
        Ok(id) => id,
        Err(e) => {
            tracing::error!("Failed to extract collection_id from path: {}", e);
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };

    let mut conn = match connection::connect().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::error!("Failed to get database connection: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    // Build response
    let multistatus = match build_addressbook_multiget_response(&mut conn, collection_id, &multiget, &properties).await {
        Ok(ms) => ms,
        Err(e) => {
            tracing::error!("Failed to build addressbook-multiget response: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    write_multistatus_response(res, &multistatus);
}

/// ## Summary
/// Builds a multistatus response for addressbook-query.
///
/// Applies filters to find matching vCard objects and constructs response.
///
/// ## Errors
/// Returns database errors or filter evaluation errors.
async fn build_addressbook_query_response(
    conn: &mut connection::DbConnection<'_>,
    collection_id: uuid::Uuid,
    query: &AddressbookQuery,
    properties: &[crate::component::rfc::dav::core::PropertyName],
) -> anyhow::Result<Multistatus> {
    use crate::component::db::query::carddav::filter::find_matching_instances;
    use crate::component::db::query::report_property::build_instance_properties;
    use crate::component::rfc::dav::core::{Href, PropstatResponse};
    
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
/// Builds a multistatus response for addressbook-multiget.
///
/// Retrieves specified vCard objects and constructs response.
///
/// ## Errors
/// Returns database errors if queries fail.
async fn build_addressbook_multiget_response(
    conn: &mut connection::DbConnection<'_>,
    collection_id: uuid::Uuid,
    multiget: &AddressbookMultiget,
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
