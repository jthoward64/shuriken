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
#[tracing::instrument(skip(req, res), fields(path = %req.uri().path()))]
pub async fn options(req: &mut Request, res: &mut Response) {
    tracing::info!("Handling OPTIONS request");

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

    #[expect(
        clippy::let_underscore_must_use,
        reason = "Header addition failure is non-fatal"
    )]
    let _ = res.add_header("Allow", HeaderValue::from_static(allow_methods), true);
    #[expect(
        clippy::let_underscore_must_use,
        reason = "Header addition failure is non-fatal"
    )]
    let _ = res.add_header("DAV", HeaderValue::from_static(dav_header), true);
    res.status_code(salvo::http::StatusCode::OK);

    tracing::debug!("OPTIONS response sent");
}

/// ## Summary
/// Returns OPTIONS handler for collection resources.
///
/// Collections support additional methods like MKCALENDAR, MKCOL.
#[handler]
#[tracing::instrument(skip(req, res), fields(path = %req.uri().path()))]
pub async fn options_collection(req: &mut Request, res: &mut Response) {
    tracing::info!("Handling OPTIONS request for collection");

    // Collection-specific methods include MKCALENDAR, MKCOL (future phases)
    let allow_methods = "OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, MKCALENDAR, MKCOL";
    let dav_header = "1, 3, calendar-access, addressbook";

    #[expect(
        clippy::let_underscore_must_use,
        reason = "Header addition failure is non-fatal"
    )]
    let _ = res.add_header("Allow", HeaderValue::from_static(allow_methods), true);
    #[expect(
        clippy::let_underscore_must_use,
        reason = "Header addition failure is non-fatal"
    )]
    let _ = res.add_header("DAV", HeaderValue::from_static(dav_header), true);
    res.status_code(salvo::http::StatusCode::OK);

    tracing::debug!("OPTIONS collection response sent");
}

/// ## Summary
/// Returns OPTIONS handler for item resources (calendar objects, vcards).
///
/// Items support basic CRUD operations but not collection creation.
#[handler]
#[tracing::instrument(skip(req, res), fields(path = %req.uri().path()))]
pub async fn options_item(req: &mut Request, res: &mut Response) {
    tracing::info!("Handling OPTIONS request for item");

    // Item-specific methods (no MKCALENDAR/MKCOL)
    let allow_methods = "OPTIONS, GET, HEAD, PUT, DELETE";
    let dav_header = "1, 3, calendar-access, addressbook";

    #[expect(
        clippy::let_underscore_must_use,
        reason = "Header addition failure is non-fatal"
    )]
    let _ = res.add_header("Allow", HeaderValue::from_static(allow_methods), true);
    #[expect(
        clippy::let_underscore_must_use,
        reason = "Header addition failure is non-fatal"
    )]
    let _ = res.add_header("DAV", HeaderValue::from_static(dav_header), true);
    res.status_code(salvo::http::StatusCode::OK);

    tracing::debug!("OPTIONS item response sent");
}
