#![allow(clippy::unused_async)]
//! Tests for COPY and MOVE methods.
//!
//! Verifies destination rules, href updates, and tombstone generation.

#[expect(unused_imports)]
use super::helpers::*;

/// ## Summary
/// Test that MOVE renames a resource and updates href.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn move_rename_item_updates_href() {
    // This test would:
    // 1. Create resource at source URI
    // 2. Send MOVE with Destination header (new URI in same collection)
    // 3. Verify 201 Created or 204 No Content
    // 4. Verify resource exists at destination URI
    // 5. Verify resource no longer exists at source URI (or is soft-deleted)
}

/// ## Summary
/// Test that MOVE updates sync token for both source and destination collections.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn move_rename_updates_sync_token() {
    // This test would:
    // 1. Create two collections with resources
    // 2. Capture initial sync_tokens
    // 3. Send MOVE from collection A to collection B
    // 4. Verify sync_token increased for both collections
}

/// ## Summary
/// Test that COPY duplicates a resource to destination.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn copy_duplicates_resource() {
    // This test would:
    // 1. Create resource at source URI
    // 2. Send COPY with Destination header
    // 3. Verify 201 Created
    // 4. Verify resource exists at both source and destination
    // 5. Verify destination has different ETag (new instance)
}

/// ## Summary
/// Test that CardDAV addressbook-collection-location-ok precondition is enforced.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn copy_addressbook_collection_location_ok() {
    // This test would:
    // 1. Create addressbook and vcard resource
    // 2. Send COPY/MOVE to destination that's not an addressbook
    // 3. Verify 403 Forbidden with addressbook-collection-location-ok precondition
}

/// ## Summary
/// Test that MOVE/COPY with existing destination handles conflicts.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn move_destination_exists_conflict() {
    // This test would:
    // 1. Create resources at both source and destination URIs
    // 2. Send MOVE without Overwrite header (or Overwrite:F)
    // 3. Verify 412 Precondition Failed
    // 4. Send MOVE with Overwrite:T
    // 5. Verify success and destination is replaced
}

/// ## Summary
/// Test that MOVE generates tombstone for source resource.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn move_generates_tombstone_on_source_delete() {
    // This test would:
    // 1. Create resource
    // 2. Send MOVE to new destination
    // 3. Verify tombstone exists for source URI
    // 4. Verify tombstone contains correct sync_revision
}

/// ## Summary
/// Test that COPY does not create tombstone (source still exists).
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn copy_does_not_create_tombstone() {
    // This test would:
    // 1. Create resource
    // 2. Send COPY to new destination
    // 3. Verify no tombstone for source URI
    // 4. Verify source still exists
}

/// ## Summary
/// Test that MOVE within same collection updates instance.uri.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn move_within_collection() {
    // This test would:
    // 1. Create collection with resource
    // 2. Capture instance_id
    // 3. Send MOVE to new URI in same collection
    // 4. Verify same instance_id exists with new URI
}

/// ## Summary
/// Test that MOVE across collections creates new instance.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn move_across_collections() {
    // This test would:
    // 1. Create two collections
    // 2. Create resource in collection A
    // 3. Send MOVE to collection B
    // 4. Verify new instance exists in collection B
    // 5. Verify old instance in collection A is soft-deleted or removed
}

/// ## Summary
/// Test that Depth:infinity is rejected for COPY/MOVE on collections.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn copy_move_depth_infinity_on_collection() {
    // This test would:
    // 1. Create collection with items
    // 2. Send COPY/MOVE with Depth:infinity
    // 3. Verify either:
    //    a) 400 Bad Request (not supported)
    //    b) Recursive copy/move succeeds (if supported)
    // 4. Document the chosen behavior
}
