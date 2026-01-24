mod app_specific;
mod caldav;
mod carddav;
mod dav;

use salvo::Router;

use crate::component::middleware::auth::AuthMiddleware;

#[must_use]
pub fn routes() -> Router {
    Router::with_path("api")
        .hoop(AuthMiddleware)
        .push(app_specific::routes())
        .push(caldav::routes())
        .push(carddav::routes())
}
