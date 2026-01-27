mod app_specific;
mod caldav;
mod carddav;
mod dav;

use salvo::Router;

use crate::component::middleware::{auth::AuthMiddleware, slug_resolver::SlugResolverHandler};

/// ## Summary
/// Constructs the main API router with all protocol handlers.
///
/// ## Errors
/// Returns an error if any child route handler fails to initialize.
pub fn routes() -> anyhow::Result<Router> {
    Ok(Router::with_path("api")
        .hoop(AuthMiddleware)
        .push(app_specific::routes())
        .push(
            Router::with_path("dav")
                .hoop(SlugResolverHandler)
                .push(caldav::routes()?)
                .push(carddav::routes()?),
        ))
}
