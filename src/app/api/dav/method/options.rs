//! OPTIONS method handler for `WebDAV` resources.

use salvo::http::HeaderValue;
use salvo::{Request, Response, handler};

/// ## Summary
/// Handles OPTIONS requests for `WebDAV` resources.
///
/// Returns appropriate `Allow` and `DAV` headers based on the resource type.
/// For collections, allows collection-level methods; for items, allows item-level methods.
///
/// ## Side Effects
/// Sets the `Allow` and `DAV` headers on the response.
#[handler]
pub async fn options(_req: &mut Request, res: &mut Response) {
    // TODO: Determine if this is a collection or item based on path/database lookup
    // For now, return a generic set of methods
    
    // Standard DAV methods (Phase 3)
    let allow_methods = "OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND";
    
    // DAV compliance classes
    // Class 1: Basic WebDAV (PROPFIND, PROPPATCH, COPY, MOVE, etc.)
    // Class 3: Access control (ACL)
    // calendar-access: CalDAV support
    // addressbook: CardDAV support
    let dav_header = "1, 3, calendar-access, addressbook";
    
    let _ = res.add_header("Allow", HeaderValue::from_static(allow_methods), true);
    let _ = res.add_header("DAV", HeaderValue::from_static(dav_header), true);
    res.status_code(salvo::http::StatusCode::OK);
}

/// ## Summary
/// Returns OPTIONS handler for collection resources.
///
/// Collections support additional methods like MKCALENDAR, MKCOL.
#[handler]
pub async fn options_collection(_req: &mut Request, res: &mut Response) {
    // Collection-specific methods include MKCALENDAR, MKCOL (future phases)
    let allow_methods = "OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, MKCALENDAR, MKCOL";
    let dav_header = "1, 3, calendar-access, addressbook";
    
    let _ = res.add_header("Allow", HeaderValue::from_static(allow_methods), true);
    let _ = res.add_header("DAV", HeaderValue::from_static(dav_header), true);
    res.status_code(salvo::http::StatusCode::OK);
}

/// ## Summary
/// Returns OPTIONS handler for item resources (calendar objects, vcards).
///
/// Items support basic CRUD operations but not collection creation.
#[handler]
pub async fn options_item(_req: &mut Request, res: &mut Response) {
    // Item-specific methods (no MKCALENDAR/MKCOL)
    let allow_methods = "OPTIONS, GET, HEAD, PUT, DELETE";
    let dav_header = "1, 3, calendar-access, addressbook";
    
    let _ = res.add_header("Allow", HeaderValue::from_static(allow_methods), true);
    let _ = res.add_header("DAV", HeaderValue::from_static(dav_header), true);
    res.status_code(salvo::http::StatusCode::OK);
}
