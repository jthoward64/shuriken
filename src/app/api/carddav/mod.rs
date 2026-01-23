// CardDAV API handlers.

use salvo::Router;

#[must_use]
pub fn routes() -> Router {
    Router::with_path("carddav")
}
