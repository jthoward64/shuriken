// CalDAV API handlers.

use reqwest::Method;
use salvo::{Router, routing::MethodFilter};

use crate::app::api::{DAV_ROUTE_PREFIX, dav};

pub mod method;
pub mod report;

pub const CALDAV_ROUTE_COMPONENT: &str = "cal";
pub const CALDAV_ROUTE_PREFIX: &str =
    const_str::concat!(DAV_ROUTE_PREFIX, "/", CALDAV_ROUTE_COMPONENT);

pub fn routes() -> anyhow::Result<Router> {
    Ok(Router::with_path(CALDAV_ROUTE_COMPONENT)
        // Collection and calendar object operations
        .push(
            Router::with_path("{**rest}")
                .push(dav::routes())
                .put(method::put::put)
                .push(
                    // MKCALENDAR method
                    Router::new()
                        .filter(MethodFilter(Method::from_bytes(b"MKCALENDAR")?))
                        .goal(method::mkcalendar::mkcalendar),
                )
                .push(
                    // REPORT method
                    Router::new()
                        .filter(MethodFilter(Method::from_bytes(b"REPORT")?))
                        .goal(method::report::report),
                ),
        ))
}
