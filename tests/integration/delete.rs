#![allow(clippy::doc_markdown, clippy::unused_async)]
//! Tests for DELETE method.
//!
//! Verifies resource deletion, tombstone creation, and idempotency.

#[allow(unused_imports)]
use super::helpers::*;

/// ## Summary
/// Test that DELETE creates a tombstone and bumps sync token.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn delete_item_creates_tombstone() {
    // This test would:
    // 1. Create collection with resource
    // 2. Capture initial sync_token
    // 3. Send DELETE request
    // 4. Verify 204 No Content
    // 5. Verify tombstone row exists in DB
    // 6. Verify sync_token increased
}

/// ## Summary
/// Test that DELETE on already-deleted resource is idempotent.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn delete_item_idempotent() {
    // This test would:
    // 1. Create resource
    // 2. Send DELETE (first delete)
    // 3. Verify 204 No Content
    // 4. Send DELETE again (second delete)
    // 5. Verify either:
    //    a) 404 Not Found (resource already deleted)
    //    b) 204 No Content (idempotent success)
    // 6. Document the chosen behavior
}

/// ## Summary
/// Test that DELETE on collection is recursive or rejected.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn delete_collection_recursive_or_rejected() {
    // This test would:
    // 1. Create collection with multiple items
    // 2. Send DELETE to collection URI
    // 3. If recursive delete is supported:
    //    - Verify 204 No Content
    //    - Verify all items are soft-deleted
    //    - Verify collection is soft-deleted
    // 4. If recursive delete is not supported:
    //    - Verify 403 Forbidden
    //    - Verify collection and items are unchanged
}

/// ## Summary
/// Test that DELETE collection does not leave orphaned instances.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn delete_collection_does_not_leave_orphans() {
    // This test would:
    // 1. Create collection with items
    // 2. Send DELETE to collection (if recursive delete is supported)
    // 3. Query dav_instance table
    // 4. Verify no instances reference deleted collection (or all are soft-deleted)
}

/// ## Summary
/// Test that DELETE with If-Match precondition works.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn delete_if_match_success() {
    // This test would:
    // 1. Create resource with known ETag
    // 2. Send DELETE with If-Match: <correct-etag>
    // 3. Verify 204 No Content
    // 4. Verify resource is deleted
}

/// ## Summary
/// Test that DELETE with mismatched If-Match returns 412.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn delete_if_match_mismatch_412() {
    // This test would:
    // 1. Create resource with known ETag
    // 2. Send DELETE with If-Match: "wrong-etag"
    // 3. Verify 412 Precondition Failed
    // 4. Verify resource was not deleted
}

/// ## Summary
/// Test that DELETE on non-existent resource returns 404.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn delete_nonexistent_404() {
    // This test would:
    // 1. Send DELETE to non-existent URI
    // 2. Verify 404 Not Found
}

/// ## Summary
/// Test that DELETE is denied if user lacks permission.
#[tokio::test]
#[ignore = "requires HTTP routing and auth"]
async fn delete_unauthorized_403() {
    // This test would:
    // 1. Create resource owned by user A
    // 2. Grant read-only access to user B
    // 3. Send DELETE as user B
    // 4. Verify 403 Forbidden
    // 5. Verify resource was not deleted
}

/// ## Summary
/// Test that DELETE bumps collection sync token.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn delete_bumps_synctoken() {
    // This test would:
    // 1. Create collection with resource
    // 2. Capture initial sync_token
    // 3. Send DELETE
    // 4. Query collection sync_token
    // 5. Verify sync_token increased
}

/// ## Summary
/// Test that tombstone contains correct metadata.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn delete_tombstone_metadata() {
    // This test would:
    // 1. Create resource with known URI and collection_id
    // 2. Send DELETE
    // 3. Query dav_tombstone table
    // 4. Verify tombstone has correct:
    //    - collection_id
    //    - uri
    //    - sync_revision (matches collection's new sync_token)
}
