# Phase 6: Synchronization

**Status**: ❌ **STUB ONLY (10%)**  
**Last Updated**: 2026-01-25

---

## Overview

Phase 6 implements RFC 6578 sync-collection support for efficient incremental synchronization. Instead of clients polling with full PROPFIND or calendar-query requests, sync-collection allows clients to request only resources that have changed since a previous sync token. This dramatically reduces bandwidth and server load for clients that sync frequently.

**Key Achievement**: Database schema supports sync tokens and tombstones correctly.

**Critical Gap**: All sync-collection report logic is marked TODO — no actual change detection or response building.

---

## Implementation Status

### ✅ Implemented Features

#### Schema Support

- [x] **`dav_instance.sync_revision`** — Monotonic revision counter
  - Auto-incremented on every create/update/delete
  - Scoped per collection (not global)
  - Type: `BIGINT` for 9 quintillion revisions before overflow
  
- [x] **`dav_tombstone`** — Deletion tombstones
  - Created on soft delete
  - Contains `sync_revision` of deletion
  - Tracks deleted resource URI for incremental sync
  - Allows clients to detect deletions
  
- [x] **`dav_collection.synctoken`** — Collection-level sync token
  - Equivalent to `MAX(sync_revision)` of all instances in collection
  - Returned in PROPFIND as `<D:sync-token>`
  - Used as baseline for sync-collection requests

#### Request Parsing

- [x] **`sync-collection` report XML parsing** — RFC 6578 §3
  - `<D:sync-collection xmlns:D="DAV:">`
  - `<D:sync-token>` extraction (baseline token)
  - `<D:sync-level>` parsing (must be "1" for now)
  - `<D:limit><D:nresults>` support
  - `<D:prop>` requested properties
  
- [x] **Depth enforcement** — RFC 6578 §4
  - Must be `Depth: 0` (collections only, not recursive)
  - Other depth values return 400 Bad Request

---

### ❌ Not Implemented

#### sync-collection Report Logic (`src/app/api/dav/method/report.rs`)

All core logic is marked TODO in `build_sync_collection_response()`. Missing functionality:

##### 1. Token Validation

**What's Missing**:
- [ ] Parse sync-token as `BIGINT` revision number
- [ ] Validate token is not from the future
- [ ] Validate token is within retention window (if purging old tombstones)
- [ ] Return `valid-sync-token` precondition error for invalid tokens

**Example Error Response**:
```xml
<D:error xmlns:D="DAV:">
  <D:valid-sync-token/>
</D:error>
```

**Recommended Implementation**:
```rust
let baseline_revision: i64 = sync_token.parse()?;
let current_revision = collection.synctoken;

if baseline_revision > current_revision {
    return Err(PreconditionError::ValidSyncToken);
}
```

##### 2. Change Detection

**What's Missing**:
- [ ] Query instances with `sync_revision > baseline_revision`
- [ ] Query tombstones with `sync_revision > baseline_revision`
- [ ] Filter to requested properties
- [ ] Apply limit (truncate if too many changes)

**Recommended Query**:
```rust
// Changed/new resources
let changed_instances = dav_instance::table
    .filter(dav_instance::collection_id.eq(collection_id))
    .filter(dav_instance::sync_revision.gt(baseline_revision))
    .filter(dav_instance::deleted_at.is_null())
    .order(dav_instance::sync_revision.asc())
    .limit(limit)
    .load::<Instance>(conn)?;

// Deleted resources
let tombstones = dav_tombstone::table
    .filter(dav_tombstone::collection_id.eq(collection_id))
    .filter(dav_tombstone::sync_revision.gt(baseline_revision))
    .order(dav_tombstone::sync_revision.asc())
    .limit(limit)
    .load::<Tombstone>(conn)?;
```

##### 3. Multistatus Response Building

**What's Missing**:
- [ ] Changed resources: `<D:response>` with full propstat (ETag, getlastmodified, calendar-data, etc.)
- [ ] Deleted resources: `<D:response>` with status-only (no propstat)
  ```xml
  <D:response>
    <D:href>/calendars/user/calendar/deleted-event.ics</D:href>
    <D:status>HTTP/1.1 404 Not Found</D:status>
  </D:response>
  ```
- [ ] New sync token in response: `<D:sync-token>{new_revision}</D:sync-token>`

**Recommended Response Structure**:
```xml
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>/calendars/user/calendar/changed-event.ics</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>"abc123"</D:getetag>
        <D:getlastmodified>Sat, 25 Jan 2026 12:00:00 GMT</D:getlastmodified>
        <C:calendar-data>BEGIN:VCALENDAR...</C:calendar-data>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/calendars/user/calendar/deleted-event.ics</D:href>
    <D:status>HTTP/1.1 404 Not Found</D:status>
  </D:response>
  <D:sync-token>42</D:sync-token>
</D:multistatus>
```

##### 4. New Token Generation

**What's Missing**:
- [ ] Return collection's current `synctoken` in `<D:sync-token>`
- [ ] Ensure token reflects latest revision after response

**Recommended Implementation**:
```rust
let new_token = collection.synctoken.to_string();
// Include in <D:sync-token> at end of multistatus
```

##### 5. Truncation Handling (507 Response)

**What's Missing** (RFC 6578 §5):
- [ ] Detect when change set exceeds reasonable limit (e.g., >1000 changes)
- [ ] Return `507 Insufficient Storage` with partial results
- [ ] Include `<D:sync-token>` representing partial progress
- [ ] Client can resume with next sync-collection request

**Example 507 Response**:
```xml
<D:error xmlns:D="DAV:">
  <D:number-of-matches-within-limits/>
</D:error>
```

**Recommended Implementation**:
```rust
const MAX_SYNC_RESULTS: usize = 1000;

let total_changes = changed_instances.len() + tombstones.len();
if total_changes > MAX_SYNC_RESULTS {
    // Return 507 with partial results
    // Sync token = last change included
    return Err(Error::TooManyChanges);
}
```

##### 6. Authorization Integration

**What's Missing**:
- [ ] Check read permission on collection before querying changes
- [ ] Filter results based on per-resource permissions (if implementing ACLs)

**Recommended Check**:
```rust
authorize::require(depot, &collection.principal_id, Action::Read)?;
```

---

### ⚠️ Partially Implemented

#### CTag Property (`DAV:getctag`)

**Current State**: Schema has `synctoken` but CTag not exposed in PROPFIND.

**What's Missing**:
- [ ] Add `DAV:getctag` to live properties in PROPFIND handler
- [ ] Map to `collection.synctoken`

**Note**: RFC 6578 deprecates CTag in favor of sync-collection, but some older clients still use it.

**Impact**: Low — sync-collection is superior and recommended.

---

## RFC Compliance

| RFC Requirement | Status | Impact |
|-----------------|--------|--------|
| RFC 6578 §3.1: DAV:sync-token | ⚠️ Partial | Schema ready, no handler logic |
| RFC 6578 §3.2: sync-collection | ❌ Stub only | No incremental sync |
| RFC 6578 §3.3: valid-sync-token | ❌ Missing | No token validation |
| RFC 6578 §4: Depth: 0 | ⚠️ Parsed | Enforcement not tested |
| RFC 6578 §5: Truncation (507) | ❌ Missing | No paging support |
| RFC 6578 §6: Deletion tombstones | ⚠️ Partial | Tombstones created but not queried |
| CalDAV: DAV:getctag | ❌ Missing | CTag not exposed |

**Compliance Score**: 0/7 required features (0%)

---

## Next Steps

### Immediate Priorities (Can Start Now)

1. **Implement sync-collection report** — HIGH PRIORITY
   - Token validation
   - Change detection queries
   - Multistatus response building
   - Estimated effort: 3-5 days

2. **Add integration tests** — MEDIUM PRIORITY
   - Test incremental sync flow
   - Test tombstone delivery
   - Test invalid token handling
   - Test truncation (507 response)
   - Estimated effort: 2-3 days

3. **Expose CTag property** — LOW PRIORITY
   - Add `DAV:getctag` to PROPFIND
   - Map to `synctoken`
   - Estimated effort: 1 day

### Nice-to-Have

4. **Optimize change detection queries** — MEDIUM PRIORITY
   - Add compound indexes on `(collection_id, sync_revision)`
   - Test performance with large change sets
   - Estimated effort: 1-2 days

5. **Implement tombstone purging** — LOW PRIORITY
   - Purge tombstones older than retention window (e.g., 30 days)
   - Return `valid-sync-token` error if token predates purge
   - Estimated effort: 2-3 days

---

## Performance Considerations

### Current Schema Performance

**Good**:
- `sync_revision` indexed per collection
- Tombstones stored separately (efficient joins)
- Monotonic counters avoid timestamp comparison issues

**Potential Issues**:
- Large change sets (>1000 changes) may cause memory issues
- No pagination support (all changes returned in one response)
- Tombstones never purged (grows indefinitely)

**Recommended Optimizations**:
1. Add compound index: `(collection_id, sync_revision, deleted_at)`
2. Implement result streaming for large change sets
3. Add tombstone purging with configurable retention

---

## Impact Analysis

**Without sync-collection**:
- Clients must use full PROPFIND + calendar-query on every poll
- Bandwidth usage: ~100KB-1MB per sync for typical calendar
- Server load: Full collection scan on every sync
- Battery drain: Clients poll more frequently to stay current

**With sync-collection**:
- Bandwidth usage: ~1-10KB for typical sync (only changes)
- Server load: Index scan for `sync_revision > token`
- Battery savings: Clients can poll more frequently with less overhead

**Impact**: Without sync-collection, the server doesn't scale for frequent polling. Essential for production deployment.

---

## Dependencies

**Blocks**: None — Phase 6 is a performance optimization, not a functional blocker.

**Depends On**: Phase 2 (Database Operations) — Sync revision and tombstones implemented.

---

## Next Phase: Phase 7

**Focus**: Free-Busy & Scheduling (free-busy-query, scheduling collections, iTIP)

**Status**: ❌ **NOT STARTED (0%)**
