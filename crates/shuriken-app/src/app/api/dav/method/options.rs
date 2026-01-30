//! OPTIONS method handler for `WebDAV` resources.

use salvo::http::HeaderValue;
use salvo::{Depot, Request, Response, handler};
use shuriken_service::auth::depot::depot_keys;

/// ## Summary
/// Handles OPTIONS requests for `WebDAV` resources.
///
/// Returns appropriate `Allow` and `DAV` headers based on the resource type.
/// Determines if the resource is a collection or item by checking the depot
/// for an INSTANCE entry (items have instances, collections don't).
///
/// ## Side Effects
/// Sets the `Allow` and `DAV` headers on the response.
#[handler]
#[tracing::instrument(skip_all, fields(path = %req.uri().path()))]
pub async fn options(req: &mut Request, res: &mut Response, depot: &Depot) {
    tracing::info!("Handling OPTIONS request");

    // Determine if this is an item (has instance) or collection (no instance)
    let is_item = depot
        .get::<shuriken_db::model::dav::instance::DavInstance>(depot_keys::INSTANCE)
        .is_ok();

    // Set Allow header based on resource type
    let allow_methods = if is_item {
        // Items support basic CRUD operations but not collection creation
        "OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, REPORT"
    } else {
        // Collections support additional methods like MKCALENDAR, MKCOL
        "OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, REPORT, MKCALENDAR, MKCOL"
    };

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

    tracing::debug!(is_item, "OPTIONS response sent");
}

/// ## Summary
/// Returns OPTIONS handler for collection resources.
///
/// Collections support additional methods like MKCALENDAR, MKCOL.
#[handler]
#[tracing::instrument(skip_all, fields(path = %req.uri().path()))]
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
#[tracing::instrument(skip_all, fields(path = %req.uri().path()))]
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
