use salvo::async_trait;
use std::sync::Arc;

use crate::error::AppResult;
use shuriken_core::error::CoreError;
use shuriken_db::db::DbProvider;

pub struct DbProviderHandler<T: DbProvider + Send + Sync + Clone> {
    pub provider: T,
}

#[async_trait]
impl<T: DbProvider + Send + Sync + Clone + 'static> salvo::Handler for DbProviderHandler<T> {
    #[tracing::instrument(skip(self, _req, depot, _res, _ctrl))]
    async fn handle(
        &self,
        _req: &mut salvo::Request,
        depot: &mut salvo::Depot,
        _res: &mut salvo::Response,
        _ctrl: &mut salvo::FlowCtrl,
    ) {
        // Insert a reference to the pool into the depot
        let provider: Arc<dyn DbProvider + Send + Sync> = Arc::new(self.provider.clone());
        depot.inject(provider);
    }
}

/// ## Summary
/// Retrieves the database provider from the depot.
///
/// ## Errors
/// Returns an error if the database provider is not found in the depot.
pub fn get_db_from_depot(
    depot: &salvo::Depot,
) -> AppResult<Arc<dyn DbProvider + Send + Sync + 'static>> {
    depot
        .obtain::<Arc<dyn DbProvider + Send + Sync>>()
        .cloned()
        .map_err(|_err| {
            CoreError::InvariantViolation("Database provider not found in depot").into()
        })
}
