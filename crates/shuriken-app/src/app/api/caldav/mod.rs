// CalDAV API handlers.

use salvo::{Router, http::Method, routing::MethodFilter};

use crate::app::api::{CALDAV_ROUTE_COMPONENT, dav};

pub mod method;
pub mod report;

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
