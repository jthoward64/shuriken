mod app_specific;
mod caldav;
mod carddav;

use salvo::Router;

#[must_use]
pub fn routes() -> Router {
    Router::with_path("api")
        .push(app_specific::routes())
        .push(caldav::routes())
        .push(carddav::routes())
}
