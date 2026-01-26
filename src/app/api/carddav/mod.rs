// CardDAV API handlers.

use salvo::Router;

use crate::app::api::dav::method::options as dav_options;

pub mod method;
pub mod report;

#[must_use]
pub fn routes() -> Router {
    Router::with_path("carddav")
        // Address book and vCard operations
        .push(
            Router::with_path("<**rest>")
                .options(dav_options::options)
                .put(method::put::put)
                .push(
                    // MKCOL method
                    Router::new()
                        .filter_fn(|req, _| req.method().as_str() == "MKCOL")
                        .goal(method::mkcol::mkcol_extended),
                )
                .push(
                    // REPORT method
                    Router::new()
                        .filter_fn(|req, _| req.method().as_str() == "REPORT")
                        .goal(method::report::report),
                ),
        )
}
