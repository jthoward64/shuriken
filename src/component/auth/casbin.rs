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
pub async fn init_casbin() -> Result<()> {
    let pool = get_pool();

    let model = casbin::DefaultModel::from_str(include_str!("casbin_model.conf")).await?;

    let adapter = diesel_async_adapter::DieselAdapter::with_pool(pool).await?;

    // casbin::Enforcer::new(model, adapter).await
    let enforcer = casbin::Enforcer::new(model, adapter).await?;
    #[expect(clippy::map_err_ignore)]
    ENFORCER
        .set(enforcer)
        .map_err(|_| Error::InvariantViolation("Casbin enforcer already initialized".into()))?;
    Ok(())
}

/// ## Summary
/// Get a reference to the global Casbin enforcer.
///
/// ## Panics
/// Panics if the Casbin enforcer is not initialized.
pub fn get_enforcer() -> &'static casbin::Enforcer {
    #[expect(clippy::expect_used)]
    ENFORCER.get().expect("Casbin enforcer is not initialized")
}
