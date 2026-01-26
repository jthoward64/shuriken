use std::sync::OnceLock;

use casbin::CoreApi;

use crate::component::{
    db::connection::get_pool,
    error::{Error, Result},
};

static ENFORCER: OnceLock<casbin::Enforcer> = OnceLock::new();

/// ## Summary
/// Initialize a Casbin enforcer with a Diesel adapter using the provided connection pool.
///
/// ## Errors
/// Returns an error if the enforcer initialization fails or if the enforcer is already initialized.
#[tracing::instrument]
pub async fn init_casbin() -> Result<()> {
    tracing::debug!("Initializing Casbin enforcer");

    let pool = get_pool();

    let model = casbin::DefaultModel::from_str(include_str!("casbin_model.conf")).await?;
    tracing::debug!("Casbin model loaded");

    let adapter = diesel_async_adapter::DieselAdapter::with_pool(pool).await?;
    tracing::debug!("Casbin adapter created");

    // casbin::Enforcer::new(model, adapter).await
    let enforcer = casbin::Enforcer::new(model, adapter).await?;
    ENFORCER.set(enforcer).map_err(|_already_set| {
        tracing::error!("Casbin enforcer already initialized - this is a programming error");
        Error::InvariantViolation("Casbin enforcer already initialized".into())
    })?;

    tracing::info!("Casbin enforcer initialized successfully");
    Ok(())
}

/// ## Summary
/// Get a reference to the global Casbin enforcer.
///
/// ## Panics
/// Panics if the Casbin enforcer is not initialized. This should only happen if
/// `init_casbin()` was not called during application startup.
#[must_use]
#[expect(clippy::expect_used, reason = "Startup invariant - enforcer must be initialized")]
pub fn get_enforcer() -> &'static casbin::Enforcer {
    ENFORCER
        .get()
        .expect("Casbin enforcer is not initialized - init_casbin() must be called at startup")
}
