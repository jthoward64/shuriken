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

    let selected: Vec<String> = std::env::args().skip(1).collect();
    if selected.is_empty() {
        eprintln!(
            "usage: cargo run -p shuriken-caldavtester --example run_selected -- <CalDAV/file1.xml> [CalDAV/file2.xml ...]"
        );
        std::process::exit(2);
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
