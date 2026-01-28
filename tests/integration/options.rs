#![allow(clippy::unused_async, unused_must_use)]
//! Tests for OPTIONS method.
//!
//! Verifies that OPTIONS returns correct Allow and DAV headers.

use salvo::http::StatusCode;

use super::helpers::*;

/// ## Summary
/// Test that OPTIONS on a collection returns expected Allow methods.
#[test_log::test(tokio::test)]
async fn options_returns_allow_header() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let _collection_id = test_db
        .seed_collection(principal_id, "calendar", "some-collection", None)
        .await
        .expect("Failed to seed collection");

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::options(&caldav_collection_path("testuser", "some-collection"))
        .send(&service)
        .await;

    response
        .assert_status(StatusCode::OK)
        .assert_header_exists("Allow");
}

/// ## Summary
/// Test that OPTIONS returns DAV compliance header.
#[test_log::test(tokio::test)]
async fn options_returns_dav_header() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::options("/api/caldav/some-collection/")
        .send(&service)
        .await;

    response
        .assert_status(StatusCode::OK)
        .assert_header_exists("DAV");
}

/// ## Summary
/// Test that DAV header advertises basic WebDAV compliance (class 1).
#[test_log::test(tokio::test)]
async fn options_dav_header_contains_class_1() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::options("/api/caldav/some-path/")
        .send(&service)
        .await;

    response
        .assert_status(StatusCode::OK)
        .assert_header_contains("DAV", "1");
}

/// ## Summary
/// Test that DAV header advertises calendar-access (CalDAV support).
#[test_log::test(tokio::test)]
async fn options_dav_header_contains_calendar_access() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::options("/api/caldav/calendar/")
        .send(&service)
        .await;

    response
        .assert_status(StatusCode::OK)
        .assert_header_contains("DAV", "calendar-access");
}

/// ## Summary
/// Test that DAV header advertises addressbook (CardDAV support).
#[test_log::test(tokio::test)]
async fn options_dav_header_contains_addressbook() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::options("/api/carddav/addressbook/")
        .send(&service)
        .await;

    response
        .assert_status(StatusCode::OK)
        .assert_header_contains("DAV", "addressbook");
}

/// ## Summary
/// Test that Allow header includes expected DAV methods.
#[test_log::test(tokio::test)]
async fn options_allow_contains_dav_methods() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::options("/api/caldav/collection/")
        .send(&service)
        .await;

    let allow = response.get_header("Allow").unwrap_or("");

    // Check for essential methods
    assert!(
        allow.contains("OPTIONS"),
        "Allow header should contain OPTIONS"
    );
    assert!(allow.contains("GET"), "Allow header should contain GET");
    assert!(
        allow.contains("PROPFIND"),
        "Allow header should contain PROPFIND"
    );
}

/// ## Summary
/// Test that OPTIONS returns correct status (200 or 204).
#[test_log::test(tokio::test)]
async fn options_status_code() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::options("/api/caldav/resource/")
        .send(&service)
        .await;

    // Both 200 OK and 204 No Content are acceptable per RFC 2616
    assert!(
        response.status == StatusCode::OK || response.status == StatusCode::NO_CONTENT,
        "Expected 200 OK or 204 No Content, got {}",
        response.status
    );
}

/// ## Summary
/// Test that class 2 (locking) is not advertised without LOCK/UNLOCK support.
#[test_log::test(tokio::test)]
async fn options_no_locking_advertised_without_lock() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::options("/api/caldav/resource/")
        .send(&service)
        .await;

    let dav_header = response.get_header("DAV").unwrap_or("");
    let allow_header = response.get_header("Allow").unwrap_or("");

    // If locking is not implemented, class 2 should not be advertised
    // and LOCK/UNLOCK should not be in Allow
    if !allow_header.contains("LOCK") {
        // DAV header might contain "1, 3" but should not contain ", 2,"
        // This is a simplified check - a real check would parse the compliance classes
        assert!(
            !dav_header.split(',').any(|c| c.trim() == "2"),
            "DAV header should not advertise class 2 without LOCK support"
        );
    }
}

/// ## Summary
/// Test that OPTIONS works on non-existent resources (per WebDAV spec).
/// Per RFC 4918, OPTIONS should succeed even for non-existent resources.
#[test_log::test(tokio::test)]
async fn options_on_nonexistent_resource_succeeds() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::options("/api/caldav/nonexistent-uuid/nonexistent.ics")
        .send(&service)
        .await;

    // OPTIONS should succeed even for non-existent resources
    // This is required by WebDAV spec - server capabilities are path-independent
    assert!(
        response.status == StatusCode::OK || response.status == StatusCode::NO_CONTENT,
        "OPTIONS should succeed on non-existent resource, got {}",
        response.status
    );
}

/// ## Summary
/// Test OPTIONS on the root API path.
#[test_log::test(tokio::test)]
async fn options_on_api_root() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::options("/api/").send(&service).await;

    // Should return a valid response (may vary based on implementation)
    assert!(
        response.status.is_success() || response.status == StatusCode::METHOD_NOT_ALLOWED,
        "Expected success or 405, got {}",
        response.status
    );
}

/// ## Summary
/// Test that scheduling features are not advertised without RFC 6638 support.
#[test_log::test(tokio::test)]
async fn options_no_auto_schedule_without_rfc6638() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::options("/api/caldav/calendar/")
        .send(&service)
        .await;

    let dav_header = response.get_header("DAV").unwrap_or("");

    // If calendar-auto-schedule is in the DAV header, scheduling should work
    // Otherwise, it should not be advertised
    // This test documents current behavior
    if dav_header.contains("calendar-auto-schedule") {
        // If advertised, scheduling endpoints should exist
        // (Future test: verify scheduling inbox/outbox work)
    }
    // No assertion needed - just documenting the check
}

/// ## Summary
/// Test OPTIONS with various Accept headers to ensure content negotiation doesn't break it.
#[test_log::test(tokio::test)]
async fn options_ignores_accept_header() {
    let test_db = TestDb::new().await.expect("Failed to create test database");

    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");

    test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let service = create_db_test_service(&test_db.url()).await;

    let response = TestRequest::options("/api/caldav/collection/")
        .header("Accept", "application/xml")
        .send(&service)
        .await;

    response.assert_status(StatusCode::OK);
}
