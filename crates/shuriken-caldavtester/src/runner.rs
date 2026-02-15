//! Test execution engine.
//!
//! Orchestrates test execution, HTTP requests, and verification.

use crate::context::TestContext;
use crate::error::{Error, Result};
use crate::verification::{verify_response, Response, VerifyResult};
use crate::xml::{AuthConfig, CalDavTest, RequestBody, Test, TestRequest, TestSuite};
use base64::Engine;
use reqwest::Client;
use salvo::http::header::{HeaderName, AUTHORIZATION};
use salvo::http::{Method as SalvoMethod, ReqBody, StatusCode};
use salvo::test::{RequestBuilder, ResponseExt};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tracing::{debug, error, info, warn};

/// Test execution results
#[derive(Debug, Clone, Default)]
pub struct TestResults {
    pub passed: usize,
    pub failed: usize,
    pub ignored: usize,
    /// Per-test failure messages for reporting
    pub failures: Vec<TestFailure>,
}

/// A single test failure record
#[derive(Debug, Clone)]
pub struct TestFailure {
    pub suite: String,
    pub test: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum TestOutcome {
    Passed,
    Ignored,
    Failed(String),
}

impl TestResults {
    /// Add results from another test run
    pub fn add(&mut self, other: &Self) {
        self.passed += other.passed;
        self.failed += other.failed;
        self.ignored += other.ignored;
        self.failures.extend(other.failures.iter().cloned());
    }

    /// Check if all tests passed
    #[must_use]
    pub const fn all_passed(&self) -> bool {
        self.failed == 0
    }

    /// Total number of tests
    #[must_use]
    pub const fn total(&self) -> usize {
        self.passed + self.failed + self.ignored
    }
}

impl std::fmt::Display for TestResults {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{} passed, {} failed, {} ignored (total {})",
            self.passed,
            self.failed,
            self.ignored,
            self.total()
        )
    }
}

/// Configuration for connecting to the server under test
#[derive(Debug, Clone)]
pub struct ServerConfig {
    /// Base URL of the server (e.g., `http://localhost:8080`)
    pub base_url: String,
    /// Base directory for resolving resource file paths
    pub resource_dir: PathBuf,
    /// Set of features enabled on the server
    pub features: std::collections::HashSet<String>,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            base_url: "http://localhost:8080".to_string(),
            resource_dir: PathBuf::from("crates/shuriken-caldavtester/test-suite"),
            features: std::collections::HashSet::new(),
        }
    }
}

/// Test runner that executes CalDAV test files against a server.
pub struct TestRunner {
    client: Client,
    context: TestContext,
    config: ServerConfig,
    in_process_service: Option<Arc<salvo::Service>>,
    /// Resources to DELETE in cleanup (from `end-delete="yes"`)
    end_deletes: Vec<String>,
}

impl TestRunner {
    /// ## Summary
    /// Create a new test runner with the given server configuration.
    ///
    /// ## Errors
    /// Returns an error if the HTTP client cannot be built.
    pub fn with_config(config: ServerConfig) -> Result<Self> {
        let client = Client::builder()
            .cookie_store(true)
            .danger_accept_invalid_certs(true)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(Error::HttpRequest)?;

        let context = TestContext::new();

        Ok(Self {
            client,
            context,
            config,
            in_process_service: None,
            end_deletes: Vec::new(),
        })
    }

    /// ## Summary
    /// Create a runner that executes requests against an in-process Salvo service.
    ///
    /// ## Errors
    /// Returns an error if the HTTP client cannot be built.
    pub fn with_in_process_service(
        config: ServerConfig,
        service: Arc<salvo::Service>,
    ) -> Result<Self> {
        let mut runner = Self::with_config(config)?;
        runner.in_process_service = Some(service);
        Ok(runner)
    }

    /// ## Summary
    /// Create a test runner pointing at `localhost:8080` with defaults.
    ///
    /// ## Errors
    /// Returns an error if the HTTP client cannot be built.
    pub fn new() -> Result<Self> {
        Self::with_config(ServerConfig::default())
    }

    /// ## Summary
    /// Run a test file and return results.
    ///
    /// ## Errors
    /// Returns an error if the test file cannot be parsed.
    pub async fn run_test_file(&mut self, path: impl AsRef<Path>) -> Result<TestResults> {
        let path = path.as_ref();

        if !path.exists() {
            return Err(Error::TestFileNotFound(path.to_path_buf()));
        }

        info!(file = %path.display(), "Running test file");

        let test_def = crate::xml::parse_test_file(path)?;

        info!(
            description = test_def.description.as_deref().unwrap_or(""),
            suites = test_def.test_suites.len(),
            "Parsed test file"
        );

        self.run_caldav_test(&test_def).await
    }

    /// Execute a parsed CalDAV test definition.
    async fn run_caldav_test(&mut self, test: &CalDavTest) -> Result<TestResults> {
        let mut results = TestResults::default();

        // Check feature requirements at the file level
        if let Some(missing) = self.missing_features(&test.require_features) {
            info!(missing = %missing, "Test file skipped — missing features");
            results.ignored += 1;
            return Ok(results);
        }
        if let Some(excluded) = self.has_excluded_features(&test.exclude_features) {
            info!(excluded = %excluded, "Test file skipped — excluded features");
            results.ignored += 1;
            return Ok(results);
        }

        // Execute start requests
        self.end_deletes.clear();
        for request in &test.start_requests {
            if let Err(e) = self.execute_request(request).await {
                error!(error = %e, "Start request failed");
                results.failed += 1;
                results.failures.push(TestFailure {
                    suite: "START".to_string(),
                    test: "start-request".to_string(),
                    message: e.to_string(),
                });
                return Ok(results);
            }
        }

        // Execute test suites
        for suite in &test.test_suites {
            let suite_results = self.run_test_suite(suite).await;
            results.add(&suite_results);
        }

        // Execute end-delete cleanup
        for ruri in self.end_deletes.clone() {
            let delete_req = TestRequest {
                method: "DELETE".to_string(),
                ruri: Some(ruri),
                headers: HashMap::new(),
                body: None,
                auth: None,
                verifications: Vec::new(),
                grab_headers: Vec::new(),
                end_delete: false,
            };
            if let Err(e) = self.execute_request(&delete_req).await {
                debug!(error = %e, "End-delete request failed (non-fatal)");
            }
        }

        // Execute end requests
        for request in &test.end_requests {
            if let Err(e) = self.execute_request(request).await {
                warn!(error = %e, "End request failed");
            }
        }

        Ok(results)
    }

    /// Execute a single test suite.
    async fn run_test_suite(&mut self, suite: &TestSuite) -> TestResults {
        let mut results = TestResults::default();

        if suite.ignore {
            info!(suite = %suite.name, "Suite skipped — ignored");
            results.ignored += suite.tests.len();
            return results;
        }
        if let Some(missing) = self.missing_features(&suite.require_features) {
            info!(suite = %suite.name, missing = %missing, "Suite skipped — missing features");
            results.ignored += suite.tests.len();
            return results;
        }
        if let Some(excluded) = self.has_excluded_features(&suite.exclude_features) {
            info!(suite = %suite.name, excluded = %excluded, "Suite skipped — excluded features");
            results.ignored += suite.tests.len();
            return results;
        }

        info!(suite = %suite.name, tests = suite.tests.len(), "Running suite");

        for test in &suite.tests {
            match self.run_test(test).await {
                Ok(TestOutcome::Passed) => {
                    debug!(suite = %suite.name, test = %test.name, "PASS");
                    results.passed += 1;
                }
                Ok(TestOutcome::Ignored) => {
                    debug!(suite = %suite.name, test = %test.name, "IGNORED");
                    results.ignored += 1;
                }
                Ok(TestOutcome::Failed(message)) => {
                    warn!(suite = %suite.name, test = %test.name, message = %message, "FAIL");
                    results.failed += 1;
                    results.failures.push(TestFailure {
                        suite: suite.name.clone(),
                        test: test.name.clone(),
                        message,
                    });
                }
                Err(e) => {
                    warn!(suite = %suite.name, test = %test.name, error = %e, "ERROR");
                    results.failed += 1;
                    results.failures.push(TestFailure {
                        suite: suite.name.clone(),
                        test: test.name.clone(),
                        message: e.to_string(),
                    });
                }
            }
        }

        info!(
            suite = %suite.name,
            passed = results.passed,
            failed = results.failed,
            ignored = results.ignored,
            "Suite complete"
        );
        results
    }

    /// Execute a single test.
    ///
    /// Returns [`TestOutcome::Passed`] on success, [`TestOutcome::Ignored`]
    /// when skipped by flags/features, and [`TestOutcome::Failed`] for
    /// verifier-level failures.
    async fn run_test(&mut self, test: &Test) -> Result<TestOutcome> {
        if test.ignore {
            debug!(test = %test.name, "Test skipped — ignored");
            return Ok(TestOutcome::Ignored);
        }
        if let Some(missing) = self.missing_features(&test.require_features) {
            debug!(test = %test.name, missing = %missing, "Test skipped — missing features");
            return Ok(TestOutcome::Ignored);
        }
        if let Some(excluded) = self.has_excluded_features(&test.exclude_features) {
            debug!(test = %test.name, excluded = %excluded, "Test skipped — excluded features");
            return Ok(TestOutcome::Ignored);
        }

        debug!(
            test = %test.name,
            desc = test.description.as_deref().unwrap_or(""),
            requests = test.requests.len(),
            "Running test"
        );

        for (i, request) in test.requests.iter().enumerate() {
            let response = self.execute_request(request).await?;

            // Run verifications
            for verification in &request.verifications {
                let substituted_args: HashMap<String, Vec<String>> = verification
                    .args
                    .iter()
                    .map(|(k, values)| {
                        (
                            k.clone(),
                            values.iter().map(|v| self.context.substitute(v)).collect(),
                        )
                    })
                    .collect();

                let result =
                    match verify_response(&response, &verification.callback, &substituted_args) {
                        Ok(result) => result,
                        Err(err) => {
                            let message = format!(
                                "request #{i} verifier '{}' errored: {err}",
                                verification.callback
                            );
                            return Ok(TestOutcome::Failed(message));
                        }
                    };

                if let VerifyResult::Fail(msg) = &result {
                    let message = format!(
                        "request #{i} verifier '{}' failed: {msg}",
                        verification.callback
                    );
                    return Ok(TestOutcome::Failed(message));
                }
            }

            // Capture grab-headers
            for grab in &request.grab_headers {
                let header_lower = grab.name.to_lowercase();
                if let Some(value) = response
                    .headers
                    .iter()
                    .find(|(k, _)| k.to_lowercase() == header_lower)
                    .map(|(_, v)| v.clone())
                {
                    self.context.set(&grab.variable, &value);
                }
            }

            // Track end-deletes
            if request.end_delete {
                if let Some(ruri) = &request.ruri {
                    let resolved = self.context.substitute(ruri);
                    self.end_deletes.push(resolved);
                }
            }
        }

        Ok(TestOutcome::Passed)
    }

    /// Execute an HTTP request and return the response.
    async fn execute_request(&self, request: &TestRequest) -> Result<Response> {
        if let Some(service) = &self.in_process_service {
            return self.execute_request_in_process(request, service).await;
        }

        self.execute_request_network(request).await
    }

    async fn execute_request_network(&self, request: &TestRequest) -> Result<Response> {
        let url = match &request.ruri {
            Some(ruri) => {
                let target = self.context.substitute(ruri);
                if let Ok(absolute) = reqwest::Url::parse(&target) {
                    absolute.to_string()
                } else {
                    let normalized = normalize_in_process_target(&target);
                    let rewritten = rewrite_apple_dav_path(&normalized);
                    format!("{}{rewritten}", self.config.base_url)
                }
            }
            None => self.config.base_url.clone(),
        };

        let method = map_method(&request.method)?;

        debug!(method = %request.method, url = %url, "HTTP request");

        let mut req_builder = self.client.request(method, &url);

        // Add headers
        for (name, value) in &request.headers {
            let value_subst = self.context.substitute(value);
            req_builder = req_builder.header(name.as_str(), value_subst);
        }

        // Apply authentication
        match &request.auth {
            Some(AuthConfig::None) => {
                // auth="no" → send without authentication
            }
            Some(AuthConfig::Basic { user, password }) => {
                let user = self.context.substitute(user);
                let password = self.context.substitute(password);
                req_builder = req_builder.basic_auth(user, Some(password));
            }
            None => {
                // Default credentials can be overridden via env vars, and align
                // with seeded caldavtester fixtures (`password`).
                let (user, password) = default_basic_credentials(&self.context);
                req_builder = req_builder.basic_auth(user, Some(password));
            }
        }

        // Add body if present
        if let Some(body) = &request.body {
            let (content_type, resolved_body) = self.resolve_request_body(body)?;
            req_builder = req_builder.header("Content-Type", content_type);
            if let Some(data) = resolved_body {
                req_builder = req_builder.body(data);
            }
        }

        // Execute
        let resp = req_builder.send().await?;
        let status = resp.status().as_u16();
        let headers: HashMap<String, String> = resp
            .headers()
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
            .collect();
        let body = resp.text().await.unwrap_or_default();

        debug!(status, body_len = body.len(), "HTTP response");

        Ok(Response {
            status,
            headers,
            body,
        })
    }

    async fn execute_request_in_process(
        &self,
        request: &TestRequest,
        service: &salvo::Service,
    ) -> Result<Response> {
        let request_target = request
            .ruri
            .as_deref()
            .map_or_else(|| "/".to_string(), |ruri| self.context.substitute(ruri));
        let normalized_path = normalize_in_process_target(&request_target);
        let rewritten_path = rewrite_apple_dav_path(&normalized_path);
        let url = format!("http://127.0.0.1:5800{rewritten_path}");

        let method =
            SalvoMethod::from_bytes(request.method.as_bytes()).map_err(Error::InvalidMethod)?;
        debug!(method = %request.method, url = %url, "HTTP request (in-process)");

        let mut req_builder = RequestBuilder::new(&url, method);

        for (name, value) in &request.headers {
            let value_subst = self.context.substitute(value);
            if let Ok(header_name) = HeaderName::try_from(name.as_str()) {
                req_builder = req_builder.add_header(header_name, value_subst, true);
            }
        }

        match &request.auth {
            Some(AuthConfig::None) => {}
            Some(AuthConfig::Basic { user, password }) => {
                let user = self.context.substitute(user);
                let password = self.context.substitute(password);
                req_builder = req_builder.add_header(
                    AUTHORIZATION,
                    basic_auth_header(&user, &password),
                    true,
                );
            }
            None => {
                let (user, password) = default_basic_credentials(&self.context);
                req_builder = req_builder.add_header(
                    AUTHORIZATION,
                    basic_auth_header(&user, &password),
                    true,
                );
            }
        }

        if let Some(body) = &request.body {
            let (content_type, resolved_body) = self.resolve_request_body(body)?;
            req_builder = req_builder.add_header("Content-Type", content_type, true);
            if let Some(data) = resolved_body {
                req_builder = req_builder.body(ReqBody::Once(data.into()));
            }
        }

        let mut response = req_builder.send(service).await;
        let status = u16::from(
            response
                .status_code
                .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
        );
        let headers = response
            .headers()
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
            .collect();
        let body_bytes = response.take_bytes(None).await.unwrap_or_default().to_vec();
        let body = String::from_utf8_lossy(&body_bytes).into_owned();

        debug!(status, body_len = body.len(), "HTTP response (in-process)");

        Ok(Response {
            status,
            headers,
            body,
        })
    }

    fn resolve_request_body(&self, body: &RequestBody) -> Result<(String, Option<Vec<u8>>)> {
        match body {
            RequestBody::File {
                path,
                content_type,
                substitutions,
            } => {
                let full_path = self.config.resource_dir.join(path);
                if !full_path.exists() {
                    debug!(path = %full_path.display(), "Resource file not found – sending empty body");
                    return Ok((content_type.clone(), None));
                }

                let mut data = std::fs::read_to_string(&full_path).map_err(|e| {
                    Error::Other(format!(
                        "Failed to read resource file {}: {e}",
                        full_path.display()
                    ))
                })?;

                for (name, value) in substitutions {
                    let resolved_value = self.context.substitute(value);
                    data = data.replace(name, &resolved_value);
                }

                let data = self.context.substitute(&data);
                Ok((content_type.clone(), Some(data.into_bytes())))
            }
            RequestBody::Inline {
                content,
                content_type,
                substitutions,
            } => {
                let mut data = content.clone();
                for (name, value) in substitutions {
                    let resolved_value = self.context.substitute(value);
                    data = data.replace(name, &resolved_value);
                }
                let data = self.context.substitute(&data);
                Ok((content_type.clone(), Some(data.into_bytes())))
            }
        }
    }

    // ── Feature helpers ──────────────────────────────────────────────────

    /// If any required feature is missing, return the first one.
    fn missing_features(&self, required: &[String]) -> Option<String> {
        for f in required {
            if !self.config.features.contains(f) {
                return Some(f.clone());
            }
        }
        None
    }

    /// If any excluded feature is present, return the first one.
    fn has_excluded_features(&self, excluded: &[String]) -> Option<String> {
        for f in excluded {
            if self.config.features.contains(f) {
                return Some(f.clone());
            }
        }
        None
    }
}

/// Map a test-suite method string to a `reqwest::Method`.
fn map_method(method: &str) -> Result<reqwest::Method> {
    match method {
        "GET" => Ok(reqwest::Method::GET),
        "PUT" => Ok(reqwest::Method::PUT),
        "POST" => Ok(reqwest::Method::POST),
        "DELETE" => Ok(reqwest::Method::DELETE),
        "HEAD" => Ok(reqwest::Method::HEAD),
        "OPTIONS" => Ok(reqwest::Method::OPTIONS),
        "PATCH" => Ok(reqwest::Method::PATCH),
        // WebDAV methods
        other => reqwest::Method::from_bytes(other.as_bytes()).map_err(Error::InvalidMethod),
    }
}

fn basic_auth_header(user: &str, password: &str) -> String {
    let credentials = format!("{user}:{password}");
    let encoded = base64::engine::general_purpose::STANDARD.encode(credentials);
    format!("Basic {encoded}")
}

fn normalize_in_process_target(target: &str) -> String {
    if let Ok(url) = reqwest::Url::parse(target) {
        let mut path = url.path().to_string();
        if path.is_empty() {
            path.push('/');
        }
        if let Some(query) = url.query() {
            path.push('?');
            path.push_str(query);
        }
        return path;
    }

    if target.starts_with('/') {
        target.to_string()
    } else {
        format!("/{target}")
    }
}

fn default_basic_credentials(context: &TestContext) -> (String, String) {
    let user = context
        .get("$userid1:")
        .map(str::to_string)
        .or_else(|| std::env::var("CALDAV_TEST_DEFAULT_USER").ok())
        .unwrap_or_else(|| "user01".to_string());

    let password = context
        .get("$pswd1:")
        .map(str::to_string)
        .or_else(|| std::env::var("CALDAV_TEST_DEFAULT_PASSWORD").ok())
        .unwrap_or_else(|| "password".to_string());

    (user, password)
}

fn rewrite_apple_dav_path(target: &str) -> String {
    let (path, query) = match target.split_once('?') {
        Some((path, query)) => (path, Some(query)),
        None => (target, None),
    };

    let rewritten_path = if path == "/.well-known/caldav" || path == "/.well-known/caldav/" {
        "/api/dav/cal/".to_string()
    } else if path == "/.well-known/carddav" || path == "/.well-known/carddav/" {
        "/api/dav/card/".to_string()
    } else if path == "/dav/calendars" || path == "/dav/calendars/" {
        "/api/dav/cal/".to_string()
    } else if path == "/dav/addressbooks" || path == "/dav/addressbooks/" {
        "/api/dav/card/".to_string()
    } else if path == "/dav/principals" || path == "/dav/principals/" {
        "/api/dav/principal/".to_string()
    } else if let Some(rest) = path.strip_prefix("/dav/calendars/") {
        format!("/api/dav/cal/{rest}")
    } else if let Some(rest) = path.strip_prefix("/dav/addressbooks/") {
        format!("/api/dav/card/{rest}")
    } else if let Some(rest) = path.strip_prefix("/dav/principals/") {
        let rest = rest
            .strip_prefix("users/")
            .or_else(|| rest.strip_prefix("groups/"))
            .unwrap_or(rest);
        format!("/api/dav/principal/{rest}")
    } else if path == "/dav" || path == "/dav/" {
        "/api/dav/".to_string()
    } else {
        path.to_string()
    };

    let rewritten_path = rewrite_home_aliases(&rewritten_path);

    if let Some(query) = query {
        format!("{rewritten_path}?{query}")
    } else {
        rewritten_path
    }
}

fn rewrite_home_aliases(path: &str) -> String {
    let default_user = std::env::var("CALDAV_TEST_DEFAULT_USER")
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "user01".to_string());

    if path == "/api/dav/principal/" || path == "/api/dav/principal" {
        return format!("/api/dav/principal/{default_user}/");
    }

    if path == "/api/dav/cal/" || path == "/api/dav/cal" {
        return format!("/api/dav/cal/{default_user}/calendar/");
    }

    if path == "/api/dav/card/" || path == "/api/dav/card" {
        return format!("/api/dav/card/{default_user}/addressbook/");
    }

    if let Some(rest) = path.strip_prefix("/api/dav/cal/users/") {
        return rewrite_user_hierarchy(rest, "cal");
    }

    if let Some(rest) = path.strip_prefix("/api/dav/card/users/") {
        return rewrite_user_hierarchy(rest, "card");
    }

    if let Some(rest) = path.strip_prefix("/api/dav/cal/__uids__/") {
        return rewrite_user_hierarchy(rest, "cal");
    }

    if let Some(rest) = path.strip_prefix("/api/dav/card/__uids__/") {
        return rewrite_user_hierarchy(rest, "card");
    }

    if let Some(rest) = path.strip_prefix("/api/dav/cal/") {
        let parts: Vec<&str> = rest.trim_matches('/').split('/').collect();
        if parts.len() == 1 && !parts[0].is_empty() {
            return format!("/api/dav/cal/{}/calendar/", parts[0]);
        }
        if parts.len() == 2 && parts[1].ends_with(".ics") {
            return format!("/api/dav/cal/{}/calendar/{}", parts[0], parts[1]);
        }
    }

    if let Some(rest) = path.strip_prefix("/api/dav/card/") {
        let parts: Vec<&str> = rest.trim_matches('/').split('/').collect();
        if parts.len() == 1 && !parts[0].is_empty() {
            return format!("/api/dav/card/{}/addressbook/", parts[0]);
        }
        if parts.len() == 2 && parts[1].ends_with(".vcf") {
            return format!("/api/dav/card/{}/addressbook/{}", parts[0], parts[1]);
        }
    }

    path.to_string()
}

fn rewrite_user_hierarchy(rest: &str, kind: &str) -> String {
    let segments: Vec<&str> = rest.trim_matches('/').split('/').collect();
    if segments.is_empty() || segments[0].is_empty() {
        return format!("/api/dav/{kind}/");
    }

    let user = segments[0];
    let base = if kind == "cal" {
        "calendar"
    } else {
        "addressbook"
    };

    match segments.len() {
        1 => format!("/api/dav/{kind}/{user}/{base}/"),
        _ => {
            let suffix = segments[1..].join("/");
            format!("/api/dav/{kind}/{user}/{base}/{suffix}")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_results_display() {
        let r = TestResults {
            passed: 3,
            failed: 1,
            ignored: 2,
            failures: Vec::new(),
        };
        assert_eq!(r.to_string(), "3 passed, 1 failed, 2 ignored (total 6)");
    }

    #[test]
    fn method_mapping() {
        assert_eq!(map_method("GET").unwrap(), reqwest::Method::GET);
        assert_eq!(map_method("PROPFIND").unwrap().as_str(), "PROPFIND");
        assert_eq!(map_method("MKCALENDAR").unwrap().as_str(), "MKCALENDAR");
        assert!(map_method("").is_err());
    }
}
