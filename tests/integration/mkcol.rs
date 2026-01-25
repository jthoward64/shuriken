#![allow(clippy::unused_async)]
//! Tests for MKCALENDAR and MKCOL (Extended MKCOL) methods.
//!
//! Verifies collection creation with initial properties.

#[expect(unused_imports)]
use super::helpers::*;

/// ## Summary
/// Test that MKCALENDAR creates a calendar collection.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn mkcalendar_creates_calendar_collection() {
    // This test would:
    // 1. Send MKCALENDAR to new URI
    // 2. Verify 201 Created
    // 3. Send PROPFIND to verify resourcetype includes calendar
    // 4. Verify collection exists in DB with resource_type="calendar"
}

/// ## Summary
/// Test that MKCALENDAR applies initial properties from request body.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn mkcalendar_initial_props_applied() {
    // This test would:
    // 1. Send MKCALENDAR with body containing displayname and description
    // 2. Verify 201 Created
    // 3. Send PROPFIND to verify properties were set
    // 4. Verify properties match request
}

/// ## Summary
/// Test that Extended MKCOL creates an addressbook.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn mkcol_extended_creates_addressbook() {
    // This test would:
    // 1. Send MKCOL with Extended MKCOL body (RFC 5689) specifying addressbook resourcetype
    // 2. Verify 201 Created
    // 3. Send PROPFIND to verify resourcetype includes addressbook
    // 4. Verify collection exists in DB with resource_type="addressbook"
}

/// ## Summary
/// Test that Extended MKCOL with invalid XML returns 400.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn mkcol_extended_rejects_bad_body() {
    // This test would:
    // 1. Send MKCOL with malformed XML body
    // 2. Verify 400 Bad Request
    // 3. Verify collection was not created
}

/// ## Summary
/// Test that Extended MKCOL applies initial properties.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn mkcol_extended_applies_initial_props() {
    // This test would:
    // 1. Send Extended MKCOL with displayname and description in body
    // 2. Verify 201 Created
    // 3. Send PROPFIND to verify properties were set
}

/// ## Summary
/// Test that MKCALENDAR on existing URI returns 405.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn mkcalendar_on_existing_uri_405() {
    // This test would:
    // 1. Create collection at URI
    // 2. Send MKCALENDAR to same URI
    // 3. Verify 405 Method Not Allowed or 409 Conflict
}

/// ## Summary
/// Test that MKCOL creates a plain collection (non-calendar, non-addressbook).
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn mkcol_creates_plain_collection() {
    // This test would:
    // 1. Send MKCOL (not Extended MKCOL) to new URI
    // 2. Verify 201 Created
    // 3. Send PROPFIND to verify resourcetype is collection only
}

/// ## Summary
/// Test that MKCALENDAR requires authentication.
#[tokio::test]
#[ignore = "requires HTTP routing and auth"]
async fn mkcalendar_requires_auth() {
    // This test would:
    // 1. Send MKCALENDAR without credentials
    // 2. Verify 401 Unauthorized
}

/// ## Summary
/// Test that MKCALENDAR is denied if user lacks permission.
#[tokio::test]
#[ignore = "requires HTTP routing and auth"]
async fn mkcalendar_unauthorized_403() {
    // This test would:
    // 1. Authenticate as user with no create permission
    // 2. Send MKCALENDAR
    // 3. Verify 403 Forbidden
}

/// ## Summary
/// Test that MKCALENDAR with protected properties in body returns 403.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn mkcalendar_protected_props_403() {
    // This test would:
    // 1. Send MKCALENDAR with attempt to set protected property (e.g., resourcetype)
    // 2. Verify 207 Multi-Status or 403 Forbidden
    // 3. Verify protected property was not set
}
