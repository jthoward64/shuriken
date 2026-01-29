mod app_specific;
mod caldav;
mod carddav;
mod dav;

use salvo::Router;

use crate::middleware::{auth::AuthMiddleware, dav_path_middleware::DavPathMiddleware};

// Re-export route constants from core
pub use shuriken_core::constants::{
    API_ROUTE_COMPONENT, API_ROUTE_PREFIX, CALDAV_ROUTE_COMPONENT, CALDAV_ROUTE_PREFIX,
    CARDDAV_ROUTE_COMPONENT, CARDDAV_ROUTE_PREFIX, DAV_ROUTE_COMPONENT, DAV_ROUTE_PREFIX,
};

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
                .hoop(DavPathMiddleware)
                .push(caldav::routes()?)
                .push(carddav::routes()?),
        ))
}
