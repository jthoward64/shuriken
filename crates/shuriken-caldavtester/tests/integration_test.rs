//! Integration tests for the CalDAV test runner.
//!
//! These tests validate that we can parse every XML test file in the test-suite
//! directory without errors. Running the actual HTTP tests requires a live server.

use shuriken_caldavtester::config;
use shuriken_caldavtester::runner::{ServerConfig, TestRunner};
use shuriken_caldavtester::xml;
use std::collections::BTreeSet;

/// Verify that every listed test file can be parsed successfully.
///
/// This catches XML format incompatibilities early without needing a server.
#[test]
fn parse_all_test_files() {
    let suite_dir = config::test_suite_dir();
    let tests_dir = suite_dir.join("tests");

    let entries = config::all_tests();
    let mut failures = Vec::new();

    for entry in &entries {
        let path = tests_dir.join(entry.path);
        if !path.exists() {
            failures.push(format!("NOT FOUND: {}", entry.path));
            continue;
        }
        if let Err(e) = xml::parse_test_file(&path) {
            failures.push(format!("PARSE ERROR: {} — {e}", entry.path));
        }
    }

    if !failures.is_empty() {
        panic!(
            "{} file(s) failed to parse:\n  {}",
            failures.len(),
            failures.join("\n  ")
        );
    }
}

/// Smoke test: create a runner with default config.
#[test]
fn runner_construction() {
    let config = ServerConfig {
        base_url: "http://localhost:8080".to_string(),
        resource_dir: config::test_suite_dir(),
        features: config::server_features(),
    };
    let _runner = TestRunner::with_config(config).expect("runner should construct");
}

/// Ensure every callback used by suite XML files is implemented by the verifier.
#[test]
fn callbacks_used_by_suite_are_supported() {
    let suite_dir = config::test_suite_dir();
    let tests_dir = suite_dir.join("tests");
    let entries = config::all_tests();

    let supported: BTreeSet<&str> = [
        "statusCode",
        "header",
        "headerContains",
        "dataString",
        "notDataString",
        "propfindItems",
        "propfindValues",
        "multistatusItems",
        "xmlElementMatch",
        "prepostcondition",
        "jsonPointerMatch",
        "calendarDataMatch",
        "jcalDataMatch",
        "addressDataMatch",
        "dataMatch",
        "xmlDataMatch",
        "freeBusy",
        "postFreeBusy",
        "acl",
        "aclItems",
        "exists",
        "doesNotExist",
    ]
    .into_iter()
    .collect();

    let mut used = BTreeSet::new();
    let mut parse_failures = Vec::new();

    for entry in &entries {
        let path = tests_dir.join(entry.path);
        if !path.exists() {
            continue;
        }

        match xml::parse_test_file(&path) {
            Ok(test_file) => {
                for request in &test_file.start_requests {
                    for verification in &request.verifications {
                        used.insert(verification.callback.clone());
                    }
                }
                for suite in &test_file.test_suites {
                    for test in &suite.tests {
                        for request in &test.requests {
                            for verification in &request.verifications {
                                used.insert(verification.callback.clone());
                            }
                        }
                    }
                }
                for request in &test_file.end_requests {
                    for verification in &request.verifications {
                        used.insert(verification.callback.clone());
                    }
                }
            }
            Err(err) => parse_failures.push(format!("{}: {err}", entry.path)),
        }
    }

    if !parse_failures.is_empty() {
        panic!(
            "Failed to parse {} test file(s):\n{}",
            parse_failures.len(),
            parse_failures.join("\n")
        );
    }

    let unsupported: Vec<String> = used
        .iter()
        .filter(|callback| !supported.contains(callback.as_str()))
        .cloned()
        .collect();

    if !unsupported.is_empty() {
        panic!(
            "Unsupported callbacks found in suite: {}",
            unsupported.join(", ")
        );
    }
}

/// Run enabled tests against a live server.
///
/// Enable with:
/// ```sh
/// CALDAV_TEST_BASE_URL=http://localhost:8080 cargo test -p shuriken-caldavtester -- --ignored run_enabled_tests
/// ```
#[tokio::test]
#[ignore]
async fn run_enabled_tests() {
    let base_url = std::env::var("CALDAV_TEST_BASE_URL")
        .unwrap_or_else(|_| "http://localhost:8080".to_string());

    let suite_dir = config::test_suite_dir();
    let tests_dir = suite_dir.join("tests");

    let server_config = ServerConfig {
        base_url,
        resource_dir: suite_dir,
        features: config::server_features(),
    };

    let enabled = config::enabled_tests();
    let mut total = shuriken_caldavtester::runner::TestResults::default();

    for path_str in &enabled {
        let path = tests_dir.join(path_str);
        if !path.exists() {
            eprintln!("SKIP (not found): {path_str}");
            continue;
        }

        let mut runner =
            TestRunner::with_config(server_config.clone()).expect("runner should construct");
        match runner.run_test_file(&path).await {
            Ok(results) => {
                let marker = if results.all_passed() { "OK" } else { "FAIL" };
                eprintln!("[{marker}] {path_str} — {results}");
                total.add(&results);
            }
            Err(e) => {
                eprintln!("[ERR] {path_str} — {e}");
                total.failed += 1;
            }
        }
    }

    eprintln!("\n=== SUMMARY ===\n{total}");
    // Don't assert all_passed — most will fail until features are implemented
}
