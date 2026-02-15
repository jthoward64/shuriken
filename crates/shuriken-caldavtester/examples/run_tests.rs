//! Example: Run the CalDAV / CardDAV test suite.
//!
//! ```sh
//! # Run with default settings (assumes server at localhost:8080)
//! cargo run --example run_tests
//!
//! # Custom base URL
//! CALDAV_TEST_BASE_URL=http://localhost:3000 cargo run --example run_tests
//!
//! # Run ALL tests, not just the enabled ones
//! CALDAV_TEST_ALL=1 cargo run --example run_tests
//! ```

use shuriken_caldavtester::config;
use shuriken_caldavtester::runner::{ServerConfig, TestRunner};
use std::path::PathBuf;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let base_url = std::env::var("CALDAV_TEST_BASE_URL")
        .unwrap_or_else(|_| "http://localhost:8080".to_string());
    let run_all = std::env::var("CALDAV_TEST_ALL").is_ok();

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
        "Running {} test files (suite dir: {})",
        entries.len(),
        suite_dir.display()
    );

    let mut total = shuriken_caldavtester::runner::TestResults::default();

    for entry in &entries {
        let path = tests_dir.join(entry.path);
        if !path.exists() {
            println!("  SKIP (not found): {}", entry.path);
            continue;
        }

        let mut runner = TestRunner::with_config(server_config.clone())?;
        match runner.run_test_file(&path).await {
            Ok(results) => {
                let marker = if results.all_passed() { "OK" } else { "FAIL" };
                println!(
                    "  [{marker}] {} — {results}",
                    entry.path,
                );
                total.add(&results);
            }
            Err(e) => {
                println!("  [ERR] {} — {e}", entry.path);
                total.failed += 1;
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
