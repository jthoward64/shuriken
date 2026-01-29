//! CardDAV REPORT method dispatcher.

use salvo::http::StatusCode;
use salvo::{Depot, Request, Response, handler};

use shuriken_rfc::rfc::dav::core::ReportType;

/// ## Summary
/// Main REPORT method dispatcher for CardDAV.
///
/// Thin dispatcher: parses request → delegates to specific report handler.
///
/// ## Side Effects
/// - Parses XML request body
/// - Dispatches to specific report handlers
///
/// ## Errors
/// Returns 400 for invalid requests, 501 for unsupported reports.
#[handler]
pub async fn report(req: &mut Request, res: &mut Response, depot: &Depot) {
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
    let req_data = match shuriken_rfc::rfc::dav::parse::report::parse_report(body) {
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
            crate::app::api::carddav::report::addressbook_query::handle(
                req,
                res,
                query,
                req_data.properties,
                depot,
            )
            .await;
        }
        ReportType::AddressbookMultiget(multiget) => {
            crate::app::api::carddav::report::addressbook_multiget::handle(
                req,
                res,
                multiget,
                req_data.properties,
                depot,
            )
            .await;
        }
        _ => {
            tracing::warn!("Unsupported REPORT type for CardDAV endpoint");
            res.status_code(StatusCode::NOT_IMPLEMENTED);
        }
    }
}
