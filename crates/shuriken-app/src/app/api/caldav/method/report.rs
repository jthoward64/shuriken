//! CalDAV REPORT method dispatcher.

use salvo::http::StatusCode;
use salvo::{Depot, Request, Response, handler};

use shuriken_rfc::rfc::dav::core::ReportType;

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
    let request_path = req.uri().path().to_string();

    // Check if the collection was resolved by DavPathMiddleware
    // If not, return 404 (resource not found)
    if shuriken_service::auth::get_terminal_collection_from_depot(depot).is_err() {
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
    let req_data = match shuriken_rfc::rfc::dav::parse::report::parse_report(body) {
        Ok(parsed_report) => parsed_report,
        Err(e) => {
            let error_text = e.to_string();
            let is_timezone_error = error_text.contains("timezone");
            if is_timezone_error {
                let precondition = shuriken_rfc::rfc::dav::core::PreconditionError::
                    ValidCalendarData(error_text.clone());
                crate::app::api::dav::response::error::write_precondition_error(
                    res,
                    &precondition,
                );
                tracing::warn!(
                    path = %request_path,
                    status = ?res.status_code,
                    error = %error_text,
                    "CalDAV REPORT rejected due to timezone parse error"
                );
                return;
            }

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
            tracing::debug!(
                path = %request_path,
                status = ?res.status_code,
                "CalDAV REPORT dispatched as calendar-query"
            );
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
            tracing::debug!(
                path = %request_path,
                status = ?res.status_code,
                "CalDAV REPORT dispatched as calendar-multiget"
            );
        }
        ReportType::FreeBusyQuery(query) => {
            crate::app::api::caldav::report::free_busy_query::handle(req, res, query, depot).await;
            tracing::debug!(
                path = %request_path,
                status = ?res.status_code,
                "CalDAV REPORT dispatched as free-busy-query"
            );
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
            tracing::debug!(
                path = %request_path,
                status = ?res.status_code,
                "CalDAV REPORT dispatched as sync-collection"
            );
        }
        _ => {
            tracing::warn!("Unsupported REPORT type for CalDAV endpoint");
            res.status_code(StatusCode::NOT_IMPLEMENTED);
            tracing::debug!(
                path = %request_path,
                status = ?res.status_code,
                "CalDAV REPORT rejected as unsupported type"
            );
        }
    }
}
