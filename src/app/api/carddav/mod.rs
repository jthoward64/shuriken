// CardDAV API handlers.

use reqwest::Method;
use salvo::{Router, routing::MethodFilter};

use crate::app::api::dav;

pub mod method;
pub mod report;

pub fn routes() -> anyhow::Result<Router> {
    Ok(Router::with_path("carddav")
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
