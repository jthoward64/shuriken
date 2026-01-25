// CalDAV API handlers.

use salvo::Router;

pub mod method;
pub mod report;

#[must_use]
pub fn routes() -> Router {
    Router::with_path("caldav")
        // Collection and calendar object operations
        .push(
            Router::with_path("<**rest>")
                .put(method::put::put)
                .push(
                    // MKCALENDAR method
                    Router::new()
                        .filter_fn(|req, _| req.method().as_str() == "MKCALENDAR")
                        .goal(method::mkcalendar::mkcalendar),
                )
                .push(
                    // REPORT method
                    Router::new()
                        .filter_fn(|req, _| req.method().as_str() == "REPORT")
                        .goal(method::report::report),
                ),
        )
}
