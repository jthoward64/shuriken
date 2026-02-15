//! Principal resource API handlers.
//!
//! Handles requests to principal URLs like `/api/dav/principal/{principal-slug}/`.
//! Principals represent users and groups in the CalDAV/CardDAV system.

use salvo::{Router, http::Method, routing::MethodFilter};

use crate::app::api::dav;

pub mod method;

/// ## Summary
/// Constructs the principal route handler.
///
/// Provides PROPFIND and OPTIONS for principal resources.
///
/// ## Errors
/// Returns an error if route setup fails.
pub fn routes() -> anyhow::Result<Router> {
    Ok(Router::with_path("principal/{**rest}")
        .push(
            Router::new()
                .filter(MethodFilter(Method::from_bytes(b"PROPFIND")?))
                .goal(method::propfind::principal_propfind),
        )
        .push(dav::routes()))
}
