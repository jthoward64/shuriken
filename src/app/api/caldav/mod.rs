// CalDAV API handlers.

use reqwest::Method;
use salvo::{Router, routing::MethodFilter};

use crate::app::api::dav::method::options as dav_options;

pub mod method;
pub mod report;

pub fn routes() -> anyhow::Result<Router> {
    Ok(Router::with_path("caldav")
        // Collection and calendar object operations
        .push(
            Router::with_path("{**rest}")
                .options(dav_options::options)
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
