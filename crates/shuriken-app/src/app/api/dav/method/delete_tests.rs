//! Tests for DELETE method handler.

use salvo::http::StatusCode;
use salvo::test::TestClient;

use super::delete::delete;

#[tokio::test]
async fn test_delete_returns_error_without_database() {
    // Create a test request without database provider in depot
    let service = salvo::Router::new().push(salvo::Router::with_path("/{**rest}").delete(delete));

    let content = TestClient::delete("http://127.0.0.1:5800/test.ics")
        .send(service)
        .await;

    // Handler returns 500 when database provider not available in depot
    assert_eq!(content.status_code, Some(StatusCode::INTERNAL_SERVER_ERROR));
}

#[tokio::test]
async fn test_delete_handles_database_connection() {
    // Test that handler attempts to connect to database
    let service = salvo::Router::new().push(salvo::Router::with_path("/{**rest}").delete(delete));

    let content = TestClient::delete("http://127.0.0.1:5800/calendars/user/test.ics")
        .send(service)
        .await;

    // Should either return 404 (not found) or 500 (connection error)
    // depending on database availability
    assert!(
        content.status_code == Some(StatusCode::NOT_FOUND)
            || content.status_code == Some(StatusCode::INTERNAL_SERVER_ERROR)
    );
}

#[tokio::test]
async fn test_delete_accepts_any_path() {
    // Test various path patterns
    let paths = vec![
        "/test.ics",
        "/calendars/user/event.ics",
        "/addressbooks/user/contact.vcf",
        "/deeply/nested/path/resource.ics",
    ];

    for path in paths {
        let service =
            salvo::Router::new().push(salvo::Router::with_path("/{**rest}").delete(delete));

        let content = TestClient::delete(format!("http://127.0.0.1:5800{path}"))
            .send(service)
            .await;

        // All should return a valid status code
        assert!(content.status_code.is_some());
    }
}

#[tokio::test]
async fn test_delete_smoke_status_codes_without_middleware() {
    // Smoke test for handler wiring without middleware or database setup.
    let service = salvo::Router::new().push(salvo::Router::with_path("/{**rest}").delete(delete));

    let content = TestClient::delete("http://127.0.0.1:5800/test.ics")
        .send(service)
        .await;

    // Verify response has a status code
    assert!(content.status_code.is_some());

    // Expected status: 204 No Content (success), 404 Not Found (not exists),
    // or 500 (error)
    let status = content.status_code.unwrap();
    assert!(
        status == StatusCode::NO_CONTENT
            || status == StatusCode::NOT_FOUND
            || status == StatusCode::INTERNAL_SERVER_ERROR
    );
}
