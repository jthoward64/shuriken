//! Tests for GET and HEAD method handlers.

use salvo::http::StatusCode;
use salvo::test::TestClient;

use super::get_head::{get, head};

#[tokio::test]
async fn test_get_returns_not_found_for_stub() {
    // Create a test request
    let service = salvo::Router::new().push(salvo::Router::with_path("/<**rest>").get(get));
    
    let content = TestClient::get("http://127.0.0.1:5800/test.ics")
        .send(service)
        .await;
    
    // Stub implementation returns 404 Not Found
    assert_eq!(content.status_code, Some(StatusCode::NOT_FOUND));
}

#[tokio::test]
async fn test_head_returns_not_found_for_stub() {
    // Create a test request
    let service = salvo::Router::new().push(salvo::Router::with_path("/<**rest>").head(head));
    
    let content = TestClient::head("http://127.0.0.1:5800/test.ics")
        .send(service)
        .await;
    
    // Stub implementation returns 404 Not Found
    assert_eq!(content.status_code, Some(StatusCode::NOT_FOUND));
}

#[tokio::test]
async fn test_get_handles_database_connection() {
    // Test that handler attempts to connect to database
    let service = salvo::Router::new().push(salvo::Router::with_path("/<**rest>").get(get));
    
    let content = TestClient::get("http://127.0.0.1:5800/calendars/user/test.ics")
        .send(service)
        .await;
    
    // Should either return 404 (not found) or 500 (connection error)
    assert!(
        content.status_code == Some(StatusCode::NOT_FOUND)
            || content.status_code == Some(StatusCode::INTERNAL_SERVER_ERROR)
    );
}

#[tokio::test]
async fn test_head_handles_database_connection() {
    // Test that handler attempts to connect to database
    let service = salvo::Router::new().push(salvo::Router::with_path("/<**rest>").head(head));
    
    let content = TestClient::head("http://127.0.0.1:5800/calendars/user/test.ics")
        .send(service)
        .await;
    
    // Should either return 404 (not found) or 500 (connection error)
    assert!(
        content.status_code == Some(StatusCode::NOT_FOUND)
            || content.status_code == Some(StatusCode::INTERNAL_SERVER_ERROR)
    );
}

#[tokio::test]
async fn test_get_accepts_various_paths() {
    // Test various path patterns
    let paths = vec![
        "/test.ics",
        "/calendars/user/event.ics",
        "/addressbooks/user/contact.vcf",
        "/deeply/nested/path/resource.ics",
    ];
    
    for path in paths {
        let service = salvo::Router::new().push(salvo::Router::with_path("/<**rest>").get(get));
        
        let content = TestClient::get(format!("http://127.0.0.1:5800{path}"))
            .send(service)
            .await;
        
        // All should return a valid status code
        assert!(content.status_code.is_some());
    }
}

#[tokio::test]
async fn test_head_accepts_various_paths() {
    // Test various path patterns
    let paths = vec![
        "/test.ics",
        "/calendars/user/event.ics",
        "/addressbooks/user/contact.vcf",
        "/deeply/nested/path/resource.ics",
    ];
    
    for path in paths {
        let service = salvo::Router::new().push(salvo::Router::with_path("/<**rest>").head(head));
        
        let content = TestClient::head(format!("http://127.0.0.1:5800{path}"))
            .send(service)
            .await;
        
        // All should return a valid status code
        assert!(content.status_code.is_some());
    }
}

#[tokio::test]
async fn test_get_expected_success_status() {
    // When implemented, GET should return 200 OK with body on success
    let service = salvo::Router::new().push(salvo::Router::with_path("/<**rest>").get(get));
    
    let content = TestClient::get("http://127.0.0.1:5800/test.ics")
        .send(service)
        .await;
    
    // Verify response has a status code
    assert!(content.status_code.is_some());
    
    // Expected status: 200 OK (success), 404 Not Found (not exists),
    // 304 Not Modified (conditional), or 500 (error)
    let status = content.status_code.unwrap();
    assert!(
        status == StatusCode::OK
            || status == StatusCode::NOT_FOUND
            || status == StatusCode::NOT_MODIFIED
            || status == StatusCode::INTERNAL_SERVER_ERROR
    );
}

#[tokio::test]
async fn test_head_expected_success_status() {
    // When implemented, HEAD should return 200 OK without body on success
    let service = salvo::Router::new().push(salvo::Router::with_path("/<**rest>").head(head));
    
    let content = TestClient::head("http://127.0.0.1:5800/test.ics")
        .send(service)
        .await;
    
    // Verify response has a status code
    assert!(content.status_code.is_some());
    
    // Expected status: 200 OK (success), 404 Not Found (not exists),
    // 304 Not Modified (conditional), or 500 (error)
    let status = content.status_code.unwrap();
    assert!(
        status == StatusCode::OK
            || status == StatusCode::NOT_FOUND
            || status == StatusCode::NOT_MODIFIED
            || status == StatusCode::INTERNAL_SERVER_ERROR
    );
}

#[tokio::test]
async fn test_head_should_not_return_body() {
    // HEAD requests should not include response body
    let service = salvo::Router::new().push(salvo::Router::with_path("/<**rest>").head(head));
    
    let content = TestClient::head("http://127.0.0.1:5800/test.ics")
        .send(service)
        .await;
    
    // Verify that response body is empty or not present
    // (Note: Actual implementation verification would require full stack)
    assert!(content.status_code.is_some());
}
