// CalDAV API handlers.

use salvo::Router;

pub mod method;

#[must_use]
pub fn routes() -> Router {
    Router::with_path("caldav")
}
