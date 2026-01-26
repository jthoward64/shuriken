# Phase 2: Database Operations

**Status**: ⚠️ **PARTIAL (~60%)**  
**Last Updated**: 2026-01-25 (Corrected Assessment)

---

## Overview

Phase 2 establishes the database layer for CalDAV/CardDAV content storage. It implements CRUD operations for entities, instances, and collections, along with ETag generation, sync revision tracking, and derived index population.

---

## Implementation Status

### ✅ Implemented

#### Entity Storage (`src/component/db/query/dav/entity/`)

- [x] `create_entity()` — Insert canonical entity
- [x] `insert_ical_tree()` — Insert component tree from parsed iCalendar
- [x] `replace_entity_tree()` — Delete and replace component tree
- [x] UID conflict detection via `check_uid_conflict()`

#### Instance Operations (`src/component/db/query/dav/instance/`)

- [x] `create_instance()` — Link entity to collection
- [x] `update_instance()` — Update ETag and sync revision
- [x] `by_collection_and_uri()` — Query by collection and URI
- [x] `generate_etag()` — Content-based ETag generation

#### Collection Operations (`src/component/db/query/dav/collection.rs`)

- [x] `get_collection()` — Retrieve collection metadata
- [x] `update_synctoken()` — Increment collection sync token

#### Index Population

- [x] `cal_index` populated on PUT via `build_cal_indexes()`
- [x] `cal_occurrence` populated on PUT via `expand_and_store_occurrences()`
- [x] Occurrence deletion on entity update

---

### ❌ NOT Implemented / Critical Gaps

#### 1. No Database Transactions — **CRITICAL**

**Status**: Explicit TODO in code

**Evidence**:
- `src/component/caldav/service/object.rs:153`: `// TODO: Use a transaction for atomic updates`
- `src/component/carddav/service/object.rs:146`: `// TODO: Use a transaction for atomic updates`

**Impact**: A failure mid-PUT leaves inconsistent state (entity created, no instance; indexes stale).

**Risk**: Data corruption on partial failures.

**Fix Required**: Wrap operations in `conn.transaction(|tx| { ... })`.

#### 2. GET Uses Shadow Table, Not Component Tree

**Status**: By design (workaround)

**Evidence**: GET handler reads from `dav_shadow.raw_canonical` not reconstructed tree.

**Impact**: The component tree (`dav_component`, `dav_property`, `dav_parameter`) is effectively write-only.

**Options**:
- (A) Implement tree→content reconstruction
- (B) Remove tree tables, keep only shadow + indexes

#### 3. `card_index` Population Unverified

**Status**: Code exists but not confirmed working

**Evidence**: `src/component/db/map/carddav.rs` exists with extraction logic.

**Impact**: CardDAV queries may not work correctly.

#### 4. Tombstone Creation on DELETE Unverified

**Status**: Code structure exists

**Evidence**: `dav_tombstone` table and query functions exist.

**Impact**: Sync protocol may miss deletions.

#### 5. TZID Resolution Incomplete

**Status**: Partial

**Evidence**: 
- `src/component/db/map/dav/extract.rs:133`: `// TODO: Handle TZID resolution in the future`

**Impact**: `cal_index.dtstart_utc` may be incorrect for events with custom TZIDs.

---

## Database Improvement Recommendations

### 🔴 Critical

#### 1. Add Transaction Wrapper
```rust
// Current (broken):
let entity = create_entity(conn, &model).await?;
let instance = create_instance(conn, &new_instance).await?;
// If this fails, entity is orphaned!
update_synctoken(conn, collection_id).await?;

// Fixed:
conn.transaction(|tx| async {
    let entity = create_entity(tx, &model).await?;
    let instance = create_instance(tx, &new_instance).await?;
    update_synctoken(tx, collection_id).await?;
    Ok((entity, instance))
}).await?;
```

### 🟡 Medium Priority

#### 2. Decide on Tree vs Shadow Storage
Either implement reconstruction from tree OR remove tree tables.

#### 3. Add Integration Tests for Index Population
Verify `cal_index`, `card_index`, `cal_occurrence` are correctly populated.

---

## RFC Compliance

| Requirement | Status | Notes |
|-------------|--------|-------|
| RFC 4791 §4.1: One UID per resource | ✅ Enforced | `check_uid_conflict()` |
| RFC 6578: Sync token monotonicity | ✅ Implemented | Revision counter per collection |
| RFC 6578: Tombstone creation | ⚠️ Unverified | Code exists but needs testing |
| RFC 4791 §9.6: ETag stability | ✅ Implemented | Strong ETags from content hash |
| RFC 5545 §3.8.5: Recurrence expansion | ✅ Implemented | `expand_and_store_occurrences()` |
| Atomicity | ❌ NOT IMPLEMENTED | No transactions |

---

## Effort Estimate

| Task | Effort |
|------|--------|
| Add transaction wrapper | 2-3 days |
| Verify index population | 1-2 days |
| Verify tombstone creation | 1 day |
| Tree reconstruction OR removal | 3-5 days |

**Total**: ~1-2 weeks to complete Phase 2 properly

## Next Phase: Phase 3

**Focus**: Basic HTTP Methods (OPTIONS, PROPFIND, PROPPATCH, GET, PUT, DELETE, COPY, MOVE)

**Status**: ⚠️ **MOSTLY COMPLETE (90%)**
