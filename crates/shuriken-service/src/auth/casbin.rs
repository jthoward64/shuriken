use std::sync::Arc;

use casbin::{CoreApi, MgmtApi};
use salvo::async_trait;

use crate::error::{ServiceError, ServiceResult};
use shuriken_db::db::connection::DbPool;

/// ## Summary
/// Initialize a Casbin enforcer with a Diesel adapter using the provided connection pool.
///
/// ## Errors
/// Returns an error if the enforcer initialization fails or if the enforcer is already initialized.
#[tracing::instrument(skip(pool))]
pub async fn init_casbin(pool: DbPool) -> ServiceResult<casbin::Enforcer> {
    tracing::debug!("Initializing Casbin enforcer");

    let model = casbin::DefaultModel::from_str(include_str!("casbin_model.conf")).await?;
    tracing::debug!("Casbin model loaded");

    let adapter = diesel_async_adapter::DieselAdapter::with_pool(pool).await?;
    tracing::debug!("Casbin adapter created");

    let enforcer = casbin::Enforcer::new(model, adapter).await?;

    // Log policy counts for production observability
    let policy_count = enforcer.get_policy().len();
    let grouping_count = enforcer.get_grouping_policy().len();
    tracing::info!(
        policy_count = policy_count,
        grouping_count = grouping_count,
        "Casbin enforcer initialized successfully"
    );
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
pub fn get_enforcer_from_depot(depot: &salvo::Depot) -> ServiceResult<Arc<casbin::Enforcer>> {
    depot
        .obtain::<Arc<casbin::Enforcer>>()
        .cloned()
        .map_err(|_err| ServiceError::InvariantViolation("Casbin enforcer not found in depot"))
}
