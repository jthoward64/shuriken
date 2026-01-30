#![allow(clippy::unused_async)]
//! Tests for instance operations.
//!
//! Verifies instance CRUD, ETag generation and stability, tombstone creation, and idempotency.

#[expect(unused_imports)]
use super::fixtures::*;
use crate::db::query::dav::instance::generate_etag;

/// ## Summary
/// Test that `generate_etag` produces consistent output for same input.
#[test]
fn generate_etag_deterministic() {
    let content = b"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";

    let etag1 = generate_etag(content);
    let etag2 = generate_etag(content);

    assert_eq!(etag1, etag2, "ETag should be deterministic");
    assert!(etag1.starts_with('"'), "ETag should be quoted");
    assert!(etag1.ends_with('"'), "ETag should be quoted");
}

/// ## Summary
/// Test that `generate_etag` produces different output for different input.
#[test]
fn generate_etag_different_content() {
    let content1 = b"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";
    let content2 = b"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:test\r\nEND:VCALENDAR\r\n";

    let etag1 = generate_etag(content1);
    let etag2 = generate_etag(content2);

    assert_ne!(
        etag1, etag2,
        "Different content should produce different ETags"
    );
}
