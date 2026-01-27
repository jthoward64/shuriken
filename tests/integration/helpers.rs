#![allow(
    clippy::unused_async,
    clippy::expect_used,
    dead_code,
    clippy::too_many_arguments
)]
//! Test helpers for integration tests.
//!
//! Provides utilities for:
//! - Setting up isolated test databases (one per test)
//! - Creating test Salvo service
//! - Making HTTP requests
//! - Asserting on responses and database state
//!
//! ## Database Isolation
//! Each test gets its own unique database, created on demand and dropped automatically
//! when the TestDb goes out of scope using async drop. This allows tests to run in
//! parallel without contention.

use std::sync::{Arc, OnceLock};

use diesel::prelude::*;
use diesel_async::{AsyncPgConnection, RunQueryDsl};
use salvo::http::header::HeaderName;
use salvo::http::{Method, ReqBody, StatusCode};
use salvo::prelude::*;
use salvo::test::{RequestBuilder, ResponseExt, TestClient};
use shuriken::component::auth::casbin::CasbinEnforcerHandler;
use shuriken::component::auth::{ResourceLocation, ResourceType};
use shuriken::component::config::{Settings, load_config};
use shuriken::component::db::connection::{DbConnection, DbProviderHandler};

// ============================================================================
// Path Construction Helpers
// ============================================================================
//
// These helpers construct paths using ResourceLocation to ensure consistency
// with route constants. All path building goes through ResourceLocation.

/// Constructs a full CalDAV API path for a collection.
///
/// ## Example
/// ```ignore
/// caldav_collection_path("alice", "work") // => "/api/dav/cal/alice/work/"
/// ```
#[must_use]
pub fn caldav_collection_path(owner: &str, collection: &str) -> String {
    ResourceLocation::from_segments_collection(
        ResourceType::Calendar,
        owner.to_string(),
        collection,
    )
    .to_full_path()
}

/// Constructs a full CalDAV API path for an item.
///
/// ## Example
/// ```ignore
/// caldav_item_path("alice", "work", "event.ics") // => "/api/dav/cal/alice/work/event.ics"
/// ```
#[must_use]
pub fn caldav_item_path(owner: &str, collection: &str, item: &str) -> String {
    ResourceLocation::from_segments_item(
        ResourceType::Calendar,
        owner.to_string(),
        collection,
        item.to_string(),
    )
    .to_full_path()
}

/// Constructs a full CardDAV API path for a collection.
///
/// ## Example
/// ```ignore
/// carddav_collection_path("bob", "contacts") // => "/api/dav/card/bob/contacts/"
/// ```
#[must_use]
pub fn carddav_collection_path(owner: &str, collection: &str) -> String {
    ResourceLocation::from_segments_collection(
        ResourceType::Addressbook,
        owner.to_string(),
        collection,
    )
    .to_full_path()
}

/// Constructs a full CardDAV API path for an item.
///
/// ## Example
/// ```ignore
/// carddav_item_path("bob", "contacts", "john.vcf") // => "/api/dav/card/bob/contacts/john.vcf"
/// ```
#[must_use]
pub fn carddav_item_path(owner: &str, collection: &str, item: &str) -> String {
    ResourceLocation::from_segments_item(
        ResourceType::Addressbook,
        owner.to_string(),
        collection,
        item.to_string(),
    )
    .to_full_path()
}

/// Constructs a resource path for calendar resources (without DAV prefix).
///
/// ## Example
/// ```ignore
/// cal_path("alice", "work", Some("event.ics")) // => "/cal/alice/work/event.ics"
/// cal_path("alice", "work", None) // => "/cal/alice/work/"
/// ```
#[must_use]
pub fn cal_path(owner: &str, collection: &str, item: Option<&str>) -> String {
    if let Some(item) = item {
        ResourceLocation::from_segments_item(
            ResourceType::Calendar,
            owner.to_string(),
            collection,
            item.to_string(),
        )
        .to_resource_path()
    } else {
        ResourceLocation::from_segments_collection(
            ResourceType::Calendar,
            owner.to_string(),
            collection,
        )
        .to_resource_path()
    }
}

/// Constructs a resource path for addressbook resources (without DAV prefix).
///
/// ## Example
/// ```ignore
/// card_path("bob", "contacts", Some("john.vcf")) // => "/card/bob/contacts/john.vcf"
/// card_path("bob", "contacts", None) // => "/card/bob/contacts/"
/// ```
#[must_use]
pub fn card_path(owner: &str, collection: &str, item: Option<&str>) -> String {
    if let Some(item) = item {
        ResourceLocation::from_segments_item(
            ResourceType::Addressbook,
            owner.to_string(),
            collection,
            item.to_string(),
        )
        .to_resource_path()
    } else {
        ResourceLocation::from_segments_collection(
            ResourceType::Addressbook,
            owner.to_string(),
            collection,
        )
        .to_resource_path()
    }
}

/// Constructs a resource path for a calendar owner with glob (e.g., `/cal/alice/**`).
#[must_use]
pub fn cal_owner_glob(owner: &str, recursive: bool) -> String {
    ResourceLocation::from_segments_owner_glob(ResourceType::Calendar, owner.to_string(), recursive)
        .to_resource_path()
}

/// Constructs a resource path for a calendar collection with glob (e.g., `/cal/alice/work/**`).
#[must_use]
pub fn cal_collection_glob(owner: &str, collection: &str, recursive: bool) -> String {
    ResourceLocation::from_segments_collection_glob(
        ResourceType::Calendar,
        owner.to_string(),
        collection,
        recursive,
    )
    .to_resource_path()
}

/// Constructs a resource path for an addressbook owner with glob (e.g., `/card/bob/**`).
#[must_use]
pub fn card_owner_glob(owner: &str, recursive: bool) -> String {
    ResourceLocation::from_segments_owner_glob(
        ResourceType::Addressbook,
        owner.to_string(),
        recursive,
    )
    .to_resource_path()
}

/// Constructs a resource path for an addressbook collection with glob (e.g., `/card/bob/contacts/**`).
#[must_use]
pub fn card_collection_glob(owner: &str, collection: &str, recursive: bool) -> String {
    ResourceLocation::from_segments_collection_glob(
        ResourceType::Addressbook,
        owner.to_string(),
        collection,
        recursive,
    )
    .to_resource_path()
}

// ============================================================================

/// Static reference to shared test service (initialized once per test run)
static TEST_SERVICE: OnceLock<Service> = OnceLock::new();
static CONFIG_INIT: OnceLock<Settings> = OnceLock::new();

/// Base database URL for tests.
/// - CI (GitHub Actions): postgres on localhost:5432
/// - Local development: postgres on localhost:4524 (docker-compose test container)
fn get_base_database_url() -> String {
    // Check for explicit override first
    if let Ok(url) = std::env::var("TEST_DATABASE_URL") {
        return url;
    }

    // Check if running in CI (GitHub Actions sets this)
    if std::env::var("CI").is_ok() || std::env::var("GITHUB_ACTIONS").is_ok() {
        "postgres://shuriken:shuriken@localhost:5432".to_string()
    } else {
        // Local development - use docker-compose test container on port 4524
        "postgres://shuriken:shuriken@localhost:4524".to_string()
    }
}

/// Creates a test Salvo service instance for integration testing.
///
/// ## Summary
/// Returns a shared test service that includes all API routes.
/// The service is initialized once and reused across tests.
///
/// **Note**: This service does NOT include a database provider. Use
/// `create_fresh_auth_test_service()` for tests that need database access.
///
/// ## Panics
/// Panics if the service cannot be created.
#[expect(clippy::expect_used, reason = "Service creation failure is fatal")]
#[must_use]
pub fn create_test_service() -> &'static Service {
    TEST_SERVICE.get_or_init(|| {
        CONFIG_INIT.get_or_init(|| load_config().expect("Failed to load config for tests"));
        // Create the full router with all API routes
        let router =
            Router::new().push(shuriken::app::api::routes().expect("API routes should be valid"));
        Service::new(router)
    })
}

/// Creates a test service with database and casbin support.
///
/// This is the recommended service for integration tests that need full
/// database access. The service is created fresh each time to allow test
/// isolation (especially for casbin policies).
///
/// ## Parameters
/// - `database_url`: The connection URL for the test database
///
/// ## Panics
/// Panics if the service or enforcer cannot be created.
#[expect(clippy::expect_used, reason = "Service creation failure is fatal")]
pub async fn create_db_test_service(database_url: &str) -> Service {
    let config =
        CONFIG_INIT.get_or_init(|| load_config().expect("Failed to load config for tests"));

    // Create the database pool
    let pool = shuriken::component::db::connection::create_pool(
        database_url,
        u32::from(config.database.max_connections),
    )
    .await
    .expect("Failed to create database pool for test service");

    // Initialize Casbin enforcer - loads policies from current DB state
    let enforcer = shuriken::component::auth::casbin::init_casbin(pool.clone())
        .await
        .expect("Failed to initialize Casbin enforcer for tests");

    // Create router with all handlers (matching main.rs setup)
    // Note: AuthMiddleware is already included in routes() at the /api level
    let router = Router::new()
        .hoop(DbProviderHandler { provider: pool })
        .hoop(shuriken::component::config::ConfigHandler {
            settings: config.clone(),
        })
        .hoop(CasbinEnforcerHandler {
            enforcer: Arc::new(enforcer),
        })
        .push(shuriken::app::api::routes().expect("API routes should be valid"));

    Service::new(router)
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
/// ## Database Isolation
/// Each `TestDb` instance creates a unique database with a UUID-based name.
/// The database is automatically dropped when the TestDb is dropped via async drop.
/// This allows tests to run in parallel without contention.
#[expect(clippy::doc_markdown)]
pub struct TestDb {
    pool: diesel_async::pooled_connection::bb8::Pool<AsyncPgConnection>,
    /// The unique name of this test's database (for cleanup)
    db_name: String,
    /// Base URL without database name (for admin connections)
    base_url: String,
}

impl TestDb {
    /// Creates a new isolated test database.
    ///
    /// This creates a unique database for this test run, runs migrations on it,
    /// and returns a connection pool to that database.
    ///
    /// ## Errors
    /// Returns an error if:
    /// - Cannot connect to the postgres admin database
    /// - Cannot create the test database
    /// - Cannot run migrations
    ///
    /// ## Cleanup
    /// Call `cleanup()` when the test is done to drop the database.
    pub async fn new() -> anyhow::Result<Self> {
        let base_url = get_base_database_url();

        // Generate a unique database name using UUID
        let db_name = format!("shuriken_test_{}", uuid::Uuid::now_v7().simple());
        let database_url = format!("{base_url}/{db_name}");

        // Connect to the default postgres database to create our test database
        let admin_url = format!("{base_url}/postgres");
        let admin_config = diesel_async::pooled_connection::AsyncDieselConnectionManager::<
            AsyncPgConnection,
        >::new(&admin_url);
        let admin_pool = diesel_async::pooled_connection::bb8::Pool::builder()
            .max_size(1)
            .build(admin_config)
            .await?;

        // Create the test database
        {
            let mut admin_conn = admin_pool.get().await?;
            // Use format! since database names can't be parameterized in SQL
            let create_db_sql = format!("CREATE DATABASE \"{db_name}\"");
            diesel::sql_query(&create_db_sql)
                .execute(&mut admin_conn)
                .await?;
        }

        // Run migrations on the new database
        Self::run_migrations(&database_url).await?;

        // Create pool for the test database
        let config = diesel_async::pooled_connection::AsyncDieselConnectionManager::<
            AsyncPgConnection,
        >::new(&database_url);

        let pool = diesel_async::pooled_connection::bb8::Pool::builder()
            .max_size(5)
            .build(config)
            .await?;

        Ok(Self {
            pool,
            db_name,
            base_url,
        })
    }

    /// Runs diesel migrations on the given database URL.
    async fn run_migrations(database_url: &str) -> anyhow::Result<()> {
        use diesel_migrations::{EmbeddedMigrations, MigrationHarness, embed_migrations};

        const MIGRATIONS: EmbeddedMigrations = embed_migrations!("migrations");

        // Diesel migrations require a sync connection, so we run this in a blocking task
        let url = database_url.to_string();
        tokio::task::spawn_blocking(move || {
            let mut conn = diesel::PgConnection::establish(&url)?;
            conn.run_pending_migrations(MIGRATIONS)
                .map_err(|e| anyhow::anyhow!("Failed to run migrations: {e}"))?;
            Ok::<_, anyhow::Error>(())
        })
        .await??;

        Ok(())
    }

    /// Gets the database URL for this test database.
    #[must_use]
    pub fn url(&self) -> String {
        format!("{}/{}", self.base_url, self.db_name)
    }

    /// Gets a database connection from the pool.
    ///
    /// ## Errors
    /// Returns an error if a connection cannot be obtained from the pool.
    pub async fn get_conn(&self) -> anyhow::Result<DbConnection<'_>> {
        Ok(self.pool.get().await?)
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
    pub async fn seed_principal(
        &self,
        principal_type: &str,
        slug: &str,
        display_name: Option<&str>,
    ) -> anyhow::Result<uuid::Uuid> {
        use shuriken::component::db::schema::principal;
        use shuriken::component::model::principal::NewPrincipal;

        let mut conn = self.get_conn().await?;
        let principal_id = uuid::Uuid::now_v7();

        let new_principal = NewPrincipal {
            id: principal_id,
            principal_type,
            slug,
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
    pub async fn seed_collection(
        &self,
        owner_principal_id: uuid::Uuid,
        collection_type: &str,
        slug: &str,
        display_name: Option<&str>,
    ) -> anyhow::Result<uuid::Uuid> {
        use shuriken::component::db::schema::dav_collection;
        use shuriken::component::model::dav::collection::NewDavCollection;

        let mut conn = self.get_conn().await?;

        let new_collection = NewDavCollection {
            owner_principal_id,
            collection_type,
            slug,
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

    /// Seeds a child collection with a parent_collection_id and returns its ID.
    pub async fn seed_child_collection(
        &self,
        owner_principal_id: uuid::Uuid,
        collection_type: &str,
        slug: &str,
        display_name: Option<&str>,
        parent_collection_id: uuid::Uuid,
    ) -> anyhow::Result<uuid::Uuid> {
        use shuriken::component::db::schema::dav_collection;
        use shuriken::component::model::dav::collection::NewDavCollection;

        let mut conn = self.get_conn().await?;

        let new_collection = NewDavCollection {
            owner_principal_id,
            collection_type,
            slug,
            display_name,
            description: None,
            timezone_tzid: None,
        };

        let collection_id = diesel::insert_into(dav_collection::table)
            .values(&new_collection)
            .returning(dav_collection::id)
            .get_result::<uuid::Uuid>(&mut conn)
            .await?;

        diesel::update(dav_collection::table.filter(dav_collection::id.eq(collection_id)))
            .set(dav_collection::parent_collection_id.eq(parent_collection_id))
            .execute(&mut conn)
            .await?;

        Ok(collection_id)
    }

    /// Seeds a test entity with an optional logical UID and returns its ID.
    ///
    /// ## Errors
    /// Returns an error if the entity cannot be inserted.
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
    pub async fn seed_instance(
        &self,
        collection_id: uuid::Uuid,
        entity_id: uuid::Uuid,
        slug: &str,
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
            slug,
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
            group: None,
            value_type: "TEXT",
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

    /// Seeds a minimal valid iCalendar event for an entity.
    ///
    /// Creates a VCALENDAR component with VERSION and PRODID properties,
    /// and a VEVENT component with UID, DTSTART, DTEND, and SUMMARY.
    ///
    /// ## Errors
    /// Returns an error if any component or property cannot be inserted.
    pub async fn seed_minimal_icalendar_event(
        &self,
        entity_id: uuid::Uuid,
        uid: &str,
        summary: &str,
    ) -> anyhow::Result<()> {
        // Create VCALENDAR component (root)
        let vcalendar_id = self.seed_component(entity_id, None, "VCALENDAR", 0).await?;

        // Add VERSION property
        self.seed_property(vcalendar_id, "VERSION", Some("2.0"), 0)
            .await?;

        // Add PRODID property
        self.seed_property(vcalendar_id, "PRODID", Some("-//Test//Shuriken//EN"), 1)
            .await?;

        // Create VEVENT component (child of VCALENDAR)
        let vevent_id = self
            .seed_component(entity_id, Some(vcalendar_id), "VEVENT", 0)
            .await?;

        // Add UID property
        self.seed_property(vevent_id, "UID", Some(uid), 0).await?;

        // Add DTSTART property
        self.seed_property(vevent_id, "DTSTART", Some("20250101T100000Z"), 1)
            .await?;

        // Add DTEND property
        self.seed_property(vevent_id, "DTEND", Some("20250101T110000Z"), 2)
            .await?;

        // Add SUMMARY property
        self.seed_property(vevent_id, "SUMMARY", Some(summary), 3)
            .await?;

        Ok(())
    }

    /// Seeds a test group and returns the group ID.
    ///
    /// ## Errors
    /// Returns an error if the group cannot be inserted.
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
    pub async fn tombstone_exists(
        &self,
        collection_id: uuid::Uuid,
        uri: &str,
    ) -> anyhow::Result<bool> {
        use shuriken::component::db::schema::dav_tombstone;

        let mut conn = self.get_conn().await?;

        let count = dav_tombstone::table
            .filter(dav_tombstone::collection_id.eq(collection_id))
            .filter(dav_tombstone::uri_variants.contains(vec![Some(uri.to_string())]))
            .count()
            .get_result::<i64>(&mut conn)
            .await?;

        Ok(count > 0)
    }

    /// Checks if an instance exists (not soft-deleted) at the given URI.
    ///
    /// ## Errors
    /// Returns an error if the database query fails.
    pub async fn instance_exists(&self, uri: &str) -> anyhow::Result<bool> {
        use shuriken::component::db::schema::dav_instance;

        let mut conn = self.get_conn().await?;

        let count = dav_instance::table
            .filter(dav_instance::slug.eq(uri))
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
    pub async fn get_instance_by_uri(
        &self,
        uri: &str,
    ) -> anyhow::Result<Option<shuriken::component::model::dav::instance::DavInstance>> {
        use diesel::OptionalExtension;
        use shuriken::component::db::schema::dav_instance;
        use shuriken::component::model::dav::instance::DavInstance;

        let mut conn = self.get_conn().await?;

        let instance = dav_instance::table
            .filter(dav_instance::slug.eq(uri))
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

// ============================================================================
// Casbin Rule Seeding Helpers
// ============================================================================

use std::sync::atomic::{AtomicI32, Ordering};

/// Atomic counter for generating casbin rule IDs in tests.
static CASBIN_RULE_ID: AtomicI32 = AtomicI32::new(1);

/// Gets the next casbin rule ID for test seeding.
fn next_casbin_rule_id() -> i32 {
    CASBIN_RULE_ID.fetch_add(1, Ordering::Relaxed)
}

impl TestDb {
    /// Seeds a casbin policy rule (p, role, `obj_type`, act).
    ///
    /// Example: `seed_policy("read", "calendar_event", "read")` allows read action
    /// if subject has at least "read" role on a `calendar_event`.
    ///
    /// ## Errors
    /// Returns an error if the rule cannot be inserted.
    pub async fn seed_policy(&self, role: &str, obj_type: &str, act: &str) -> anyhow::Result<()> {
        use shuriken::component::db::schema::casbin_rule;

        let mut conn = self.get_conn().await?;

        diesel::insert_into(casbin_rule::table)
            .values((
                casbin_rule::id.eq(next_casbin_rule_id()),
                casbin_rule::ptype.eq("p"),
                casbin_rule::v0.eq(role),
                casbin_rule::v1.eq(obj_type),
                casbin_rule::v2.eq(act),
                casbin_rule::v3.eq(""),
                casbin_rule::v4.eq(""),
                casbin_rule::v5.eq(""),
            ))
            .execute(&mut conn)
            .await?;

        Ok(())
    }

    /// Seeds a casbin grouping rule g(principal, resource, role) for sharing.
    ///
    /// Example: `seed_grant("user:alice", "cal:uuid", "owner")` grants alice owner role on the calendar.
    ///
    /// ## Errors
    /// Returns an error if the rule cannot be inserted.
    pub async fn seed_grant(
        &self,
        principal: &str,
        resource: &str,
        role: &str,
    ) -> anyhow::Result<()> {
        use shuriken::component::db::schema::casbin_rule;

        let mut conn = self.get_conn().await?;

        diesel::insert_into(casbin_rule::table)
            .values((
                casbin_rule::id.eq(next_casbin_rule_id()),
                casbin_rule::ptype.eq("g"),
                casbin_rule::v0.eq(principal),
                casbin_rule::v1.eq(resource),
                casbin_rule::v2.eq(role),
                casbin_rule::v3.eq(""),
                casbin_rule::v4.eq(""),
                casbin_rule::v5.eq(""),
            ))
            .execute(&mut conn)
            .await?;

        Ok(())
    }

    /// Seeds a casbin g2 rule (resource, type) for resource typing.
    ///
    /// Example: `seed_resource_type("cal:uuid", "calendar")` types the resource as a calendar.
    ///
    /// ## Errors
    /// Returns an error if the rule cannot be inserted.
    pub async fn seed_resource_type(
        &self,
        resource: &str,
        resource_type: &str,
    ) -> anyhow::Result<()> {
        use shuriken::component::db::schema::casbin_rule;

        let mut conn = self.get_conn().await?;

        diesel::insert_into(casbin_rule::table)
            .values((
                casbin_rule::id.eq(next_casbin_rule_id()),
                casbin_rule::ptype.eq("g2"),
                casbin_rule::v0.eq(resource),
                casbin_rule::v1.eq(resource_type),
                casbin_rule::v2.eq(""),
                casbin_rule::v3.eq(""),
                casbin_rule::v4.eq(""),
                casbin_rule::v5.eq(""),
            ))
            .execute(&mut conn)
            .await?;

        Ok(())
    }

    /// Seeds a casbin g4 rule (child, parent) for containment.
    ///
    /// Example: `seed_containment("evt:uuid", "cal:uuid")` indicates the event is in the calendar.
    ///
    /// ## Errors
    /// Returns an error if the rule cannot be inserted.
    pub async fn seed_containment(&self, child: &str, parent: &str) -> anyhow::Result<()> {
        use shuriken::component::db::schema::casbin_rule;

        let mut conn = self.get_conn().await?;

        diesel::insert_into(casbin_rule::table)
            .values((
                casbin_rule::id.eq(next_casbin_rule_id()),
                casbin_rule::ptype.eq("g4"),
                casbin_rule::v0.eq(child),
                casbin_rule::v1.eq(parent),
                casbin_rule::v2.eq(""),
                casbin_rule::v3.eq(""),
                casbin_rule::v4.eq(""),
                casbin_rule::v5.eq(""),
            ))
            .execute(&mut conn)
            .await?;

        Ok(())
    }

    /// Seeds a casbin g5 rule (higher, lower) for role hierarchy.
    ///
    /// Example: `seed_role_hierarchy("owner", "admin")` means owner implies admin.
    ///
    /// ## Errors
    /// Returns an error if the rule cannot be inserted.
    pub async fn seed_role_hierarchy(&self, higher: &str, lower: &str) -> anyhow::Result<()> {
        use shuriken::component::db::schema::casbin_rule;

        let mut conn = self.get_conn().await?;

        diesel::insert_into(casbin_rule::table)
            .values((
                casbin_rule::id.eq(next_casbin_rule_id()),
                casbin_rule::ptype.eq("g5"),
                casbin_rule::v0.eq(higher),
                casbin_rule::v1.eq(lower),
                casbin_rule::v2.eq(""),
                casbin_rule::v3.eq(""),
                casbin_rule::v4.eq(""),
                casbin_rule::v5.eq(""),
            ))
            .execute(&mut conn)
            .await?;

        Ok(())
    }

    /// Seeds default policies and role hierarchy for testing.
    ///
    /// This sets up the basic permission model so tests can just seed grants.
    ///
    /// ## Errors
    /// Returns an error if seeding fails.
    pub async fn seed_default_policies(&self) -> anyhow::Result<()> {
        // Role hierarchy: owner > admin > edit-share > edit > read-share > read > read-freebusy
        self.seed_role_hierarchy("owner", "admin").await?;
        self.seed_role_hierarchy("admin", "edit-share").await?;
        self.seed_role_hierarchy("edit-share", "edit").await?;
        self.seed_role_hierarchy("edit", "read-share").await?;
        self.seed_role_hierarchy("read-share", "read").await?;
        self.seed_role_hierarchy("read", "read-freebusy").await?;

        // Policies: what role is required for each action on each type
        // Calendar
        self.seed_policy("read", "calendar", "read").await?;
        self.seed_policy("edit", "calendar", "write").await?;
        self.seed_policy("read-freebusy", "calendar", "read_freebusy")
            .await?;

        // Calendar event
        self.seed_policy("read", "calendar_event", "read").await?;
        self.seed_policy("edit", "calendar_event", "write").await?;
        self.seed_policy("read-freebusy", "calendar_event", "read_freebusy")
            .await?;

        // Addressbook
        self.seed_policy("read", "addressbook", "read").await?;
        self.seed_policy("edit", "addressbook", "write").await?;

        // Vcard
        self.seed_policy("read", "vcard", "read").await?;
        self.seed_policy("edit", "vcard", "write").await?;

        Ok(())
    }
}
impl Drop for TestDb {
    fn drop(&mut self) {
        // AsyncDrop will handle cleanup, nothing to do here
    }
}

impl std::future::AsyncDrop for TestDb {
    async fn drop(self: std::pin::Pin<&mut Self>) {
        let db_name = self.db_name.clone();
        let base_url = self.base_url.clone();

        // Small delay to ensure connections are fully released
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        eprintln!("[AsyncDrop] Cleaning up database: {}", db_name);

        // Connect to admin database to drop the test database
        let admin_url = format!("{}/postgres", base_url);
        let admin_config = diesel_async::pooled_connection::AsyncDieselConnectionManager::<
            AsyncPgConnection,
        >::new(&admin_url);

        match diesel_async::pooled_connection::bb8::Pool::builder()
            .max_size(1)
            .build(admin_config)
            .await
        {
            Ok(admin_pool) => {
                match admin_pool.get().await {
                    Ok(mut admin_conn) => {
                        eprintln!("[AsyncDrop] Got admin connection for {}", db_name);

                        // Force disconnect any remaining connections
                        let terminate_sql = format!(
                            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{}'",
                            db_name
                        );
                        match diesel::sql_query(&terminate_sql)
                            .execute(&mut admin_conn)
                            .await
                        {
                            Ok(count) => eprintln!("[AsyncDrop] Terminated {} connections", count),
                            Err(e) => {
                                eprintln!("[AsyncDrop] Failed to terminate connections: {}", e)
                            }
                        }

                        // Drop the database
                        let drop_db_sql =
                            format!("DROP DATABASE IF EXISTS \"{}\" WITH (FORCE)", db_name);
                        match diesel::sql_query(&drop_db_sql)
                            .execute(&mut admin_conn)
                            .await
                        {
                            Ok(_) => {
                                eprintln!("[AsyncDrop] Successfully dropped database: {}", db_name)
                            }
                            Err(e) => {
                                eprintln!("[AsyncDrop] Failed to drop database {}: {}", db_name, e)
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("[AsyncDrop] Failed to get admin connection: {}", e);
                    }
                }
            }
            Err(e) => {
                eprintln!("[AsyncDrop] Failed to create admin pool: {}", e);
            }
        }
    }
}
