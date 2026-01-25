//! Handler for `addressbook-query` REPORT.

use salvo::http::StatusCode;
use salvo::{Request, Response};

use crate::component::db::connection;
use crate::component::rfc::dav::build::multistatus::serialize_multistatus;
use crate::component::rfc::dav::core::{AddressbookQuery, PropertyName};

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
pub async fn handle(
    req: &mut Request,
    res: &mut Response,
    query: AddressbookQuery,
    properties: Vec<PropertyName>,
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

    // Get database connection
    let mut conn = match connection::connect().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::error!("Failed to get database connection: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    // Call service to execute query
    let multistatus = match crate::component::carddav::service::report::execute_addressbook_query(
        &mut conn,
        collection_id,
        &query,
        &properties,
    )
    .await
    {
        Ok(ms) => ms,
        Err(e) => {
            tracing::error!("Failed to execute addressbook-query: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    // Serialize and write response
    write_multistatus_response(res, &multistatus);
}

/// Helper to write multistatus XML response.
fn write_multistatus_response(res: &mut Response, multistatus: &crate::component::rfc::dav::core::Multistatus) {
    let xml = match serialize_multistatus(multistatus) {
        Ok(xml) => xml,
        Err(e) => {
            tracing::error!("Failed to serialize multistatus: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    res.status_code(StatusCode::MULTI_STATUS);
    #[expect(clippy::let_underscore_must_use, reason = "Header addition failure is non-fatal")]
    let _ = res.add_header(
        "Content-Type",
        salvo::http::HeaderValue::from_static("application/xml; charset=utf-8"),
        true,
    );
    #[expect(clippy::let_underscore_must_use, reason = "Write body failure is non-fatal")]
    let _ = res.write_body(xml);
}
