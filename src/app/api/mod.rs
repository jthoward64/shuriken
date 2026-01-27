mod app_specific;
mod caldav;
mod carddav;
mod dav;

use salvo::Router;

use crate::component::middleware::{auth::AuthMiddleware, slug_resolver::SlugResolverHandler};

// The route component for the api
pub const API_ROUTE_COMPONENT: &str = "api";
// The full route prefix for the api
pub const API_ROUTE_PREFIX: &str = const_str::concat!("/", API_ROUTE_COMPONENT);

// The prefix for all dav routes
pub const DAV_ROUTE_COMPONENT: &str = "dav";
pub const DAV_ROUTE_PREFIX: &str = const_str::concat!(API_ROUTE_PREFIX, "/", DAV_ROUTE_COMPONENT);

/// ## Summary
/// Constructs the main API router with all protocol handlers.
///
/// ## Errors
/// Returns an error if any child route handler fails to initialize.
pub fn routes() -> anyhow::Result<Router> {
    Ok(Router::with_path(API_ROUTE_COMPONENT)
        .hoop(AuthMiddleware)
        .push(app_specific::routes())
        .push(
            Router::with_path(DAV_ROUTE_COMPONENT)
                .hoop(SlugResolverHandler)
                .push(caldav::routes()?)
                .push(carddav::routes()?),
        ))
}

pub use caldav::{CALDAV_ROUTE_COMPONENT, CALDAV_ROUTE_PREFIX};
pub use carddav::{CARDDAV_ROUTE_COMPONENT, CARDDAV_ROUTE_PREFIX};
