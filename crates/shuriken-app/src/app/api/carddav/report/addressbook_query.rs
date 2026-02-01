//! Handler for `addressbook-query` REPORT.

use salvo::http::StatusCode;
use salvo::{Depot, Request, Response};

use shuriken_rfc::rfc::dav::build::multistatus::serialize_multistatus;
use shuriken_rfc::rfc::dav::core::{AddressbookQuery, PropertyName};
use shuriken_service::auth::get_resolved_location_from_depot;

/// ## Summary
/// Handles `addressbook-query` REPORT requests.
///
/// Thin handler: extracts `collection_id` → calls service → serializes response.
///
/// ## Side Effects
/// - Queries the database via service layer
/// - Returns 207 Multi-Status XML response
///
/// ## Errors
/// Returns 400 for invalid paths, 500 for server errors.
#[tracing::instrument(skip_all, fields(path = %req.uri().path()))]
pub async fn handle(
    req: &mut Request,
    res: &mut Response,
    query: AddressbookQuery,
    properties: Vec<PropertyName>,
    depot: &Depot,
) {
    // Extract collection_id from request path
    // Get collection from depot (resolved by DavPathMiddleware)
    let Ok(collection) = shuriken_service::auth::get_terminal_collection_from_depot(depot) else {
        tracing::debug!("Collection not found in depot for addressbook-query REPORT");
        res.status_code(StatusCode::NOT_FOUND);
        return;
    };
    let collection_id = collection.id;

    // Get base ResourceLocation from depot (resolved by DavPathMiddleware)
    let Ok(resource) = get_resolved_location_from_depot(depot) else {
        tracing::error!("Failed to get resolved resource location from depot");
        res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
        return;
    };

    // Get database connection
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

    // Call service to execute query
    let multistatus = match shuriken_service::carddav::service::report::execute_addressbook_query(
        &mut conn,
        resource,
        collection_id,
        &query,
        &properties,
    )
    .await
    {
        Ok(ms) => ms,
        Err(e) => {
            tracing::error!(error = %e, "Failed to execute addressbook-query");
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
    multistatus: &shuriken_rfc::rfc::dav::core::Multistatus,
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
