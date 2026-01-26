//! GET and HEAD method handlers for `WebDAV` resources.

mod helpers;

use salvo::{Depot, Request, Response, handler};

use helpers::handle_get_or_head;

/// ## Summary
/// Handles GET requests for `WebDAV` resources.
///
/// Retrieves the resource content from the database and returns it with
/// appropriate headers (`ETag`, `Last-Modified`, `Content-Type`).
///
/// ## Side Effects
/// - Queries the database for the resource
/// - Sets response headers and body
///
/// ## Errors
/// Returns 404 if the resource is not found, 500 for database errors.
#[handler]
#[tracing::instrument(skip(req, res), fields(path = %req.uri().path()))]
pub async fn get(req: &mut Request, res: &mut Response, depot: &Depot) {
    tracing::info!("Handling GET request");
    handle_get_or_head(req, res, false, depot).await;
}

/// ## Summary
/// Handles HEAD requests for `WebDAV` resources.
///
/// Same as GET but does not return the response body.
///
/// ## Side Effects
/// - Queries the database for the resource
/// - Sets response headers (no body)
///
/// ## Errors
/// Returns 404 if the resource is not found, 500 for database errors.
#[handler]
#[tracing::instrument(skip(req, res), fields(path = %req.uri().path()))]
pub async fn head(req: &mut Request, res: &mut Response, depot: &Depot) {
    tracing::info!("Handling HEAD request");
    handle_get_or_head(req, res, true, depot).await;
}
