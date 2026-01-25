//! MKCOL method handler for Extended MKCOL (RFC 5689) for CardDAV.

use salvo::{handler, Request, Response};
use salvo::http::StatusCode;

/// ## Summary
/// Handles Extended MKCOL requests to create addressbook collections.
///
/// Parses the Extended MKCOL XML request body (RFC 5689) with resourcetype and properties,
/// creates an addressbook collection in the database, and sets the resourcetype.
///
/// ## Side Effects
/// - Creates addressbook collection in database
/// - Sets DAV:resourcetype to include DAV:collection and CARDDAV:addressbook
/// - Applies initial properties (displayname, addressbook-description, etc.)
/// - Returns 201 Created
///
/// ## Errors
/// Returns 400 for invalid XML, 403 for authorization failures, 409 if exists, 500 for errors.
#[handler]
pub async fn mkcol_extended(_req: &mut Request, res: &mut Response) {
    // TODO: Implement Extended MKCOL handler (RFC 5689)
    // 1. Parse path to extract parent collection and addressbook name
    // 2. Check authorization (user must have write access to parent)
    // 3. Parse Extended MKCOL XML request body
    //    - DAV:mkcol containing DAV:set with DAV:prop elements
    //    - Must include DAV:resourcetype with CARDDAV:addressbook
    // 4. Validate that collection doesn't already exist (409 Conflict)
    // 5. Create addressbook collection with resourcetype=DAV:collection+CARDDAV:addressbook
    // 6. Apply initial properties (displayname, addressbook-description, etc.)
    // 7. Set supported-address-data (vCard 3.0, vCard 4.0)
    // 8. Return 201 Created
    
    tracing::warn!("Extended MKCOL not yet implemented");
    res.status_code(StatusCode::NOT_IMPLEMENTED);
}
