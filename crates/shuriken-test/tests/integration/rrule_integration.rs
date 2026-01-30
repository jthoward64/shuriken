use super::helpers::TestDb;

include!(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/rrule_cases_data/mod.rs"));

/// ## Summary
/// Integration-level validation for rrule behavior using shared cases.
#[test_log::test(tokio::test)]
async fn rrule_cases_integration() {
    let _test_db = TestDb::new().await.expect("Failed to create test database");
    for case in rrule_cases() {
        assert_case(&case);
    }
}
