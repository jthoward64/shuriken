//! PROPFIND method handler for `WebDAV` resources.

mod helpers;

use salvo::http::StatusCode;
use salvo::{Request, Response, handler};

use crate::app::api::dav::extract::headers::{Depth, parse_depth};
use crate::component::db::connection;
use crate::component::rfc::dav::build::multistatus::serialize_multistatus;
use crate::component::rfc::dav::parse::propfind::parse_propfind;

use helpers::build_propfind_response;

/// ## Summary
/// Handles PROPFIND requests for `WebDAV` resources.
///
/// Parses the request body to determine which properties to return,
/// queries the database for resources at the specified depth,
/// and builds a multistatus response.
///
/// ## Side Effects
/// - Parses request body XML
/// - Queries the database
/// - Returns 207 Multi-Status XML response
///
/// ## Errors
/// Returns 400 for malformed requests, 404 for missing resources, 500 for server errors.
#[handler]
pub async fn propfind(req: &mut Request, res: &mut Response) {
    // Parse Depth header (default to 0 for PROPFIND)
    let depth = parse_depth(req).unwrap_or_else(Depth::default_for_propfind);
    
    // Parse request body
    let body = match req.payload().await {
        Ok(bytes) => bytes.to_vec(),
        Err(e) => {
            tracing::error!("Failed to read request body: {}", e);
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };
    
    // Parse PROPFIND request (empty body = allprop)
    let propfind_req = match parse_propfind(&body) {
        Ok(req) => req,
        Err(e) => {
            tracing::error!("Failed to parse PROPFIND request: {}", e);
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };
    
    // Get database connection
    let mut conn = match connection::connect().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::error!("Failed to get database connection: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };
    
    // Build multistatus response
    let multistatus = match build_propfind_response(&mut conn, req, depth, &propfind_req).await {
        Ok(ms) => ms,
        Err(e) => {
            tracing::error!("Failed to build PROPFIND response: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };
    
    // Serialize to XML
    let xml = match serialize_multistatus(&multistatus) {
        Ok(xml) => xml,
        Err(e) => {
            tracing::error!("Failed to serialize multistatus: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };
    
    // Set response
    res.status_code(StatusCode::MULTI_STATUS);
    res.add_header(
        "Content-Type",
        salvo::http::HeaderValue::from_static("application/xml; charset=utf-8"),
        true,
    );
    res.write_body(xml);
}
