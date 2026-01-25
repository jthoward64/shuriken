#![allow(clippy::unused_async)]
//! Tests for OPTIONS method.
//!
//! Verifies that OPTIONS returns correct Allow and DAV headers.

#[expect(unused_imports)]
use super::helpers::*;

/// ## Summary
/// Test that OPTIONS on a collection returns expected Allow methods.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn options_allow_methods_collection() {
    // This test would:
    // 1. Create a calendar collection
    // 2. Send OPTIONS request to collection URI
    // 3. Verify Allow header includes: OPTIONS, PROPFIND, PROPPATCH, GET, PUT, DELETE, REPORT
    // 4. Verify methods are appropriate for collections
}

/// ## Summary
/// Test that OPTIONS on a single resource returns expected Allow methods.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn options_allow_methods_item() {
    // This test would:
    // 1. Create collection with a .ics resource
    // 2. Send OPTIONS request to resource URI
    // 3. Verify Allow header includes: OPTIONS, GET, HEAD, PUT, DELETE
    // 4. Verify methods are appropriate for items (not PROPFIND depth 1)
}

/// ## Summary
/// Test that DAV header advertises only implemented features.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn options_dav_header_minimal() {
    // This test would:
    // 1. Send OPTIONS request
    // 2. Verify DAV header contains: 1, calendar-access, addressbook
    // 3. Verify it does NOT contain class 2 unless LOCK/UNLOCK is implemented
    // 4. Verify it does NOT contain calendar-auto-schedule unless implemented
}

/// ## Summary
/// Test that class 2 (locking) is not advertised without LOCK/UNLOCK support.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn options_no_locking_advertised_without_lock() {
    // This test would:
    // 1. Send OPTIONS request
    // 2. Parse DAV header
    // 3. Verify "2" is not in the compliance classes
    // 4. Verify LOCK and UNLOCK are not in Allow header
}

/// ## Summary
/// Test that scheduling features are not advertised without RFC 6638 support.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn options_no_auto_schedule_without_rfc6638() {
    // This test would:
    // 1. Send OPTIONS request to calendar
    // 2. Parse DAV header
    // 3. Verify "calendar-auto-schedule" is not present
    // 4. Or if present, verify scheduling endpoints work
}

/// ## Summary
/// Test that OPTIONS returns correct status (200 or 204).
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn options_status_code() {
    // This test would:
    // 1. Send OPTIONS request
    // 2. Verify status is either 200 OK or 204 No Content
    // 3. Both are acceptable per RFC 2616
}

/// ## Summary
/// Test that OPTIONS works on non-existent resources (per WebDAV spec).
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn options_on_nonexistent_resource() {
    // This test would:
    // 1. Send OPTIONS to a URI that doesn't exist
    // 2. Verify it still returns 200/204 with headers
    // 3. This is required by WebDAV - OPTIONS succeeds even if resource doesn't exist
}
