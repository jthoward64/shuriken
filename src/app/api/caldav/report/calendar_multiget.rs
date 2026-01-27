//! Handler for `calendar-multiget` REPORT.

use salvo::http::StatusCode;
use salvo::{Depot, Request, Response};

use crate::app::api::dav::extract::auth::{get_auth_context, resource_id_for};
use crate::component::auth::{Action, ResourceType};
use crate::component::db::connection;
use crate::component::rfc::dav::build::multistatus::serialize_multistatus;
use crate::component::rfc::dav::core::{CalendarMultiget, PropertyName};

/// ## Summary
/// Handles `calendar-multiget` REPORT requests.
///
/// Thin handler: extracts `collection_id` → calls service → serializes response.
///
/// ## Side Effects
/// - Queries the database via service layer
/// - Returns 207 Multi-Status XML response
///
/// ## Errors
/// Returns 400 for invalid paths, 500 for server errors.
pub async fn handle(
    req: &mut Request,
    res: &mut Response,
    multiget: CalendarMultiget,
    properties: Vec<PropertyName>,
    depot: &Depot,
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

    if collection_id.is_nil() {
        res.status_code(StatusCode::NOT_FOUND);
        return;
    }

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

    // Check authorization: user must have Read permission on the collection
    let (subjects, authorizer) = match get_auth_context(depot, &mut conn).await {
        Ok(ctx) => ctx,
        Err(status) => {
            res.status_code(status);
            return;
        }
    };

    let resource = resource_id_for(ResourceType::Calendar, collection_id, None);
    if let Err(e) = authorizer.require(&subjects, &resource, Action::Read) {
        tracing::debug!(error = %e, "Authorization denied for calendar-multiget REPORT");
        res.status_code(StatusCode::FORBIDDEN);
        return;
    }

    // Call service to execute multiget
    let multistatus = match crate::component::caldav::service::report::execute_calendar_multiget(
        &mut conn,
        collection_id,
        &multiget,
        &properties,
    )
    .await
    {
        Ok(ms) => ms,
        Err(e) => {
            tracing::error!("Failed to execute calendar-multiget: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    // Serialize and write response
    write_multistatus_response(res, &multistatus);
}

/// Helper to write multistatus XML response.
fn write_multistatus_response(
    res: &mut Response,
    multistatus: &crate::component::rfc::dav::core::Multistatus,
) {
    let xml = match serialize_multistatus(multistatus) {
        Ok(xml) => xml,
        Err(e) => {
            tracing::error!("Failed to serialize multistatus: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

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
