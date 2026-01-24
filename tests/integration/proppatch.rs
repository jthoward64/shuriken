#![allow(clippy::doc_markdown, clippy::unused_async)]
//! Tests for PROPPATCH method.
//!
//! Verifies property modification, protected properties, and partial success handling.

#[expect(unused_imports)]
use super::helpers::*;

/// ## Summary
/// Test that attempting to set a protected property returns 403.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn proppatch_set_protected_prop_403() {
    // This test would:
    // 1. Create collection
    // 2. Send PROPPATCH attempting to set DAV:resourcetype (protected)
    // 3. Verify 207 Multi-Status with 403 in propstat
    // 4. Verify DB was not mutated
}

/// ## Summary
/// Test that attempting to remove a protected property returns 403.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn proppatch_remove_protected_prop_403() {
    // This test would:
    // 1. Create collection
    // 2. Send PROPPATCH attempting to remove DAV:getcontenttype (protected)
    // 3. Verify 207 Multi-Status with 403/409 in propstat
    // 4. Verify DB was not mutated
}

/// ## Summary
/// Test that setting DAV:displayname succeeds and persists.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn proppatch_set_displayname_200() {
    // This test would:
    // 1. Create collection with default displayname
    // 2. Send PROPPATCH to set new displayname
    // 3. Verify 207 Multi-Status with 200 in propstat
    // 4. Send PROPFIND to verify displayname was persisted
}

/// ## Summary
/// Test that setting description property succeeds (CalDAV/CardDAV).
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn proppatch_set_description_200() {
    // This test would:
    // 1. Create calendar collection
    // 2. Send PROPPATCH to set calendar-description
    // 3. Verify 207 Multi-Status with 200 in propstat
    // 4. Verify description was persisted in DB
}

/// ## Summary
/// Test that partial success is handled correctly.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn proppatch_partial_success_207() {
    // This test would:
    // 1. Create collection
    // 2. Send PROPPATCH with both writable (displayname) and protected (resourcetype) props
    // 3. Verify 207 Multi-Status
    // 4. Verify writable prop has 200 propstat
    // 5. Verify protected prop has 403 propstat
    // 6. Verify writable prop was persisted (atomic operation per prop)
}

/// ## Summary
/// Test that PROPPATCH is denied if user lacks write permission.
#[tokio::test]
#[ignore = "requires HTTP routing and auth"]
async fn proppatch_denied_no_mutation() {
    // This test would:
    // 1. Create collection owned by user A
    // 2. Grant read-only access to user B
    // 3. Send PROPPATCH as user B
    // 4. Verify 403 Forbidden
    // 5. Verify no properties were modified in DB
}

/// ## Summary
/// Test that PROPPATCH with invalid XML returns 400.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn proppatch_invalid_xml_400() {
    // This test would:
    // 1. Create collection
    // 2. Send PROPPATCH with malformed XML
    // 3. Verify 400 Bad Request
}

/// ## Summary
/// Test that removing a writable property succeeds.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn proppatch_remove_displayname() {
    // This test would:
    // 1. Create collection with displayname
    // 2. Send PROPPATCH to remove displayname
    // 3. Verify 207 Multi-Status with 200 in propstat
    // 4. Verify displayname is now empty/null
}

/// ## Summary
/// Test that setting multiple properties in one request works.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn proppatch_set_multiple_props() {
    // This test would:
    // 1. Create collection
    // 2. Send PROPPATCH setting displayname and description
    // 3. Verify 207 Multi-Status with 200 for both
    // 4. Verify both properties were persisted
}

/// ## Summary
/// Test that PROPPATCH transactions are atomic (all-or-nothing per spec).
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn proppatch_atomic_transaction() {
    // This test would:
    // 1. Create collection
    // 2. Send PROPPATCH with multiple prop changes, one of which will fail
    // 3. Verify that if spec requires atomicity, all changes are rolled back
    // 4. Or if partial success is allowed, verify appropriate propstat codes
    // Note: WebDAV spec allows both behaviors, document which is chosen
}
