//! Test server management.
//!
//! Handles starting and stopping the Shuriken server for testing.

use crate::error::{Error, Result};
use salvo::{Router, Service};
use shuriken_app::app::api::routes;
use shuriken_app::config::ConfigHandler;
use shuriken_app::db_handler::DbProviderHandler;
use shuriken_core::config::{Settings, load_config};
use shuriken_db::db::connection::create_pool;
use shuriken_service::auth::casbin::{CasbinEnforcerHandler, init_casbin};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::task::JoinHandle;

/// Test server instance
pub struct TestServer {
    /// Server address
    pub addr: SocketAddr,
    /// Server task handle
    handle: Option<JoinHandle<()>>,
}

impl TestServer {
    /// ## Summary
    /// Start a new test server instance.
    ///
    /// ## Errors
    /// Returns an error if the server fails to start.
    pub async fn start() -> Result<Self> {
        let settings = load_config().map_err(|e| Error::Server(format!("load config failed: {e}")))?;
        let addr = format!("{}:{}", settings.server.host, settings.server.port)
            .parse()
            .map_err(|e| Error::Server(format!("Invalid address: {e}")))?;

        Ok(Self { addr, handle: None })
    }

    /// ## Summary
    /// Get the base URL for the test server.
    #[must_use]
    pub fn base_url(&self) -> String {
        format!("http://{}", self.addr)
    }

    /// ## Summary
    /// Stop the test server.
    ///
    /// ## Errors
    /// Returns an error if the server fails to stop gracefully.
    pub async fn stop(mut self) -> Result<()> {
        if let Some(handle) = self.handle.take() {
            handle.abort();
            // Wait for cleanup
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }
        Ok(())
    }
}

/// ## Summary
/// Builds a full in-process Salvo service using current runtime settings.
///
/// ## Errors
/// Returns an error if config loading, pool creation, route creation, or Casbin setup fails.
pub async fn create_in_process_service() -> Result<Service> {
    let settings =
        load_config().map_err(|e| Error::Server(format!("load config failed: {e}")))?;
    create_in_process_service_with_settings(settings).await
}

/// ## Summary
/// Builds a full in-process Salvo service from explicit settings.
///
/// ## Errors
/// Returns an error if pool creation, route creation, or Casbin setup fails.
pub async fn create_in_process_service_with_settings(settings: Settings) -> Result<Service> {
    let pool = create_pool(
        &settings.database.url,
        u32::from(settings.database.max_connections),
    )
    .await
    .map_err(|e| Error::Server(format!("create pool failed: {e}")))?;

    let enforcer = init_casbin(pool.clone())
        .await
        .map_err(|e| Error::Server(format!("init casbin failed: {e}")))?;

    let router = Router::new()
        .hoop(DbProviderHandler { provider: pool })
        .hoop(ConfigHandler {
            settings: settings.clone(),
        })
        .hoop(CasbinEnforcerHandler {
            enforcer: Arc::new(enforcer),
        })
        .push(routes().map_err(|e| Error::Server(format!("build routes failed: {e}")))?);

    Ok(Service::new(router))
}

impl Drop for TestServer {
    fn drop(&mut self) {
        if let Some(handle) = self.handle.take() {
            handle.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_server_base_url() {
        let server = TestServer {
            addr: "127.0.0.1:8080".parse().unwrap(),
            handle: None,
        };
        assert_eq!(server.base_url(), "http://127.0.0.1:8080");
    }
}
