use shuriken_caldavtester::config;
use shuriken_caldavtester::runner::{ServerConfig, TestRunner};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("warn")),
        )
        .init();

    let mut strict_callbacks = false;
    let mut selected = Vec::new();
    for arg in std::env::args().skip(1) {
        if arg == "--strict-callbacks" {
            strict_callbacks = true;
        } else {
            selected.push(arg);
        }
    }

    if selected.is_empty() {
        eprintln!(
            "usage: cargo run -p shuriken-caldavtester --example run_selected -- [--strict-callbacks] <CalDAV/file1.xml> [CalDAV/file2.xml ...]"
        );
        std::process::exit(2);
    }

    if strict_callbacks {
        std::env::set_var("CALDAV_TEST_STRICT_CALLBACKS", "1");
    }

    let base_url = std::env::var("CALDAV_TEST_BASE_URL")
        .unwrap_or_else(|_| "http://localhost:8698".to_string());

    let suite_dir = config::test_suite_dir();
    let tests_dir = suite_dir.join("tests");

    let server_config = ServerConfig {
        base_url,
        resource_dir: suite_dir.clone(),
        features: config::server_features(),
    };

    let mut total = shuriken_caldavtester::runner::TestResults::default();

    for rel in &selected {
        let path = tests_dir.join(rel);
        if !path.exists() {
            eprintln!("[SKIP] {rel} (missing)");
            continue;
        }

        let mut runner = TestRunner::with_config(server_config.clone())?;
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
