//! COPY method handler for WebDAV resource copying.

use salvo::{handler, Request, Response};
use salvo::http::StatusCode;

/// ## Summary
/// Handles COPY requests to duplicate WebDAV resources.
///
/// Reads the Destination header, validates the target location,
/// duplicates the entity and instance, and handles conflicts.
///
/// ## Side Effects
/// - Creates new entity/instance records
/// - Updates sync tokens for destination collection
/// - Returns 201 Created or 204 No Content
///
/// ## Errors
/// Returns 400 for missing Destination, 409 for conflicts, 412 for preconditions, 500 for errors.
#[handler]
pub async fn copy(_req: &mut Request, res: &mut Response) {
    // TODO: Implement COPY handler
    // 1. Parse Destination header and extract target collection/URI
    // 2. Validate destination (e.g., CardDAV addressbook-collection-location-ok)
    // 3. Check Overwrite header (default: T)
    // 4. Duplicate entity and create new instance at destination
    // 5. Handle conflicts based on Overwrite header
    // 6. Update sync tokens for destination collection
    // 7. Return 201 Created (with Location header) or 204 No Content
    
    tracing::warn!("COPY not yet implemented");
    res.status_code(StatusCode::NOT_IMPLEMENTED);
}
