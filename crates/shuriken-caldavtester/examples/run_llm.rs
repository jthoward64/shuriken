use serde::Serialize;
use shuriken_caldavtester::config;
use shuriken_caldavtester::runner::{ServerConfig, TestFailure, TestRunner, TestResults};
use shuriken_caldavtester::server;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Debug, Serialize)]
struct FileStats {
    planned: usize,
    executed: usize,
    missing: usize,
}

#[derive(Debug, Serialize)]
struct Totals {
    passed: usize,
    failed: usize,
    ignored: usize,
    total: usize,
}

#[derive(Debug, Serialize)]
struct FailurePattern {
    kind: &'static str,
    count: usize,
    action: &'static str,
}

#[derive(Debug, Serialize)]
struct CompactFailure {
    file: String,
    suite: String,
    test: String,
    message: String,
}

#[derive(Debug, Serialize)]
struct FileMatrixEntry {
    file: String,
    status: &'static str,
    passed: usize,
    failed: usize,
    ignored: usize,
    total: usize,
}

#[derive(Debug, Serialize)]
struct LlmReport {
    mode: &'static str,
    strict_callbacks: bool,
    file_stats: FileStats,
    totals: Totals,
    top_failure_patterns: Vec<FailurePattern>,
    failures: Vec<CompactFailure>,
    failures_omitted: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_matrix: Option<Vec<FileMatrixEntry>>,
    file_matrix_omitted: usize,
    next_actions: Vec<String>,
}

fn classify_failure(message: &str) -> (&'static str, &'static str) {
    let lower = message.to_ascii_lowercase();

    if lower.contains("unknown callback") || lower.contains("unsupported callback") {
        return (
            "unsupported_callback",
            "Implement or map the missing verifier callback, or disable strict callback mode for exploratory runs.",
        );
    }
    if lower.contains("status") {
        return (
            "http_status_mismatch",
            "Compare expected status with handler behavior; validate auth/ACL and RFC preconditions for the request.",
        );
    }
    if lower.contains("header") {
        return (
            "header_mismatch",
            "Inspect expected headers (ETag, DAV, Content-Type) and ensure they are emitted on success and error paths.",
        );
    }
    if lower.contains("propfind") || lower.contains("multistatus") || lower.contains("xml") {
        return (
            "dav_xml_mismatch",
            "Validate multistatus shape, DAV namespace usage, and property-specific response status/value serialization.",
        );
    }
    if lower.contains("resource file not found") || lower.contains("failed to read resource file") {
        return (
            "fixture_missing",
            "Verify test-suite resource paths and substitutions; ensure required fixture files exist in test-suite/Resource.",
        );
    }

    (
        "generic_verification_failure",
        "Review the verifier message and compare request/response payloads for this case.",
    )
}

fn truncate_message(message: &str, max_len: usize) -> String {
    let mut out = message.chars().take(max_len).collect::<String>();
    if message.chars().count() > max_len {
        out.push_str("…");
    }
    out
}

fn parse_args() -> (bool, bool, bool, bool, usize, usize, usize, Vec<String>) {
    let mut run_all = false;
    let mut strict_callbacks = false;
    let mut force_external = false;
    let mut include_file_matrix = false;
    let mut max_failures = 25usize;
    let mut max_message_len = 220usize;
    let mut max_file_matrix = 80usize;
    let mut selected = Vec::new();

    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--all" => run_all = true,
            "--strict-callbacks" => strict_callbacks = true,
            "--external" => force_external = true,
            "--file-matrix" => include_file_matrix = true,
            "--max-failures" => {
                if let Some(raw) = args.next() {
                    if let Ok(n) = raw.parse::<usize>() {
                        max_failures = n;
                    }
                }
            }
            "--max-message-len" => {
                if let Some(raw) = args.next() {
                    if let Ok(n) = raw.parse::<usize>() {
                        max_message_len = n;
                    }
                }
            }
            "--max-file-matrix" => {
                if let Some(raw) = args.next() {
                    if let Ok(n) = raw.parse::<usize>() {
                        max_file_matrix = n;
                    }
                }
            }
            _ => selected.push(arg),
        }
    }

    (
        run_all,
        strict_callbacks,
        force_external,
        include_file_matrix,
        max_failures,
        max_message_len,
        max_file_matrix,
        selected,
    )
}

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
    let log_filter = std::env::var("CALDAV_TEST_LOG").unwrap_or_else(|_| "off".to_string());
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(log_filter)),
        )
        .with_target(false)
        .without_time()
        .init();

    let (
        run_all,
        strict_callbacks,
        force_external,
        include_file_matrix,
        max_failures,
        max_message_len,
        max_file_matrix,
        selected,
    ) = parse_args();

    if strict_callbacks {
        std::env::set_var("CALDAV_TEST_STRICT_CALLBACKS", "1");
    }

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

    let base_url = std::env::var("CALDAV_TEST_BASE_URL")
        .unwrap_or_else(|_| "http://localhost:8698".to_string());
    let suite_dir = config::test_suite_dir();
    let tests_dir = suite_dir.join("tests");

    let planned_files: Vec<String> = if selected.is_empty() {
        if run_all {
            config::all_tests()
                .into_iter()
                .map(|entry| entry.path.to_string())
                .collect()
        } else {
            config::all_tests()
                .into_iter()
                .filter(|entry| entry.enabled)
                .map(|entry| entry.path.to_string())
                .collect()
        }
    } else {
        selected
    };

    let server_config = ServerConfig {
        base_url,
        resource_dir: suite_dir,
        features: config::server_features(),
    };

    let in_process_service = if in_process {
        Some(Arc::new(server::create_in_process_service().await?))
    } else {
        None
    };

    let mut totals = TestResults::default();
    let mut missing_files = 0usize;
    let mut executed_files = 0usize;
    let mut compact_failures = Vec::new();
    let mut file_matrix: Vec<FileMatrixEntry> = Vec::new();

    for rel in &planned_files {
        let path = tests_dir.join(rel);
        if !path.exists() {
            missing_files += 1;
            compact_failures.push(CompactFailure {
                file: rel.clone(),
                suite: "FILE".to_string(),
                test: "missing".to_string(),
                message: "test file not found".to_string(),
            });
            if include_file_matrix {
                file_matrix.push(FileMatrixEntry {
                    file: rel.clone(),
                    status: "missing",
                    passed: 0,
                    failed: 1,
                    ignored: 0,
                    total: 1,
                });
            }
            continue;
        }

        executed_files += 1;
        let mut runner = if let Some(service) = &in_process_service {
            TestRunner::with_in_process_service(server_config.clone(), Arc::clone(service))?
        } else {
            TestRunner::with_config(server_config.clone())?
        };

        match runner.run_test_file(&path).await {
            Ok(results) => {
                if include_file_matrix {
                    file_matrix.push(FileMatrixEntry {
                        file: rel.clone(),
                        status: if results.failed > 0 { "failed" } else { "passed" },
                        passed: results.passed,
                        failed: results.failed,
                        ignored: results.ignored,
                        total: results.total(),
                    });
                }
                totals.add(&results);
                for TestFailure {
                    suite,
                    test,
                    message,
                } in results.failures
                {
                    compact_failures.push(CompactFailure {
                        file: rel.clone(),
                        suite,
                        test,
                        message: truncate_message(&message, max_message_len),
                    });
                }
            }
            Err(err) => {
                totals.failed += 1;
                if include_file_matrix {
                    file_matrix.push(FileMatrixEntry {
                        file: rel.clone(),
                        status: "error",
                        passed: 0,
                        failed: 1,
                        ignored: 0,
                        total: 1,
                    });
                }
                compact_failures.push(CompactFailure {
                    file: rel.clone(),
                    suite: "FILE".to_string(),
                    test: "run_test_file".to_string(),
                    message: truncate_message(&err.to_string(), max_message_len),
                });
            }
        }
    }

    let mut pattern_counts: HashMap<&'static str, (usize, &'static str)> = HashMap::new();
    for failure in &compact_failures {
        let (kind, action) = classify_failure(&failure.message);
        let entry = pattern_counts.entry(kind).or_insert((0, action));
        entry.0 += 1;
    }

    let mut top_failure_patterns: Vec<FailurePattern> = pattern_counts
        .into_iter()
        .map(|(kind, (count, action))| FailurePattern {
            kind,
            count,
            action,
        })
        .collect();
    top_failure_patterns.sort_by(|a, b| b.count.cmp(&a.count));
    top_failure_patterns.truncate(5);

    let failures_omitted = compact_failures.len().saturating_sub(max_failures);
    compact_failures.truncate(max_failures);

    let file_matrix_omitted = if include_file_matrix {
        file_matrix.len().saturating_sub(max_file_matrix)
    } else {
        0
    };
    if include_file_matrix {
        file_matrix.truncate(max_file_matrix);
    }

    let mut next_actions = Vec::new();
    if missing_files > 0 {
        next_actions.push(format!(
            "Resolve {} missing test file(s) in test-suite/tests.",
            missing_files
        ));
    }
    for pattern in &top_failure_patterns {
        next_actions.push(format!("{}: {}", pattern.kind, pattern.action));
    }
    if next_actions.is_empty() {
        next_actions.push("No actionable failures detected.".to_string());
    }

    let report = LlmReport {
        mode: if in_process { "in-process" } else { "external" },
        strict_callbacks,
        file_stats: FileStats {
            planned: planned_files.len(),
            executed: executed_files,
            missing: missing_files,
        },
        totals: Totals {
            passed: totals.passed,
            failed: totals.failed,
            ignored: totals.ignored,
            total: totals.total(),
        },
        top_failure_patterns,
        failures: compact_failures,
        failures_omitted,
        file_matrix: if include_file_matrix {
            Some(file_matrix)
        } else {
            None
        },
        file_matrix_omitted,
        next_actions,
    };

    println!("{}", serde_json::to_string(&report)?);

    if report.totals.failed == 0 && report.file_stats.missing == 0 {
        Ok(())
    } else {
        std::process::exit(1);
    }
}
