//! PROPFIND method handler for `WebDAV` resources.

mod helpers;

use salvo::http::StatusCode;
use salvo::{Depot, Request, Response, handler};

use crate::app::api::dav::extract::headers::{Depth, parse_depth};
use crate::component::db::connection;
use crate::component::rfc::dav::build::multistatus::serialize_multistatus;
use crate::component::rfc::dav::parse::propfind::parse_propfind;
use crate::util::path;

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
#[tracing::instrument(skip(req, res), fields(
    method = "PROPFIND",
    path = %req.uri().path()
))]
pub async fn propfind(req: &mut Request, res: &mut Response, depot: &Depot) {
    tracing::info!("Handling PROPFIND request");

    // Parse Depth header (default to 0 for PROPFIND)
    let depth = parse_depth(req).unwrap_or_else(Depth::default_for_propfind);
    tracing::debug!(depth = ?depth, "Depth header parsed");

    if let Ok(collection_id) = path::extract_collection_id(req.uri().path())
        && collection_id.is_nil()
    {
        res.status_code(StatusCode::NOT_FOUND);
        return;
    }

    // Parse request body
    let body = match req.payload().await {
        Ok(bytes) => bytes.to_vec(),
        Err(e) => {
            tracing::error!(error = %e, "Failed to read request body");
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };

    tracing::debug!(bytes = body.len(), "Request body read successfully");

    // Parse PROPFIND request (empty body = allprop)
    let propfind_req = match parse_propfind(&body) {
        Ok(req) => req,
        Err(e) => {
            tracing::error!(error = %e, "Failed to parse PROPFIND request");
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };

    tracing::debug!("PROPFIND request parsed successfully");

    // Get database connection
    let provider = match connection::get_db_from_depot(depot) {
        Ok(provider) => provider,
        Err(e) => {
            tracing::error!(error = %e, "Failed to get database provider");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    let mut conn = match provider.get_connection().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::error!(error = %e, "Failed to get database connection");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    // Build multistatus response
    let multistatus = match build_propfind_response(&mut conn, req, depth, &propfind_req).await {
        Ok(ms) => ms,
        Err(e) => {
            tracing::error!(error = %e, "Failed to build PROPFIND response");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    tracing::debug!("Multistatus response built successfully");

    // Serialize to XML
    let xml = match serialize_multistatus(&multistatus) {
        Ok(xml) => xml,
        Err(e) => {
            tracing::error!(error = %e, "Failed to serialize multistatus");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    // Set response
    res.status_code(StatusCode::MULTI_STATUS);
    #[expect(
        clippy::let_underscore_must_use,
        reason = "Header addition failure is non-fatal"
    )]
    let _ = res.add_header(
        "Content-Type",
        salvo::http::HeaderValue::from_static("application/xml; charset=utf-8"),
        true,
    );
    #[expect(
        clippy::let_underscore_must_use,
        reason = "Write body failure is non-fatal"
    )]
    let _ = res.write_body(xml);
}
