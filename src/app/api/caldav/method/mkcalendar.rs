//! MKCALENDAR method handler for CalDAV calendar collection creation.

use salvo::{handler, Request, Response};
use salvo::http::StatusCode;

/// ## Summary
/// Handles MKCALENDAR requests to create calendar collections.
///
/// Parses the optional MKCALENDAR XML request body with initial properties,
/// creates a calendar collection in the database, and sets the resourcetype.
///
/// ## Side Effects
/// - Creates calendar collection in database
/// - Sets DAV:resourcetype to include DAV:collection and CALDAV:calendar
/// - Applies initial properties (displayname, description, timezone, etc.)
/// - Returns 201 Created
///
/// ## Errors
/// Returns 400 for invalid XML, 403 for authorization failures, 409 if exists, 500 for errors.
#[handler]
pub async fn mkcalendar(_req: &mut Request, res: &mut Response) {
    // TODO: Implement MKCALENDAR handler
    // 1. Parse path to extract parent collection and calendar name
    // 2. Check authorization (user must have write access to parent)
    // 3. Parse optional XML request body for initial properties
    // 4. Validate that collection doesn't already exist (409 Conflict)
    // 5. Create calendar collection with resourcetype=DAV:collection+CALDAV:calendar
    // 6. Apply initial properties (displayname, calendar-description, calendar-timezone, etc.)
    // 7. Set supported-calendar-component-set (VEVENT, VTODO, etc.)
    // 8. Return 201 Created
    
    tracing::warn!("MKCALENDAR not yet implemented");
    res.status_code(StatusCode::NOT_IMPLEMENTED);
}
