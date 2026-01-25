//! Helper functions for GET and HEAD request processing.

use salvo::http::{HeaderValue, StatusCode};
use salvo::{Request, Response};

use crate::component::db::connection;
use crate::component::db::query::dav::instance;
use crate::component::model::dav::instance::DavInstance;
use crate::util::path;

/// Shared implementation for GET and HEAD handlers.
pub(super) async fn handle_get_or_head(req: &mut Request, res: &mut Response, is_head: bool) {
    // Extract the resource path from the request
    let request_path = req.uri().path();

    // Parse path to extract collection_id and URI
    let (collection_id, uri) = match path::parse_collection_and_uri(request_path) {
        Ok(parsed) => parsed,
        Err(e) => {
            tracing::debug!(error = %e, path = %request_path, "Failed to parse path");
            res.status_code(StatusCode::NOT_FOUND);
            return;
        }
    };

    tracing::debug!(
        collection_id = %collection_id,
        uri = %uri,
        "Parsed request path"
    );

    // Get database connection
    let mut conn = match connection::connect().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::error!("Failed to get database connection: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    // Load instance from database
    let (instance, canonical_bytes) = match load_instance(&mut conn, collection_id, &uri).await {
        Ok(Some(data)) => data,
        Ok(None) => {
            tracing::debug!(
                collection_id = %collection_id,
                uri = %uri,
                "Resource not found"
            );
            res.status_code(StatusCode::NOT_FOUND);
            return;
        }
        Err(e) => {
            tracing::error!(error = %e, "Database error");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    // Check If-None-Match for conditional GET
    if !is_head && check_if_none_match(req, &instance.etag) {
        res.status_code(StatusCode::NOT_MODIFIED);
        return;
    }

    // Set response headers and body
    set_response_headers_and_body(res, &instance, &canonical_bytes, is_head);
}

/// ## Summary
/// Loads a `DAV` instance and its content from the database.
///
/// ## Errors
/// Returns database errors if the query fails.
async fn load_instance(
    conn: &mut connection::DbConnection<'_>,
    collection_id: uuid::Uuid,
    uri: &str,
) -> anyhow::Result<Option<(DavInstance, Vec<u8>)>> {
    use diesel::prelude::*;
    use diesel_async::RunQueryDsl;

    // Load the instance
    let inst = instance::by_collection_and_uri(collection_id, uri)
        .select(crate::component::model::dav::instance::DavInstance::as_select())
        .first::<DavInstance>(conn)
        .await
        .optional()?;

    let Some(inst) = inst else {
        return Ok(None);
    };

    // Load the canonical bytes from the entity
    // TODO: Add query function to load canonical_bytes from dav_entity
    // For now, return empty bytes as placeholder
    let canonical_bytes = Vec::new();

    Ok(Some((inst, canonical_bytes)))
}

/// ## Summary
/// Sets response headers and body for a successful GET/HEAD request.
///
/// ## Side Effects
/// Sets `ETag`, `Last-Modified`, `Content-Type` headers and response body (for GET).
fn set_response_headers_and_body(
    res: &mut Response,
    instance: &DavInstance,
    canonical_bytes: &[u8],
    is_head: bool,
) {
    // Set ETag header
    if let Ok(etag_value) = HeaderValue::from_str(&instance.etag) {
        #[expect(
            clippy::let_underscore_must_use,
            reason = "Header addition failure is non-fatal"
        )]
        let _ = res.add_header("ETag", etag_value, true);
    }

    // Set Last-Modified header
    let last_modified = instance
        .last_modified
        .format("%a, %d %b %Y %H:%M:%S GMT")
        .to_string();
    if let Ok(lm_value) = HeaderValue::from_str(&last_modified) {
        #[expect(
            clippy::let_underscore_must_use,
            reason = "Header addition failure is non-fatal"
        )]
        let _ = res.add_header("Last-Modified", lm_value, true);
    }

    // Set Content-Type header
    if let Ok(ct_value) = HeaderValue::from_str(&instance.content_type) {
        #[expect(
            clippy::let_underscore_must_use,
            reason = "Header addition failure is non-fatal"
        )]
        let _ = res.add_header("Content-Type", ct_value, true);
    }

    res.status_code(StatusCode::OK);

    // Set body only for GET (not HEAD)
    if !is_head
        && let Err(e) = res.write_body(canonical_bytes.to_vec())
    {
        tracing::error!("Failed to write response body: {}", e);
    }
}

/// ## Summary
/// Checks `If-None-Match` header for conditional GET.
///
/// Returns true if the request should be served with 304 Not Modified.
#[must_use]
fn check_if_none_match(req: &Request, instance_etag: &str) -> bool {
    if let Some(if_none_match) = req.headers().get("If-None-Match")
        && let Ok(value) = if_none_match.to_str()
    {
        // Check if any of the ETags match
        return value
            .split(',')
            .map(str::trim)
            .any(|etag| etag == instance_etag || etag == "*");
    }
    false
}
