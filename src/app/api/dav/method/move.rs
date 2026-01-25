//! MOVE method handler for WebDAV resource moving.

use salvo::{handler, Request, Response};
use salvo::http::StatusCode;

/// ## Summary
/// Handles MOVE requests to relocate WebDAV resources.
///
/// Reads the Destination header, validates the target location,
/// creates instance at destination, deletes source with tombstone.
///
/// ## Side Effects
/// - Creates new instance at destination
/// - Soft-deletes source instance and creates tombstone
/// - Updates sync tokens for both source and destination collections
/// - Returns 201 Created or 204 No Content
///
/// ## Errors
/// Returns 400 for missing Destination, 409 for conflicts, 412 for preconditions, 500 for errors.
#[handler]
pub async fn r#move(_req: &mut Request, res: &mut Response) {
    // TODO: Implement MOVE handler
    // 1. Parse Destination header and extract target collection/URI
    // 2. Validate destination (e.g., CardDAV addressbook-collection-location-ok)
    // 3. Check Overwrite header (default: T)
    // 4. Create instance at destination (references same entity)
    // 5. Soft-delete source instance and create tombstone
    // 6. Handle conflicts based on Overwrite header
    // 7. Update sync tokens for both source and destination collections
    // 8. Return 201 Created (with Location header) or 204 No Content
    
    tracing::warn!("MOVE not yet implemented");
    res.status_code(StatusCode::NOT_IMPLEMENTED);
}
