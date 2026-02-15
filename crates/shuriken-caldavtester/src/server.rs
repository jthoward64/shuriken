//! Test server management.
//!
//! Handles starting and stopping the Shuriken server for testing.

use crate::error::{Error, Result};
use std::net::SocketAddr;
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
        // TODO: Implement server startup using shuriken-app
        // For now, assume server is already running
        let addr = "127.0.0.1:8080"
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
