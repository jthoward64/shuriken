//! Example: Run the CalDAV / CardDAV test suite.
//!
//! ```sh
//! # Run with default settings (in-process Salvo service)
//! cargo run --example run_tests
//!
//! # Custom base URL
//! CALDAV_TEST_BASE_URL=http://localhost:3000 cargo run --example run_tests
//!
//! # In-process mode (Salvo test API)
//! CALDAV_TEST_IN_PROCESS=1 cargo run --example run_tests
//!
//! # External server mode (opt-out of in-process default)
//! CALDAV_TEST_EXTERNAL=1 cargo run --example run_tests -- --external
//!
//! # Run ALL tests, not just the enabled ones
//! CALDAV_TEST_ALL=1 cargo run --example run_tests
//!
//! # Fail on unknown verification callbacks
//! cargo run -p shuriken-caldavtester --example run_tests -- --strict-callbacks
//! ```

use shuriken_caldavtester::config;
use shuriken_caldavtester::runner::{ServerConfig, TestFailure, TestRunner};
use shuriken_caldavtester::server;
use std::sync::Arc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let base_url = std::env::var("CALDAV_TEST_BASE_URL")
        .unwrap_or_else(|_| "http://localhost:8698".to_string());
    let run_all = std::env::var("CALDAV_TEST_ALL").is_ok();
    let mut strict_callbacks = false;
    let mut force_external = false;
    for arg in std::env::args().skip(1) {
        match arg.as_str() {
            "--strict-callbacks" => strict_callbacks = true,
            "--external" => force_external = true,
            _ => {}
        }
    }

    let in_process = if std::env::var("CALDAV_TEST_IN_PROCESS").is_ok() {
        true
    } else if force_external || std::env::var("CALDAV_TEST_EXTERNAL").is_ok() {
        false
    } else {
        true
    };

    if strict_callbacks {
        std::env::set_var("CALDAV_TEST_STRICT_CALLBACKS", "1");
    }

    let suite_dir = config::test_suite_dir();
    let tests_dir = suite_dir.join("tests");

    let server_config = ServerConfig {
        base_url,
        resource_dir: suite_dir.clone(),
        features: config::server_features(),
    };

    let entries = if run_all {
        config::all_tests()
    } else {
        config::all_tests()
            .into_iter()
            .filter(|e| e.enabled)
            .collect()
    };

    println!(
        "Running {} test files (suite dir: {}, mode: {})",
        entries.len(),
        suite_dir.display(),
        if in_process { "in-process" } else { "external" }
    );

    let mut total = shuriken_caldavtester::runner::TestResults::default();
    let in_process_service = if in_process {
        Some(Arc::new(server::create_in_process_service().await?))
    } else {
        None
    };

    for entry in &entries {
        let path = tests_dir.join(entry.path);
        if !path.exists() {
            println!("  SKIP (not found): {}", entry.path);
            continue;
        }

        let mut runner = if let Some(service) = &in_process_service {
            TestRunner::with_in_process_service(server_config.clone(), Arc::clone(service))?
        } else {
            TestRunner::with_config(server_config.clone())?
        };
        match runner.run_test_file(&path).await {
            Ok(results) => {
                let marker = if results.all_passed() { "OK" } else { "FAIL" };
                println!("  [{marker}] {} — {results}", entry.path,);
                total.add(&results);
            }
            Err(e) => {
                println!("  [ERR] {} — {e}", entry.path);
                total.failed += 1;
                total.failures.push(TestFailure {
                    suite: entry.path.to_string(),
                    test: "run_test_file".to_string(),
                    message: e.to_string(),
                });
            }
        }
    }

    println!("\n=== SUMMARY ===");
    println!("{total}");

    if !total.failures.is_empty() {
        println!("\nFailures:");
        for f in &total.failures {
            println!("  {}/{}:  {}", f.suite, f.test, f.message);
        }
    }

    if total.all_passed() {
        println!("\nAll tests passed!");
    } else {
        println!("\nSome tests failed.");
        std::process::exit(1);
    }

    Ok(())
}
