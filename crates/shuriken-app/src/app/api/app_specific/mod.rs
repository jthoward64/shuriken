// App-specific API handlers; rename this module as needed.

use salvo::Router;

mod healthcheck;
mod users;
mod whoami;

#[must_use]
pub fn routes() -> Router {
    Router::with_path("app")
        .push(healthcheck::routes())
        .push(users::routes())
        .push(whoami::routes())
}
