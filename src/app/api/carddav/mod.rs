// CardDAV API handlers.

use reqwest::Method;
use salvo::{Router, routing::MethodFilter};

use crate::app::api::{DAV_ROUTE_PREFIX, dav};

pub mod method;
pub mod report;

pub const CARDDAV_ROUTE_COMPONENT: &str = "card";
pub const CARDDAV_ROUTE_PREFIX: &str =
    const_str::concat!(DAV_ROUTE_PREFIX, "/", CARDDAV_ROUTE_COMPONENT);

pub fn routes() -> anyhow::Result<Router> {
    Ok(Router::with_path(CARDDAV_ROUTE_COMPONENT)
        // Address book and vCard operations
        .push(
            Router::with_path("{**rest}")
                .push(dav::routes())
                .put(method::put::put)
                .push(
                    // MKCOL method
                    Router::new()
                        .filter(MethodFilter(Method::from_bytes(b"MKCOL")?))
                        .goal(method::mkcol::mkcol_extended),
                )
                .push(
                    // REPORT method
                    Router::new()
                        .filter(MethodFilter(Method::from_bytes(b"REPORT")?))
                        .goal(method::report::report),
                ),
        ))
}
