//! CalDAV REPORT method dispatcher.

use salvo::http::StatusCode;
use salvo::{Depot, Request, Response, handler};

use crate::component::rfc::dav::core::ReportType;

/// ## Summary
/// Main REPORT method dispatcher for CalDAV.
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
    // Check if the collection was resolved by slug_resolver middleware
    // If not, return 404 (resource not found)
    if crate::component::auth::get_terminal_collection_from_depot(depot).is_err() {
        tracing::debug!("Collection not found in depot for CalDAV REPORT request");
        res.status_code(StatusCode::NOT_FOUND);
        return;
    }

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
            crate::app::api::caldav::report::calendar_query::handle(
                req,
                res,
                query,
                req_data.properties,
                depot,
            )
            .await;
        }
        ReportType::CalendarMultiget(multiget) => {
            crate::app::api::caldav::report::calendar_multiget::handle(
                req,
                res,
                multiget,
                req_data.properties,
                depot,
            )
            .await;
        }
        ReportType::SyncCollection(sync) => {
            // sync-collection is a generic WebDAV REPORT, not CalDAV-specific
            // Forward to the generic DAV handler
            crate::app::api::dav::method::report::handle_sync_collection(
                req,
                res,
                sync,
                req_data.properties,
                depot,
            )
            .await;
        }
        _ => {
            tracing::warn!("Unsupported REPORT type for CalDAV endpoint");
            res.status_code(StatusCode::NOT_IMPLEMENTED);
        }
    }
}
