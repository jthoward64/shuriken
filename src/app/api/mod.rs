mod app_specific;
mod caldav;
mod carddav;
mod dav;

use salvo::Router;

use crate::component::middleware::auth::AuthMiddleware;

/// ## Summary
/// Constructs the main API router with all protocol handlers.
///
/// ## Errors
/// Returns an error if any child route handler fails to initialize.
pub fn routes() -> anyhow::Result<Router> {
    Ok(Router::with_path("api")
        .hoop(AuthMiddleware)
        .options(dav::method::options::options)
        .push(app_specific::routes())
        .push(caldav::routes()?)
        .push(carddav::routes()?))
}
