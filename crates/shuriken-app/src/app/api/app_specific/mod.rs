// App-specific API handlers; rename this module as needed.

use salvo::Router;

mod auth;
mod healthcheck;
mod whoami;

#[must_use]
pub fn routes() -> Router {
    Router::with_path("app")
        .push(auth::routes())
        .push(healthcheck::routes())
        .push(whoami::routes())
}
