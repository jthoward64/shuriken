//! Handler for `calendar-query` REPORT.

use salvo::http::StatusCode;
use salvo::{Depot, Request, Response};

use crate::app::api::dav::extract::auth::get_auth_context;
use crate::component::auth::{Action, get_resolved_location_from_depot};
use crate::component::db::connection;
use crate::component::rfc::dav::build::multistatus::serialize_multistatus;
use crate::component::rfc::dav::core::{CalendarQuery, PropertyName};

/// ## Summary
/// Handles `calendar-query` REPORT requests.
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
    _req: &mut Request,
    res: &mut Response,
    query: CalendarQuery,
    properties: Vec<PropertyName>,
    depot: &Depot,
) {
    // Get collection from depot (resolved by slug_resolver middleware)
    let collection = match crate::component::auth::get_terminal_collection_from_depot(depot) {
        Ok(coll) => coll,
        Err(_) => {
            tracing::debug!("Collection not found in depot for calendar-query REPORT");
            res.status_code(StatusCode::NOT_FOUND);
            return;
        }
    };
    let collection_id = collection.id;

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

    // Prefer ResourceLocation from depot if available (resolved by slug_resolver middleware)
    let resource = match get_resolved_location_from_depot(depot) {
        Ok(loc) => loc.clone(),
        Err(_) => {
            // Fallback: Build a minimal resource location from collection ID for auth checks
            // Using PathSegments to construct a valid ResourceLocation
            use crate::component::auth::{PathSegment, ResourceLocation, ResourceType};
            let segments = vec![
                PathSegment::ResourceType(ResourceType::Calendar),
                PathSegment::Collection(collection_id.to_string()),
            ];
            ResourceLocation::from_segments(segments)
        }
    };

    if let Err(e) = authorizer.require(&subjects, &resource, Action::Read) {
        tracing::debug!(error = %e, "Authorization denied for calendar-query REPORT");
        res.status_code(StatusCode::FORBIDDEN);
        return;
    }

    // Call service to execute query
    let multistatus = match crate::component::caldav::service::report::execute_calendar_query(
        &mut conn,
        collection_id,
        &query,
        &properties,
    )
    .await
    {
        Ok(ms) => ms,
        Err(e) => {
            tracing::error!("Failed to execute calendar-query: {}", e);
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
