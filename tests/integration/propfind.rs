#![allow(clippy::unused_async)]
//! Tests for PROPFIND method.
//!
//! Verifies property retrieval, Depth handling, and multistatus responses.

#[expect(unused_imports)]
use super::helpers::*;

/// ## Summary
/// Test that PROPFIND Depth:0 on a collection returns only the collection.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn propfind_depth0_collection() {
    // This test would:
    // 1. Create collection with multiple items
    // 2. Send PROPFIND with Depth:0
    // 3. Verify response contains exactly 1 <response> element (the collection)
    // 4. Verify items are NOT included
}

/// ## Summary
/// Test that PROPFIND Depth:1 returns collection and immediate members.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn propfind_depth1_collection() {
    // This test would:
    // 1. Create collection with 3 items
    // 2. Send PROPFIND with Depth:1
    // 3. Verify response contains 4 <response> elements (collection + 3 items)
    // 4. Verify href values are correct
}

/// ## Summary
/// Test that PROPFIND Depth:infinity is rejected or supported consistently.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn propfind_depth_infinity_rejected_or_supported() {
    // This test would:
    // 1. Send PROPFIND with Depth:infinity
    // 2. If rejected: verify 403 with DAV:propfind-finite-depth precondition
    // 3. If supported: verify response includes nested collections recursively
    // 4. Document the chosen behavior
}

/// ## Summary
/// Test that known properties return 200 propstat.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn propfind_known_props_200() {
    // This test would:
    // 1. Create collection
    // 2. Send PROPFIND requesting known props (DAV:displayname, DAV:resourcetype)
    // 3. Verify each property has <propstat> with <status>HTTP/1.1 200 OK</status>
    // 4. Verify property values are correct
}

/// ## Summary
/// Test that unknown properties return 404 propstat.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn propfind_unknown_props_404() {
    // This test would:
    // 1. Create collection
    // 2. Send PROPFIND requesting unknown prop (custom:nonexistent)
    // 3. Verify property has <propstat> with <status>HTTP/1.1 404 Not Found</status>
}

/// ## Summary
/// Test that mixed known/unknown properties return 207 with separate propstats.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn propfind_mixed_props_207() {
    // This test would:
    // 1. Create collection
    // 2. Send PROPFIND requesting both known and unknown properties
    // 3. Verify 207 Multi-Status response
    // 4. Verify 200 propstat for known props
    // 5. Verify 404 propstat for unknown props
}

/// ## Summary
/// Test that calendar collections advertise calendar-specific reports.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn propfind_supported_report_set_calendar() {
    // This test would:
    // 1. Create calendar collection
    // 2. Send PROPFIND for DAV:supported-report-set
    // 3. Verify response includes calendar-query, calendar-multiget, free-busy-query
    // 4. Only include reports that are actually implemented
}

/// ## Summary
/// Test that addressbook collections advertise carddav-specific reports.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn propfind_supported_report_set_addressbook() {
    // This test would:
    // 1. Create addressbook collection
    // 2. Send PROPFIND for DAV:supported-report-set
    // 3. Verify response includes addressbook-query, addressbook-multiget
    // 4. Only include reports that are actually implemented
}

/// ## Summary
/// Test that advertised reports are actually accepted by REPORT method.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn propfind_supported_report_set_consistency() {
    // This test would:
    // 1. Send PROPFIND for DAV:supported-report-set
    // 2. Extract list of advertised reports
    // 3. For each report, send a REPORT request
    // 4. Verify it returns 207 or other success (not 501 Not Implemented)
}

/// ## Summary
/// Test that unauthenticated PROPFIND on protected collection returns 401.
#[tokio::test]
#[ignore = "requires HTTP routing and auth"]
async fn propfind_unauthenticated_401() {
    // This test would:
    // 1. Create protected collection (requires auth)
    // 2. Send PROPFIND without credentials
    // 3. Verify 401 Unauthorized response
    // 4. Verify WWW-Authenticate header is present
}

/// ## Summary
/// Test that authenticated but unauthorized user gets 403.
#[tokio::test]
#[ignore = "requires HTTP routing and auth"]
async fn propfind_unauthorized_403() {
    // This test would:
    // 1. Create collection owned by user A
    // 2. Send PROPFIND as authenticated user B (no access granted)
    // 3. Verify 403 Forbidden response
}

/// ## Summary
/// Test that PROPFIND allprop returns reasonable set of properties.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn propfind_allprop() {
    // This test would:
    // 1. Create collection with standard properties
    // 2. Send PROPFIND with <allprop/>
    // 3. Verify response includes common properties
    // 4. Verify expensive properties (like calendar-data) are excluded from allprop
}

/// ## Summary
/// Test that PROPFIND propname returns property names without values.
#[tokio::test]
#[ignore = "requires HTTP routing"]
async fn propfind_propname() {
    // This test would:
    // 1. Create collection
    // 2. Send PROPFIND with <propname/>
    // 3. Verify response includes property elements
    // 4. Verify property elements are empty (no values)
}
