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
    _req: &mut Request,
    res: &mut Response,
    query: AddressbookQuery,
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
    let multistatus = match build_addressbook_query_response(&mut conn, &query, &properties).await {
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
    _req: &mut Request,
    res: &mut Response,
    multiget: AddressbookMultiget,
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
    let multistatus = match build_addressbook_multiget_response(&mut conn, &multiget, &properties).await {
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
    _conn: &mut connection::DbConnection<'_>,
    _query: &AddressbookQuery,
    _properties: &[crate::component::rfc::dav::core::PropertyName],
) -> anyhow::Result<Multistatus> {
    // TODO: Implement filter evaluation
    // 1. Parse collection path from request
    // 2. Query instances matching filter criteria
    // 3. Evaluate property filters (FN, EMAIL, etc.)
    // 4. Apply test mode (anyof/allof)
    // 5. Apply limit if specified
    // 6. Build response with requested properties
    
    Ok(Multistatus::new())
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
    multiget: &AddressbookMultiget,
    properties: &[crate::component::rfc::dav::core::PropertyName],
) -> anyhow::Result<Multistatus> {
    use crate::component::rfc::dav::core::PropstatResponse;
    
    let mut multistatus = Multistatus::new();
    
    // Process each href
    for href in &multiget.hrefs {
        // For now, return 404 for all resources since we don't have proper href parsing yet
        // TODO: Implement proper href parsing and vCard retrieval
        // 1. Parse href to extract collection_id and resource URI
        // 2. Query the instance from database
        // 3. Build properties based on what was requested
        // 4. Return appropriate propstat (200 for found, 404 for not found)
        
        let response = PropstatResponse::not_found(href.clone());
        multistatus.add_response(response);
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
