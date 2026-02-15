use shuriken_caldavtester::config;
use shuriken_caldavtester::runner::{ServerConfig, TestRunner};
use shuriken_caldavtester::server;
use std::sync::Arc;

fn ensure_in_process_auth_defaults() {
    if std::env::var("DATABASE_URL").is_err() {
        std::env::set_var(
            "DATABASE_URL",
            "postgres://shuriken:shuriken@localhost:4525/shuriken_caldavtester",
        );
    }
    if std::env::var("AUTH_METHOD").is_err() {
        std::env::set_var("AUTH_METHOD", "basic_auth");
    }
    if std::env::var("CALDAV_TEST_DEFAULT_USER").is_err() {
        std::env::set_var("CALDAV_TEST_DEFAULT_USER", "user01");
    }
    if std::env::var("CALDAV_TEST_DEFAULT_PASSWORD").is_err() {
        std::env::set_var("CALDAV_TEST_DEFAULT_PASSWORD", "password");
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("warn")),
        )
        .init();

    let mut strict_callbacks = false;
    let mut force_external = false;
    let mut selected = Vec::new();
    for arg in std::env::args().skip(1) {
        if arg == "--strict-callbacks" {
            strict_callbacks = true;
        } else if arg == "--external" {
            force_external = true;
        } else {
            selected.push(arg);
        }
    }

    if selected.is_empty() {
        eprintln!(
            "usage: cargo run -p shuriken-caldavtester --example run_selected -- [--strict-callbacks] [--external] <CalDAV/file1.xml> [CalDAV/file2.xml ...]"
        );
        std::process::exit(2);
    }

    if strict_callbacks {
        std::env::set_var("CALDAV_TEST_STRICT_CALLBACKS", "1");
    }

    let base_url = std::env::var("CALDAV_TEST_BASE_URL")
        .unwrap_or_else(|_| "http://localhost:8698".to_string());
    let in_process = if std::env::var("CALDAV_TEST_IN_PROCESS").is_ok() {
        true
    } else if force_external || std::env::var("CALDAV_TEST_EXTERNAL").is_ok() {
        false
    } else {
        true
    };

    if in_process {
        ensure_in_process_auth_defaults();
    }

    let suite_dir = config::test_suite_dir();
    let tests_dir = suite_dir.join("tests");

    let server_config = ServerConfig {
        base_url,
        resource_dir: suite_dir.clone(),
        features: config::server_features(),
    };

    let mut total = shuriken_caldavtester::runner::TestResults::default();
    let in_process_service = if in_process {
        Some(Arc::new(server::create_in_process_service().await?))
    } else {
        None
    };

    for rel in &selected {
        let path = tests_dir.join(rel);
        if !path.exists() {
            eprintln!("[SKIP] {rel} (missing)");
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
                println!("[{marker}] {rel} — {results}");
                total.add(&results);
            }
            Err(err) => {
                eprintln!("[ERR] {rel} — {err}");
                total.failed += 1;
            }
        }
    }

    println!("\n=== SELECTED SUMMARY ===\n{total}");
    if !total.failures.is_empty() {
        println!("\nFailures:");
        for failure in &total.failures {
            println!(
                "  {}/{}: {}",
                failure.suite, failure.test, failure.message
            );
        }
    }

    if total.all_passed() {
        Ok(())
    } else {
        std::process::exit(1);
    }
}
