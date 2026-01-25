#![allow(clippy::unused_async, clippy::expect_used)]
//! Test helpers for integration tests.
//!
//! Provides utilities for:
//! - Setting up test database
//! - Creating test Salvo service
//! - Making HTTP requests
//! - Asserting on responses and database state

use diesel_async::{AsyncPgConnection, RunQueryDsl};
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
    pool: diesel_async::pooled_connection::bb8::Pool<AsyncPgConnection>,
}

impl TestDb {
    /// Creates a new test database instance.
    ///
    /// ## Errors
    /// Returns an error if the database cannot be initialized or connected.
    #[expect(dead_code)]
    pub async fn new() -> anyhow::Result<Self> {
        let database_url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgres://shuriken:shuriken@localhost:4523/shuriken".to_string());

        let config = diesel_async::pooled_connection::AsyncDieselConnectionManager::<
            AsyncPgConnection,
        >::new(&database_url);

        let pool = diesel_async::pooled_connection::bb8::Pool::builder()
            .max_size(5)
            .build(config)
            .await?;

        Ok(Self { pool })
    }

    /// Gets a connection from the test database pool.
    ///
    /// ## Errors
    /// Returns an error if unable to get a connection from the pool.
    pub async fn get_conn(
        &self,
    ) -> Result<
        diesel_async::pooled_connection::bb8::PooledConnection<'_, AsyncPgConnection>,
        diesel_async::pooled_connection::bb8::RunError,
    > {
        self.pool.get().await
    }

    /// Truncates all tables for a clean test slate.
    ///
    /// ## Errors
    /// Returns an error if table truncation fails.
    #[expect(dead_code)]
    pub async fn truncate_all(&self) -> anyhow::Result<()> {
        let mut conn = self.get_conn().await?;
        
        // Truncate in reverse dependency order to avoid foreign key violations
        diesel::sql_query("TRUNCATE TABLE card_phone CASCADE").execute(&mut conn).await?;
        diesel::sql_query("TRUNCATE TABLE card_email CASCADE").execute(&mut conn).await?;
        diesel::sql_query("TRUNCATE TABLE card_index CASCADE").execute(&mut conn).await?;
        diesel::sql_query("TRUNCATE TABLE cal_occurrence CASCADE").execute(&mut conn).await?;
        diesel::sql_query("TRUNCATE TABLE cal_index CASCADE").execute(&mut conn).await?;
        diesel::sql_query("TRUNCATE TABLE dav_shadow CASCADE").execute(&mut conn).await?;
        diesel::sql_query("TRUNCATE TABLE dav_tombstone CASCADE").execute(&mut conn).await?;
        diesel::sql_query("TRUNCATE TABLE dav_parameter CASCADE").execute(&mut conn).await?;
        diesel::sql_query("TRUNCATE TABLE dav_property CASCADE").execute(&mut conn).await?;
        diesel::sql_query("TRUNCATE TABLE dav_component CASCADE").execute(&mut conn).await?;
        diesel::sql_query("TRUNCATE TABLE dav_instance CASCADE").execute(&mut conn).await?;
        diesel::sql_query("TRUNCATE TABLE dav_entity CASCADE").execute(&mut conn).await?;
        diesel::sql_query("TRUNCATE TABLE dav_collection CASCADE").execute(&mut conn).await?;
        diesel::sql_query("TRUNCATE TABLE membership CASCADE").execute(&mut conn).await?;
        diesel::sql_query("TRUNCATE TABLE group_name CASCADE").execute(&mut conn).await?;
        diesel::sql_query("TRUNCATE TABLE \"group\" CASCADE").execute(&mut conn).await?;
        diesel::sql_query("TRUNCATE TABLE auth_user CASCADE").execute(&mut conn).await?;
        diesel::sql_query("TRUNCATE TABLE \"user\" CASCADE").execute(&mut conn).await?;
        diesel::sql_query("TRUNCATE TABLE principal CASCADE").execute(&mut conn).await?;
        diesel::sql_query("TRUNCATE TABLE casbin_rule CASCADE").execute(&mut conn).await?;
        
        Ok(())
    }

    /// Seeds a test principal and returns its ID.
    ///
    /// ## Errors
    /// Returns an error if the principal cannot be inserted.
    #[expect(dead_code)]
    pub async fn seed_principal(
        &self,
        principal_type: &str,
        uri: &str,
        display_name: Option<&str>,
    ) -> anyhow::Result<uuid::Uuid> {
        use shuriken::component::db::schema::principal;
        use shuriken::component::model::principal::NewPrincipal;

        let mut conn = self.get_conn().await?;
        let principal_id = uuid::Uuid::now_v7();
        
        let new_principal = NewPrincipal {
            id: principal_id,
            principal_type,
            uri,
            display_name,
        };

        diesel::insert_into(principal::table)
            .values(&new_principal)
            .execute(&mut conn)
            .await?;

        Ok(principal_id)
    }

    /// Seeds a test user and returns the user ID.
    ///
    /// ## Errors
    /// Returns an error if the user cannot be inserted.
    #[expect(dead_code)]
    pub async fn seed_user(
        &self,
        name: &str,
        email: &str,
        principal_id: uuid::Uuid,
    ) -> anyhow::Result<uuid::Uuid> {
        use shuriken::component::db::schema::user;
        use shuriken::component::model::user::NewUser;

        let mut conn = self.get_conn().await?;
        
        let new_user = NewUser {
            name,
            email,
            principal_id,
        };

        let user_id = diesel::insert_into(user::table)
            .values(&new_user)
            .returning(user::id)
            .get_result::<uuid::Uuid>(&mut conn)
            .await?;

        Ok(user_id)
    }

    /// Seeds a test collection and returns its ID.
    ///
    /// ## Errors
    /// Returns an error if the collection cannot be inserted.
    #[expect(dead_code)]
    pub async fn seed_collection(
        &self,
        owner_principal_id: uuid::Uuid,
        collection_type: &str,
        uri: &str,
        display_name: Option<&str>,
    ) -> anyhow::Result<uuid::Uuid> {
        use shuriken::component::db::schema::dav_collection;
        use shuriken::component::model::dav::collection::NewDavCollection;

        let mut conn = self.get_conn().await?;
        
        let new_collection = NewDavCollection {
            owner_principal_id,
            collection_type,
            uri,
            display_name,
            description: None,
            timezone_tzid: None,
        };

        let collection_id = diesel::insert_into(dav_collection::table)
            .values(&new_collection)
            .returning(dav_collection::id)
            .get_result::<uuid::Uuid>(&mut conn)
            .await?;

        Ok(collection_id)
    }

    /// Seeds a test entity with an optional logical UID and returns its ID.
    ///
    /// ## Errors
    /// Returns an error if the entity cannot be inserted.
    #[expect(dead_code)]
    pub async fn seed_entity(
        &self,
        entity_type: &str,
        logical_uid: Option<&str>,
    ) -> anyhow::Result<uuid::Uuid> {
        use shuriken::component::db::schema::dav_entity;
        use shuriken::component::model::dav::entity::NewDavEntity;

        let mut conn = self.get_conn().await?;
        
        let new_entity = NewDavEntity {
            entity_type,
            logical_uid,
        };

        let entity_id = diesel::insert_into(dav_entity::table)
            .values(&new_entity)
            .returning(dav_entity::id)
            .get_result::<uuid::Uuid>(&mut conn)
            .await?;

        Ok(entity_id)
    }

    /// Seeds a test instance linking an entity to a collection.
    ///
    /// ## Errors
    /// Returns an error if the instance cannot be inserted.
    #[expect(dead_code)]
    pub async fn seed_instance(
        &self,
        collection_id: uuid::Uuid,
        entity_id: uuid::Uuid,
        uri: &str,
        content_type: &str,
        etag: &str,
        sync_revision: i64,
    ) -> anyhow::Result<uuid::Uuid> {
        use shuriken::component::db::schema::dav_instance;
        use shuriken::component::model::dav::instance::NewDavInstance;

        let mut conn = self.get_conn().await?;
        
        let new_instance = NewDavInstance {
            collection_id,
            entity_id,
            uri,
            content_type,
            etag,
            sync_revision,
            last_modified: chrono::Utc::now(),
        };

        let instance_id = diesel::insert_into(dav_instance::table)
            .values(&new_instance)
            .returning(dav_instance::id)
            .get_result::<uuid::Uuid>(&mut conn)
            .await?;

        Ok(instance_id)
    }

    /// Seeds a test component for an entity.
    ///
    /// ## Errors
    /// Returns an error if the component cannot be inserted.
    #[expect(dead_code)]
    pub async fn seed_component(
        &self,
        entity_id: uuid::Uuid,
        parent_component_id: Option<uuid::Uuid>,
        name: &str,
        ordinal: i32,
    ) -> anyhow::Result<uuid::Uuid> {
        use shuriken::component::db::schema::dav_component;
        use shuriken::component::model::dav::component::NewDavComponent;

        let mut conn = self.get_conn().await?;
        
        let new_component = NewDavComponent {
            entity_id,
            parent_component_id,
            name,
            ordinal,
        };

        let component_id = diesel::insert_into(dav_component::table)
            .values(&new_component)
            .returning(dav_component::id)
            .get_result::<uuid::Uuid>(&mut conn)
            .await?;

        Ok(component_id)
    }
}
