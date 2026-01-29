use std::sync::Arc;

use salvo::async_trait;
pub use shuriken_core::config::*;

use crate::error::{AppError, AppResult};

pub struct ConfigHandler {
    pub settings: Settings,
}

#[async_trait]
impl salvo::Handler for ConfigHandler {
    #[tracing::instrument(skip(self, _req, depot, _res, _ctrl))]
    async fn handle(
        &self,
        _req: &mut salvo::Request,
        depot: &mut salvo::Depot,
        _res: &mut salvo::Response,
        _ctrl: &mut salvo::FlowCtrl,
    ) {
        let settings: Arc<Settings> = Arc::new(self.settings.clone());
        depot.inject(settings);
    }
}

/// ## Summary
/// Retrieves the application configuration from the depot.
///
/// ## Errors
/// Returns an error if the configuration is not found in the depot.
pub fn get_config_from_depot(depot: &salvo::Depot) -> AppResult<Arc<Settings>> {
    depot.obtain::<Arc<Settings>>().cloned().map_err(|_err| {
        AppError::CoreError(shuriken_core::error::CoreError::InvariantViolation(
            "Configuration not found in depot",
        ))
    })
}

#[cfg(test)]
mod tests;
