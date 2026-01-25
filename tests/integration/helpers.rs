#![allow(clippy::unused_async, clippy::expect_used)]
//! Test helpers for integration tests.
//!
//! Provides utilities for:
//! - Setting up test database
//! - Creating test Salvo service
//! - Making HTTP requests
//! - Asserting on responses and database state

use salvo::prelude::*;

/// Creates a test Salvo service instance for integration testing.
///
/// ## Panics
/// Panics if the service cannot be created.
#[expect(dead_code)]
#[must_use]
pub fn create_test_service() -> Service {
    // TODO: Wire up actual routes once they're implemented
    // For now, create a minimal service for compilation
    Service::new(Router::new())
}

/// Represents an HTTP test response for assertions.
pub struct TestResponse {
    pub status: StatusCode,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl TestResponse {
    /// Asserts that the response status matches the expected code.
    #[expect(dead_code)]
    pub fn assert_status(&self, expected: StatusCode) {
        assert_eq!(
            self.status, expected,
            "Expected status {expected} but got {}",
            self.status
        );
    }

    /// Asserts that a header exists with the expected value.
    #[expect(dead_code)]
    pub fn assert_header(&self, name: &str, expected: &str) {
        let found = self
            .headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name));
        assert!(found.is_some(), "Header '{name}' not found in response");
        let (_, value) = found.expect("Header should exist");
        assert_eq!(
            value, expected,
            "Header '{name}' expected '{expected}' but got '{value}'"
        );
    }

    /// Asserts that the response body contains the expected substring.
    #[expect(dead_code)]
    pub fn assert_body_contains(&self, expected: &str) {
        let body = String::from_utf8_lossy(&self.body);
        assert!(
            body.contains(expected),
            "Expected body to contain '{expected}' but got:\n{body}"
        );
    }

    /// Returns the body as a UTF-8 string.
    #[expect(dead_code)]
    #[must_use]
    pub fn body_string(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
}

/// Database test helper for setup and teardown.
pub struct TestDb {
    // TODO: Add connection pool and helpers once DB integration is ready
}

impl TestDb {
    /// Creates a new test database instance.
    ///
    /// ## Panics
    /// Panics if the database cannot be initialized.
    #[expect(dead_code)]
    #[must_use]
    pub fn new() -> Self {
        // TODO: Initialize test DB connection
        Self {}
    }

    /// Truncates all tables for a clean test slate.
    #[expect(dead_code)]
    pub async fn truncate_all(&self) {
        // TODO: Implement table truncation
    }

    /// Seeds a test principal and returns its ID.
    #[expect(dead_code)]
    pub async fn seed_principal(&self, _name: &str) -> uuid::Uuid {
        // TODO: Insert principal and return ID
        uuid::Uuid::new_v4()
    }

    /// Seeds a test collection and returns its ID.
    #[expect(dead_code)]
    pub async fn seed_collection(
        &self,
        _owner_id: uuid::Uuid,
        _uri: &str,
        _resource_type: &str,
    ) -> uuid::Uuid {
        // TODO: Insert collection and return ID
        uuid::Uuid::new_v4()
    }

    /// Seeds a test entity with a component tree and returns its ID.
    #[expect(dead_code)]
    pub async fn seed_entity(&self, _entity_type: &str, _logical_uid: &str) -> uuid::Uuid {
        // TODO: Insert entity with component tree and return ID
        uuid::Uuid::new_v4()
    }

    /// Seeds a test instance linking an entity to a collection.
    #[expect(dead_code)]
    pub async fn seed_instance(
        &self,
        _collection_id: uuid::Uuid,
        _entity_id: uuid::Uuid,
        _uri: &str,
    ) -> uuid::Uuid {
        // TODO: Insert instance and return ID
        uuid::Uuid::new_v4()
    }
}
