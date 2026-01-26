use std::sync::Arc;

use casbin::CoreApi;
use salvo::async_trait;

use crate::component::{
    db::connection::DbPool,
    error::{AppError, AppResult},
};

/// ## Summary
/// Initialize a Casbin enforcer with a Diesel adapter using the provided connection pool.
///
/// ## Errors
/// Returns an error if the enforcer initialization fails or if the enforcer is already initialized.
#[tracing::instrument(skip(pool))]
pub async fn init_casbin(pool: DbPool) -> AppResult<casbin::Enforcer> {
    tracing::debug!("Initializing Casbin enforcer");

    let model = casbin::DefaultModel::from_str(include_str!("casbin_model.conf")).await?;
    tracing::debug!("Casbin model loaded");

    let adapter = diesel_async_adapter::DieselAdapter::with_pool(pool).await?;
    tracing::debug!("Casbin adapter created");

    // casbin::Enforcer::new(model, adapter).await
    let enforcer = casbin::Enforcer::new(model, adapter).await?;
    tracing::info!("Casbin enforcer initialized successfully");
    Ok(enforcer)
}

pub struct CasbinEnforcerHandler {
    pub enforcer: Arc<casbin::Enforcer>,
}

#[async_trait]
impl salvo::Handler for CasbinEnforcerHandler {
    #[tracing::instrument(skip(self, _req, depot, _res, _ctrl))]
    async fn handle(
        &self,
        _req: &mut salvo::Request,
        depot: &mut salvo::Depot,
        _res: &mut salvo::Response,
        _ctrl: &mut salvo::FlowCtrl,
    ) {
        depot.inject(self.enforcer.clone());
    }
}

/// ## Summary
/// Retrieves the Casbin enforcer from the depot.
///
/// ## Errors
/// Returns an error if the Casbin enforcer is not found in the depot.
pub fn get_enforcer_from_depot(depot: &salvo::Depot) -> AppResult<Arc<casbin::Enforcer>> {
    depot
        .obtain::<Arc<casbin::Enforcer>>()
        .cloned()
        .map_err(|_| AppError::InvariantViolation("Casbin enforcer not found in depot".into()))
}
