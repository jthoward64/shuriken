// CalDAV API handlers.

use salvo::Router;

pub mod method;

#[must_use]
pub fn routes() -> Router {
    Router::with_path("caldav")
        // Collection and calendar object operations
        .push(
            Router::with_path("<**rest>")
                .put(method::put::put)
                .post(method::report::report)
        )
}
