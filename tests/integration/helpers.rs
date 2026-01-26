#![allow(clippy::unused_async, clippy::expect_used)]
//! Test helpers for integration tests.
//!
//! Provides utilities for:
//! - Setting up test database
//! - Creating test Salvo service
//! - Making HTTP requests
//! - Asserting on responses and database state
//!
//! ## Database Lock
//! The `TestDb` struct internally holds a mutex guard that serializes database
//! access across tests. This prevents race conditions when tests run in parallel
//! (e.g., truncating tables while another test is reading). The lock is automatically
//! acquired when calling `TestDb::new()` and released when the `TestDb` is dropped.

use diesel::prelude::*;
use diesel_async::{AsyncPgConnection, RunQueryDsl};
use salvo::http::header::HeaderName;
use salvo::http::{Method, ReqBody, StatusCode};
use salvo::prelude::*;
use salvo::test::{RequestBuilder, ResponseExt, TestClient};
use std::sync::OnceLock;
use tokio::sync::{Mutex, MutexGuard};

/// Static reference to shared test service (initialized once per test run)
static TEST_SERVICE: OnceLock<Service> = OnceLock::new();

/// Static mutex to serialize database access across tests.
///
/// This prevents race conditions when tests run in parallel:
/// - Truncate operations don't conflict with each other
/// - Seeding and querying don't race
///
/// Use `with_test_db()` to acquire this lock automatically.
static DB_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

/// Gets the database lock mutex.
fn get_db_lock() -> &'static Mutex<()> {
    DB_LOCK.get_or_init(|| Mutex::new(()))
}

/// Creates a test Salvo service instance for integration testing.
///
/// ## Summary
/// Returns a shared test service that includes all API routes.
/// The service is initialized once and reused across tests.
///
/// ## Panics
/// Panics if the service cannot be created.
#[must_use]
pub fn create_test_service() -> &'static Service {
    TEST_SERVICE.get_or_init(|| {
        // Create the full router with all API routes
        let router = Router::new().push(shuriken::app::api::routes());
        Service::new(router)
    })
}

/// Test request builder for constructing HTTP requests.
pub struct TestRequest {
    method: Method,
    path: String,
    headers: Vec<(String, String)>,
    body: Option<Vec<u8>>,
}

impl TestRequest {
    /// Creates a new test request with the given method and path.
    #[must_use]
    pub fn new(method: Method, path: &str) -> Self {
        Self {
            method,
            path: path.to_string(),
            headers: Vec::new(),
            body: None,
        }
    }

    /// Creates a new OPTIONS request.
    #[must_use]
    pub fn options(path: &str) -> Self {
        Self::new(Method::OPTIONS, path)
    }

    /// Creates a new GET request.
    #[must_use]
    pub fn get(path: &str) -> Self {
        Self::new(Method::GET, path)
    }

    /// Creates a new HEAD request.
    #[must_use]
    pub fn head(path: &str) -> Self {
        Self::new(Method::HEAD, path)
    }

    /// Creates a new PUT request.
    #[must_use]
    pub fn put(path: &str) -> Self {
        Self::new(Method::PUT, path)
    }

    /// Creates a new DELETE request.
    #[must_use]
    pub fn delete(path: &str) -> Self {
        Self::new(Method::DELETE, path)
    }

    /// Creates a new PROPFIND request.
    #[must_use]
    pub fn propfind(path: &str) -> Self {
        Self::new(Method::from_bytes(b"PROPFIND").expect("Valid method"), path)
    }

    /// Creates a new PROPPATCH request.
    #[must_use]
    pub fn proppatch(path: &str) -> Self {
        Self::new(
            Method::from_bytes(b"PROPPATCH").expect("Valid method"),
            path,
        )
    }

    /// Creates a new MKCOL request.
    #[must_use]
    pub fn mkcol(path: &str) -> Self {
        Self::new(Method::from_bytes(b"MKCOL").expect("Valid method"), path)
    }

    /// Creates a new MKCALENDAR request.
    #[must_use]
    pub fn mkcalendar(path: &str) -> Self {
        Self::new(
            Method::from_bytes(b"MKCALENDAR").expect("Valid method"),
            path,
        )
    }

    /// Creates a new COPY request.
    #[must_use]
    pub fn copy(path: &str) -> Self {
        Self::new(Method::from_bytes(b"COPY").expect("Valid method"), path)
    }

    /// Creates a new MOVE request.
    #[must_use]
    pub fn r#move(path: &str) -> Self {
        Self::new(Method::from_bytes(b"MOVE").expect("Valid method"), path)
    }

    /// Alias for move (since 'move' is a reserved keyword).
    #[must_use]
    pub fn move_resource(path: &str) -> Self {
        Self::r#move(path)
    }

    /// Creates a new REPORT request.
    #[must_use]
    pub fn report(path: &str) -> Self {
        Self::new(Method::from_bytes(b"REPORT").expect("Valid method"), path)
    }

    /// Adds a header to the request.
    #[must_use]
    pub fn header(mut self, name: &str, value: &str) -> Self {
        self.headers.push((name.to_string(), value.to_string()));
        self
    }

    /// Sets the Depth header.
    #[must_use]
    pub fn depth(self, depth: &str) -> Self {
        self.header("Depth", depth)
    }

    /// Sets the If-Match header.
    #[must_use]
    pub fn if_match(self, etag: &str) -> Self {
        self.header("If-Match", etag)
    }

    /// Sets the If-None-Match header.
    #[must_use]
    pub fn if_none_match(self, etag: &str) -> Self {
        self.header("If-None-Match", etag)
    }

    /// Sets the Destination header for COPY/MOVE.
    #[must_use]
    pub fn destination(self, dest: &str) -> Self {
        self.header("Destination", dest)
    }

    /// Sets the Overwrite header for COPY/MOVE.
    #[must_use]
    pub fn overwrite(self, value: bool) -> Self {
        self.header("Overwrite", if value { "T" } else { "F" })
    }

    /// Sets the Content-Type header.
    #[must_use]
    pub fn content_type(self, content_type: &str) -> Self {
        self.header("Content-Type", content_type)
    }

    /// Sets the request body.
    #[must_use]
    pub fn body(mut self, body: impl Into<Vec<u8>>) -> Self {
        self.body = Some(body.into());
        self
    }

    /// Sets an XML request body.
    #[must_use]
    pub fn xml_body(self, xml: &str) -> Self {
        self.content_type("application/xml; charset=utf-8")
            .body(xml.as_bytes().to_vec())
    }

    /// Sets an iCalendar request body.
    #[must_use]
    pub fn icalendar_body(self, ical: &str) -> Self {
        self.content_type("text/calendar; charset=utf-8")
            .body(ical.as_bytes().to_vec())
    }

    /// Sets a vCard request body.
    #[must_use]
    pub fn vcard_body(self, vcard: &str) -> Self {
        self.content_type("text/vcard; charset=utf-8")
            .body(vcard.as_bytes().to_vec())
    }

    /// Sends the request to the test service and returns the response.
    ///
    /// ## Panics
    /// Panics if the request cannot be sent or the response cannot be read.
    pub async fn send(self, service: &Service) -> TestResponse {
        // Build the URL
        let url = format!("http://127.0.0.1:5800{}", self.path);

        // Create the test client with the appropriate method
        let mut client = match self.method.as_str() {
            "GET" => TestClient::get(&url),
            "HEAD" => TestClient::head(&url),
            "PUT" => TestClient::put(&url),
            "DELETE" => TestClient::delete(&url),
            "OPTIONS" => TestClient::options(&url),
            _ => {
                // For custom methods (PROPFIND, PROPPATCH, etc.), use RequestBuilder directly
                RequestBuilder::new(&url, self.method.clone())
            }
        };

        // Add headers using HeaderName
        for (name, value) in self.headers {
            if let Ok(header_name) = HeaderName::try_from(name.as_str()) {
                client = client.add_header(header_name, value, true);
            }
        }

        // Add body if present
        if let Some(body_bytes) = self.body {
            client = client.body(ReqBody::Once(body_bytes.into()));
        }

        // Send the request
        let mut response = client.send(service).await;

        // Extract status code
        let status = response
            .status_code
            .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);

        // Extract headers
        let headers: Vec<(String, String)> = response
            .headers()
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
            .collect();

        // Extract body
        let body: Vec<u8> = response.take_bytes(None).await.unwrap_or_default().to_vec();

        TestResponse {
            status,
            headers,
            body,
        }
    }
}

/// Represents an HTTP test response for assertions.
pub struct TestResponse {
    pub status: StatusCode,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl TestResponse {
    /// Asserts that the response status matches the expected code.
    #[must_use]
    pub fn assert_status(self, expected: StatusCode) -> Self {
        assert_eq!(
            self.status, expected,
            "Expected status {expected} but got {}",
            self.status
        );
        self
    }

    /// Asserts that the response status is in the 2xx range.
    #[must_use]
    pub fn assert_success(self) -> Self {
        assert!(
            self.status.is_success(),
            "Expected success status but got {}",
            self.status
        );
        self
    }

    /// Asserts that a header exists with the expected value.
    #[must_use]
    pub fn assert_header(self, name: &str, expected: &str) -> Self {
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
        self
    }

    /// Asserts that a header exists (regardless of value).
    #[must_use]
    pub fn assert_header_exists(self, name: &str) -> Self {
        let found = self
            .headers
            .iter()
            .any(|(k, _)| k.eq_ignore_ascii_case(name));
        assert!(found, "Header '{name}' not found in response");
        self
    }

    /// Asserts that a header contains the expected substring.
    #[must_use]
    pub fn assert_header_contains(self, name: &str, expected: &str) -> Self {
        let found = self
            .headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name));
        assert!(found.is_some(), "Header '{name}' not found in response");
        let (_, value) = found.expect("Header should exist");
        assert!(
            value.contains(expected),
            "Header '{name}' expected to contain '{expected}' but got '{value}'"
        );
        self
    }

    /// Asserts that the response body contains the expected substring.
    #[must_use]
    pub fn assert_body_contains(self, expected: &str) -> Self {
        let body = String::from_utf8_lossy(&self.body);
        assert!(
            body.contains(expected),
            "Expected body to contain '{expected}' but got:\n{body}"
        );
        self
    }

    /// Asserts that the response body does not contain the specified substring.
    #[must_use]
    pub fn assert_body_not_contains(self, unexpected: &str) -> Self {
        let body = String::from_utf8_lossy(&self.body);
        assert!(
            !body.contains(unexpected),
            "Expected body to NOT contain '{unexpected}' but got:\n{body}"
        );
        self
    }

    /// Asserts that the response body is empty.
    #[must_use]
    pub fn assert_body_empty(self) -> Self {
        assert!(
            self.body.is_empty(),
            "Expected empty body but got {} bytes",
            self.body.len()
        );
        self
    }

    /// Asserts that the response body is valid XML.
    #[must_use]
    pub fn assert_valid_xml(self) -> Self {
        let body_str = String::from_utf8_lossy(&self.body);
        // Simple XML validation - just check for well-formed structure
        assert!(
            body_str.trim().starts_with("<?xml") || body_str.trim().starts_with('<'),
            "Expected XML response but got:\n{body_str}"
        );
        self
    }

    /// Returns the body as a UTF-8 string.
    #[must_use]
    pub fn body_string(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }

    /// Gets a header value by name (case-insensitive).
    #[must_use]
    pub fn get_header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    /// Gets the ETag header value.
    #[must_use]
    pub fn get_etag(&self) -> Option<&str> {
        self.get_header("ETag")
    }

    /// Gets the Content-Type header value.
    #[must_use]
    pub fn get_content_type(&self) -> Option<&str> {
        self.get_header("Content-Type")
    }

    /// Counts the number of <response> elements in a multistatus response.
    #[must_use]
    pub fn count_multistatus_responses(&self) -> usize {
        let body = self.body_string();
        body.matches("<D:response>")
            .count()
            .max(body.matches("<response>").count())
    }

    /// Counts the number of <propstat> elements in a multistatus response.
    #[must_use]
    pub fn count_propstats(&self) -> usize {
        let body = self.body_string();
        body.matches("<D:propstat>")
            .count()
            .max(body.matches("<propstat>").count())
    }
}

/// Database test helper for setup and teardown.
///
/// ## Note on Concurrency
/// This struct holds a mutex guard that serializes database access across tests.
/// When the `TestDb` instance is dropped, the lock is released. This prevents
/// race conditions when tests run in parallel.
#[expect(clippy::doc_markdown)]
pub struct TestDb {
    pool: diesel_async::pooled_connection::bb8::Pool<AsyncPgConnection>,
    /// Lock guard that serializes database access. Held for the lifetime of TestDb.
    _lock_guard: MutexGuard<'static, ()>,
}

impl TestDb {
    /// Creates a new test database instance.
    ///
    /// ## Errors
    /// Returns an error if:
    /// - `DATABASE_URL` environment variable is not set
    /// - The database cannot be initialized or connected
    ///
    /// ## Safety Features
    /// This function modifies the `DATABASE_URL` for safety:
    /// - If the database name is not `shuriken_test`, it will be changed to `shuriken_test`
    /// - All modifications are logged as info messages
    ///
    /// ## Concurrency
    /// This function acquires a mutex lock that is held until the `TestDb` is dropped.
    /// This serializes database access across tests to prevent race conditions.
    #[expect(dead_code)]
    pub async fn new() -> anyhow::Result<Self> {
        // Acquire the database lock before doing anything
        let lock_guard = get_db_lock().lock().await;

        let mut database_url = std::env::var("DATABASE_URL").map_err(|_| {
            anyhow::anyhow!("DATABASE_URL environment variable must be set for tests")
        })?;

        // Parse the database URL to check and modify database name
        if let Some(db_name_start) = database_url.rfind('/') {
            let after_slash = &database_url[db_name_start + 1..];

            // Split database name from query parameters
            let (db_name, query_params) = if let Some(query_start) = after_slash.find('?') {
                (&after_slash[..query_start], &after_slash[query_start..])
            } else {
                (after_slash, "")
            };

            // Check and fix database name
            let mut needs_db_change = false;
            if db_name != "shuriken_test" {
                tracing::info!(
                    original_db = db_name,
                    "TestDb: Database name is not 'shuriken_test', changing to 'shuriken_test' for safety"
                );
                needs_db_change = true;
            }

            // Rebuild URL if needed
            if needs_db_change {
                let base_url = &database_url[..=db_name_start];
                let new_db_name = if needs_db_change {
                    "shuriken_test"
                } else {
                    db_name
                };

                database_url = format!("{base_url}{new_db_name}{query_params}");
            }
        }

        let config = diesel_async::pooled_connection::AsyncDieselConnectionManager::<
            AsyncPgConnection,
        >::new(&database_url);

        let pool = diesel_async::pooled_connection::bb8::Pool::builder()
            .max_size(5)
            .build(config)
            .await?;

        Ok(Self {
            pool,
            _lock_guard: lock_guard,
        })
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
    /// Tables are truncated in reverse dependency order to avoid foreign key violations.
    /// This order must be maintained when adding new tables to the schema.
    ///
    /// ## Errors
    /// Returns an error if table truncation fails.
    ///
    /// ## Note
    /// If you add or remove tables from the schema, update this list accordingly.
    /// The order is: indexes → shadows/tombstones → parameters → properties → components →
    /// instances → entities → collections → groups/memberships → `auth_user` → users → principals → `casbin_rule`
    #[expect(dead_code)]
    pub async fn truncate_all(&self) -> anyhow::Result<()> {
        let mut conn = self.get_conn().await?;

        // Truncate all tables in a single statement with CASCADE to handle foreign keys
        // Tables are listed in reverse dependency order for clarity, though CASCADE handles dependencies
        diesel::sql_query(
            "TRUNCATE TABLE 
                card_phone,
                card_email,
                card_index,
                cal_occurrence,
                cal_index,
                dav_shadow,
                dav_tombstone,
                dav_parameter,
                dav_property,
                dav_component,
                dav_instance,
                dav_entity,
                dav_collection,
                membership,
                group_name,
                \"group\",
                auth_user,
                \"user\",
                principal,
                casbin_rule
            CASCADE",
        )
        .execute(&mut conn)
        .await?;

        Ok(())
    }

    /// Seeds a test principal and returns its ID.
    ///
    /// ## Errors
    /// Returns an error if the principal cannot be inserted.
    ///
    /// ## Note
    /// Uses UUID v7 for principal IDs to match production behavior (time-ordered).
    /// If you need deterministic test data, consider seeding with fixed data
    /// and retrieving IDs from the database after insertion.
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

    /// Seeds a test property for a component.
    ///
    /// ## Errors
    /// Returns an error if the property cannot be inserted.
    #[expect(dead_code)]
    pub async fn seed_property(
        &self,
        component_id: uuid::Uuid,
        name: &str,
        value_text: Option<&str>,
        ordinal: i32,
    ) -> anyhow::Result<uuid::Uuid> {
        use shuriken::component::db::schema::dav_property;
        use shuriken::component::model::dav::property::NewDavProperty;

        let mut conn = self.get_conn().await?;

        let new_property = NewDavProperty {
            component_id,
            name,
            value_type: "text",
            value_text,
            value_int: None,
            value_float: None,
            value_bool: None,
            value_date: None,
            value_tstz: None,
            value_bytes: None,
            value_json: None,
            ordinal,
        };

        let property_id = diesel::insert_into(dav_property::table)
            .values(&new_property)
            .returning(dav_property::id)
            .get_result::<uuid::Uuid>(&mut conn)
            .await?;

        Ok(property_id)
    }

    /// Seeds a test group and returns the group ID.
    ///
    /// ## Errors
    /// Returns an error if the group cannot be inserted.
    #[expect(dead_code)]
    pub async fn seed_group(&self, principal_id: uuid::Uuid) -> anyhow::Result<uuid::Uuid> {
        use shuriken::component::db::schema::group;
        use shuriken::component::model::group::NewGroup;

        let mut conn = self.get_conn().await?;

        let new_group = NewGroup {
            primary_name: None,
            principal_id,
        };

        let group_id = diesel::insert_into(group::table)
            .values(&new_group)
            .returning(group::id)
            .get_result::<uuid::Uuid>(&mut conn)
            .await?;

        Ok(group_id)
    }

    /// Seeds a group name for a group.
    ///
    /// ## Errors
    /// Returns an error if the group name cannot be inserted.
    #[expect(dead_code)]
    pub async fn seed_group_name(
        &self,
        group_id: uuid::Uuid,
        name: &str,
    ) -> anyhow::Result<uuid::Uuid> {
        use shuriken::component::db::schema::group_name;
        use shuriken::component::model::group::group_name::NewGroupName;

        let mut conn = self.get_conn().await?;

        let new_group_name = NewGroupName {
            group_id,
            name: name.to_string(),
        };

        let group_name_id = diesel::insert_into(group_name::table)
            .values(&new_group_name)
            .returning(group_name::id)
            .get_result::<uuid::Uuid>(&mut conn)
            .await?;

        Ok(group_name_id)
    }

    /// Seeds a membership linking a user to a group.
    ///
    /// ## Errors
    /// Returns an error if the membership cannot be inserted.
    ///
    /// ## Returns
    /// Returns a generated UUID for tracking purposes since membership uses composite primary key.
    #[expect(dead_code)]
    pub async fn seed_membership(
        &self,
        user_id: uuid::Uuid,
        group_id: uuid::Uuid,
    ) -> anyhow::Result<uuid::Uuid> {
        use shuriken::component::db::schema::membership;
        use shuriken::component::model::user::membership::NewMembership;

        let mut conn = self.get_conn().await?;

        let new_membership = NewMembership { user_id, group_id };

        diesel::insert_into(membership::table)
            .values(&new_membership)
            .execute(&mut conn)
            .await?;

        // Membership uses composite primary key (user_id, group_id),
        // return a generated UUID for test tracking purposes
        Ok(uuid::Uuid::now_v7())
    }

    /// Gets the current sync token for a collection.
    ///
    /// ## Errors
    /// Returns an error if the collection cannot be found.
    #[expect(dead_code)]
    pub async fn get_collection_synctoken(&self, collection_id: uuid::Uuid) -> anyhow::Result<i64> {
        use shuriken::component::db::schema::dav_collection;

        let mut conn = self.get_conn().await?;

        let synctoken = dav_collection::table
            .find(collection_id)
            .select(dav_collection::synctoken)
            .first::<i64>(&mut conn)
            .await?;

        Ok(synctoken)
    }

    /// Checks if a tombstone exists for a given collection and URI.
    ///
    /// ## Errors
    /// Returns an error if the database query fails.
    #[expect(dead_code)]
    pub async fn tombstone_exists(
        &self,
        collection_id: uuid::Uuid,
        uri: &str,
    ) -> anyhow::Result<bool> {
        use shuriken::component::db::schema::dav_tombstone;

        let mut conn = self.get_conn().await?;

        let count = dav_tombstone::table
            .filter(dav_tombstone::collection_id.eq(collection_id))
            .filter(dav_tombstone::uri.eq(uri))
            .count()
            .get_result::<i64>(&mut conn)
            .await?;

        Ok(count > 0)
    }

    /// Checks if an instance exists (not soft-deleted) at the given URI.
    ///
    /// ## Errors
    /// Returns an error if the database query fails.
    #[expect(dead_code)]
    pub async fn instance_exists(&self, uri: &str) -> anyhow::Result<bool> {
        use shuriken::component::db::schema::dav_instance;

        let mut conn = self.get_conn().await?;

        let count = dav_instance::table
            .filter(dav_instance::uri.eq(uri))
            .filter(dav_instance::deleted_at.is_null())
            .count()
            .get_result::<i64>(&mut conn)
            .await?;

        Ok(count > 0)
    }

    /// Gets an instance by URI.
    ///
    /// ## Errors
    /// Returns an error if the instance cannot be found.
    #[expect(dead_code)]
    pub async fn get_instance_by_uri(
        &self,
        uri: &str,
    ) -> anyhow::Result<Option<shuriken::component::model::dav::instance::DavInstance>> {
        use diesel::OptionalExtension;
        use shuriken::component::db::schema::dav_instance;
        use shuriken::component::model::dav::instance::DavInstance;

        let mut conn = self.get_conn().await?;

        let instance = dav_instance::table
            .filter(dav_instance::uri.eq(uri))
            .filter(dav_instance::deleted_at.is_null())
            .select(DavInstance::as_select())
            .first::<DavInstance>(&mut conn)
            .await
            .optional()?;

        Ok(instance)
    }

    /// Gets the collection by ID.
    ///
    /// ## Errors
    /// Returns an error if the collection cannot be found.
    #[expect(dead_code)]
    pub async fn get_collection(
        &self,
        collection_id: uuid::Uuid,
    ) -> anyhow::Result<Option<shuriken::component::model::dav::collection::DavCollection>> {
        use diesel::OptionalExtension;
        use shuriken::component::db::schema::dav_collection;
        use shuriken::component::model::dav::collection::DavCollection;

        let mut conn = self.get_conn().await?;

        let collection = dav_collection::table
            .find(collection_id)
            .select(DavCollection::as_select())
            .first::<DavCollection>(&mut conn)
            .await
            .optional()?;

        Ok(collection)
    }

    /// Counts the number of instances in a collection.
    ///
    /// ## Errors
    /// Returns an error if the database query fails.
    #[expect(dead_code)]
    pub async fn count_collection_instances(
        &self,
        collection_id: uuid::Uuid,
    ) -> anyhow::Result<i64> {
        use shuriken::component::db::schema::dav_instance;

        let mut conn = self.get_conn().await?;

        let count = dav_instance::table
            .filter(dav_instance::collection_id.eq(collection_id))
            .filter(dav_instance::deleted_at.is_null())
            .count()
            .get_result::<i64>(&mut conn)
            .await?;

        Ok(count)
    }
}

// ============================================================================
// Sample Data Generators
// ============================================================================

/// Sample iCalendar event for testing.
#[must_use]
pub fn sample_icalendar_event(uid: &str, summary: &str) -> String {
    format!(
        r"BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Shuriken//Test//EN
BEGIN:VEVENT
UID:{uid}
DTSTAMP:20260125T120000Z
DTSTART:20260126T100000Z
DTEND:20260126T110000Z
SUMMARY:{summary}
END:VEVENT
END:VCALENDAR
"
    )
}

/// Sample iCalendar event with RRULE for testing recurring events.
#[must_use]
pub fn sample_recurring_event(uid: &str, summary: &str, rrule: &str) -> String {
    format!(
        r"BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Shuriken//Test//EN
BEGIN:VEVENT
UID:{uid}
DTSTAMP:20260125T120000Z
DTSTART:20260126T100000Z
DTEND:20260126T110000Z
SUMMARY:{summary}
RRULE:{rrule}
END:VEVENT
END:VCALENDAR
"
    )
}

/// Sample vCard for testing.
#[must_use]
pub fn sample_vcard(uid: &str, fn_name: &str, email: &str) -> String {
    format!(
        r"BEGIN:VCARD
VERSION:4.0
UID:{uid}
FN:{fn_name}
EMAIL:{email}
END:VCARD
"
    )
}

/// Sample PROPFIND request body for allprop.
#[must_use]
pub fn propfind_allprop() -> &'static str {
    r#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:allprop/>
</D:propfind>"#
}

/// Sample PROPFIND request body for specific properties.
#[must_use]
pub fn propfind_props(props: &[(&str, &str)]) -> String {
    let prop_elements: String = props
        .iter()
        .map(|(ns, name)| {
            if *ns == "DAV:" {
                format!("    <D:{name}/>")
            } else {
                format!("    <x:{name} xmlns:x=\"{ns}\"/>")
            }
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
{prop_elements}
  </D:prop>
</D:propfind>"#
    )
}

/// Sample PROPPATCH request body for setting properties.
///
/// Props is a slice of (namespace, name, value) tuples.
#[must_use]
pub fn proppatch_set(props: &[(&str, &str, &str)]) -> String {
    let prop_elements: String = props
        .iter()
        .map(|(ns, name, value)| {
            if *ns == "DAV:" {
                format!("      <D:{name}>{value}</D:{name}>")
            } else {
                format!("      <x:{name} xmlns:x=\"{ns}\">{value}</x:{name}>")
            }
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:">
  <D:set>
    <D:prop>
{prop_elements}
    </D:prop>
  </D:set>
</D:propertyupdate>"#
    )
}

/// Sample PROPPATCH request body for removing a property.
#[must_use]
pub fn proppatch_remove(prop_name: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:">
  <D:remove>
    <D:prop>
      <D:{prop_name}/>
    </D:prop>
  </D:remove>
</D:propertyupdate>"#
    )
}

/// Sample MKCALENDAR request body.
#[must_use]
pub fn mkcalendar_body(displayname: &str, description: Option<&str>) -> String {
    let desc_element = description
        .map(|d| format!("<C:calendar-description>{d}</C:calendar-description>"))
        .unwrap_or_default();

    format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<C:mkcalendar xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <D:displayname>{displayname}</D:displayname>
      {desc_element}
    </D:prop>
  </D:set>
</C:mkcalendar>"#
    )
}

/// Sample Extended MKCOL request body for creating an addressbook.
#[must_use]
pub fn mkcol_addressbook_body(displayname: Option<&str>) -> String {
    let display_elem = displayname
        .map(|d| format!("      <D:displayname>{d}</D:displayname>"))
        .unwrap_or_default();

    format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<D:mkcol xmlns:D="DAV:" xmlns:CARD="urn:ietf:params:xml:ns:carddav">
  <D:set>
    <D:prop>
      <D:resourcetype>
        <D:collection/>
        <CARD:addressbook/>
      </D:resourcetype>
{display_elem}
    </D:prop>
  </D:set>
</D:mkcol>"#
    )
}

/// Sample calendar-query REPORT body (simple, no time-range).
#[must_use]
pub fn calendar_query_report() -> &'static str {
    r#"<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT"/>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>"#
}

/// Sample calendar-query REPORT body with time-range filter.
#[must_use]
pub fn calendar_query_report_with_range(start: &str, end: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="{start}" end="{end}"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>"#
    )
}

/// Sample calendar-multiget REPORT body.
#[must_use]
pub fn calendar_multiget_report(hrefs: &[String]) -> String {
    let href_elements: String = hrefs
        .iter()
        .map(|h| format!("  <D:href>{h}</D:href>"))
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<C:calendar-multiget xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
{href_elements}
</C:calendar-multiget>"#
    )
}

/// Sample addressbook-query REPORT body.
#[must_use]
pub fn addressbook_query_report() -> &'static str {
    r#"<?xml version="1.0" encoding="utf-8"?>
<CARD:addressbook-query xmlns:CARD="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <CARD:address-data/>
  </D:prop>
</CARD:addressbook-query>"#
}

/// Sample addressbook-query REPORT body with filter.
#[must_use]
pub fn addressbook_query_report_with_filter(prop_name: &str, text_match: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<CARD:addressbook-query xmlns:CARD="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <CARD:address-data/>
  </D:prop>
  <CARD:filter>
    <CARD:prop-filter name="{prop_name}">
      <CARD:text-match>{text_match}</CARD:text-match>
    </CARD:prop-filter>
  </CARD:filter>
</CARD:addressbook-query>"#
    )
}

/// Sample sync-collection REPORT body for initial sync (empty token).
#[must_use]
pub fn sync_collection_report_initial() -> &'static str {
    r#"<?xml version="1.0" encoding="utf-8"?>
<D:sync-collection xmlns:D="DAV:">
  <D:sync-token></D:sync-token>
  <D:sync-level>1</D:sync-level>
  <D:prop>
    <D:getetag/>
  </D:prop>
</D:sync-collection>"#
}

/// Sample sync-collection REPORT body with a specific sync token.
#[must_use]
pub fn sync_collection_report(sync_token: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<D:sync-collection xmlns:D="DAV:">
  <D:sync-token>{sync_token}</D:sync-token>
  <D:sync-level>1</D:sync-level>
  <D:prop>
    <D:getetag/>
  </D:prop>
</D:sync-collection>"#
    )
}

/// Sample addressbook-multiget REPORT body.
#[must_use]
pub fn addressbook_multiget_report(hrefs: &[String]) -> String {
    let href_elements: String = hrefs
        .iter()
        .map(|h| format!("  <D:href>{h}</D:href>"))
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<CARD:addressbook-multiget xmlns:CARD="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <CARD:address-data/>
  </D:prop>
{href_elements}
</CARD:addressbook-multiget>"#
    )
}
