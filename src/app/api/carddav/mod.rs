// CardDAV API handlers.

use salvo::Router;

pub mod method;
pub mod report;

#[must_use]
pub fn routes() -> Router {
    Router::with_path("carddav")
        // Address book and vCard operations
        .push(
            Router::with_path("<**rest>")
                .put(method::put::put)
                .post(method::report::report)
        )
}
