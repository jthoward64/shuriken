//! Handler for `free-busy-query` REPORT.

use salvo::http::StatusCode;
use salvo::{Depot, Request, Response};

use crate::app::api::dav::extract::auth::get_auth_context;
use shuriken_rfc::rfc::dav::core::FreeBusyQuery;
use shuriken_service::auth::{
    Action, PathSegment, ResourceIdentifier, ResourceLocation, ResourceType,
    get_resolved_location_from_depot, get_terminal_collection_from_depot,
};

/// ## Summary
/// Handles `free-busy-query` REPORT requests.
///
/// Executes free-busy aggregation and returns `text/calendar` with `VFREEBUSY`.
///
/// ## Side Effects
/// - Queries indexed event and free-busy periods from storage.
/// - Returns an iCalendar payload.
///
/// ## Errors
/// Returns 404 for unresolved collection, 403 for authorization failures,
/// and 500 for internal errors.
#[tracing::instrument(skip_all, fields(path = %req.uri().path()))]
pub async fn handle(
    req: &mut Request,
    res: &mut Response,
    query: FreeBusyQuery,
    depot: &Depot,
) {
    let Ok(collection) = get_terminal_collection_from_depot(depot) else {
        tracing::debug!("Collection not found in depot for free-busy-query REPORT");
        res.status_code(StatusCode::NOT_FOUND);
        return;
    };
    let collection_id = collection.id;

    let provider = match crate::db_handler::get_db_from_depot(depot) {
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

    let (subjects, authorizer) = match get_auth_context(depot, &mut conn).await {
        Ok(ctx) => ctx,
        Err(status) => {
            res.status_code(status);
            return;
        }
    };

    let resource = if let Ok(loc) = get_resolved_location_from_depot(depot) {
        loc.clone()
    } else {
        let segments = vec![
            PathSegment::ResourceType(ResourceType::Calendar),
            PathSegment::Collection(ResourceIdentifier::Id(collection_id)),
        ];
        match ResourceLocation::from_segments(segments) {
            Ok(resource) => resource,
            Err(e) => {
                tracing::error!(error = %e, "Failed to build resource location for free-busy auth");
                res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
                return;
            }
        }
    };

    if let Err(e) = authorizer.require(&subjects, &resource, Action::ReadFreebusy) {
        tracing::debug!(error = %e, "Authorization denied for free-busy-query REPORT");
        res.status_code(StatusCode::FORBIDDEN);
        return;
    }

    let body = match shuriken_service::caldav::service::report::execute_free_busy_query(
        &mut conn,
        collection_id,
        &query,
    )
    .await
    {
        Ok(body) => body,
        Err(e) => {
            tracing::error!("Failed to execute free-busy-query: {e}");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    res.status_code(StatusCode::OK);
    #[expect(
        clippy::let_underscore_must_use,
        reason = "Header addition failure is non-fatal"
    )]
    let _ = res.add_header(
        "Content-Type",
        salvo::http::HeaderValue::from_static("text/calendar; charset=utf-8"),
        true,
    );
    #[expect(
        clippy::let_underscore_must_use,
        reason = "Write body failure is non-fatal"
    )]
    let _ = res.write_body(body);
}
