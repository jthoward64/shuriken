//! PROPPATCH method handler for WebDAV property updates.

use salvo::{handler, Request, Response};
use salvo::http::StatusCode;

/// ## Summary
/// Handles PROPPATCH requests to update WebDAV properties.
///
/// Parses the PROPPATCH XML request body, validates protected properties,
/// applies changes to writable properties, and returns a 207 Multi-Status response.
///
/// ## Side Effects
/// - Updates collection/resource properties in database
/// - Returns 207 Multi-Status with per-property status codes
///
/// ## Errors
/// Returns 400 for invalid XML, 403 for protected properties, 500 for server errors.
#[handler]
pub async fn proppatch(_req: &mut Request, res: &mut Response) {
    // TODO: Implement PROPPATCH handler
    // 1. Parse PROPPATCH XML request body using src/component/rfc/dav/parse/proppatch.rs
    // 2. Validate that protected properties are not being modified
    // 3. Apply changes to writable properties (displayname, description, etc.)
    // 4. Build 207 Multi-Status response with per-property status codes
    // 5. Return success (200) or failure (403/424) for each property
    
    tracing::warn!("PROPPATCH not yet implemented");
    res.status_code(StatusCode::NOT_IMPLEMENTED);
}
