#![allow(clippy::unused_async)]
//! Tests for REPORT method.
//!
//! Verifies expand-property, sync-collection, and other REPORT types.

#[expect(unused_imports)]
use super::helpers::*;

/// ## Summary
/// Test that expand-property expands a simple href property.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn expand_property_simple_href() {
    // This test would:
    // 1. Send expand-property REPORT requesting DAV:principal-URL with nested DAV:displayname
    // 2. Verify response contains the principal href
    // 3. Verify nested displayname is included in the response
    // 4. Verify XML structure is correct
}

/// ## Summary
/// Test that expand-property handles cycle detection correctly.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn expand_property_cycle_detection() {
    // This test would:
    // 1. Set up resources with circular references (A -> B -> A)
    // 2. Send expand-property that would follow the cycle
    // 3. Verify the response doesn't loop infinitely
    // 4. Verify visited resources are not expanded twice
}

/// ## Summary
/// Test that expand-property respects depth limits.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn expand_property_depth_limit() {
    // This test would:
    // 1. Set up deep nesting chain (A -> B -> C -> D -> ... -> K)
    // 2. Send expand-property with nested expansion
    // 3. Verify expansion stops at max depth (10)
    // 4. Verify no stack overflow occurs
}

/// ## Summary
/// Test that expand-property handles non-href properties correctly.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn expand_property_non_href() {
    // This test would:
    // 1. Send expand-property requesting a text property (like displayname)
    // 2. Verify response includes the property value
    // 3. Verify no expansion is attempted (since it's not an href)
}

/// ## Summary
/// Test that expand-property handles missing properties correctly.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn expand_property_missing_property() {
    // This test would:
    // 1. Send expand-property requesting a non-existent property
    // 2. Verify response includes empty or 404 propstat for missing property
    // 3. Verify other properties are still expanded correctly
}

/// ## Summary
/// Test that expand-property handles multiple properties.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn expand_property_multiple_properties() {
    // This test would:
    // 1. Send expand-property requesting multiple properties with different expansions
    // 2. Verify all properties are included in response
    // 3. Verify each property is expanded according to its specification
}

/// ## Summary
/// Test that expand-property handles href-set (multiple hrefs) correctly.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn expand_property_href_set() {
    // This test would:
    // 1. Request a property that returns multiple hrefs (like group-member-set)
    // 2. Verify all hrefs are expanded
    // 3. Verify nested properties are fetched for each href
    // 4. Verify cycle detection works across the set
}

/// ## Summary
/// Test expand-property for principal discovery use case.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn expand_property_principal_discovery() {
    // This test would:
    // 1. Send typical CardDAV principal discovery expand-property
    // 2. Request DAV:current-user-principal with nested properties
    // 3. Verify principal URL is returned
    // 4. Verify calendar-home-set and addressbook-home-set are included
}
