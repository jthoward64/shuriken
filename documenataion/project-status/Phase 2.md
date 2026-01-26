# Phase 2: Database Operations

**Status**: ⚠️ **PARTIAL (~75%)**  
**Last Updated**: 2026-01-26

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
- [x] Canonical reconstruction for GET/HEAD via `get_entity_with_tree()` + serializers

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
- [x] Integration tests for `cal_index`, `cal_occurrence`, `card_index`

#### Transactions

- [x] Atomic PUT operations in CalDAV/CardDAV services
- [x] Atomic MOVE operations with sync token updates and tombstones

---

### ❌ NOT Implemented / Critical Gaps

#### 1. TZID Resolution Incomplete

**Status**: Partial

**Evidence**: 
- `src/component/db/map/dav/extract.rs:133`: `// TODO: Handle TZID resolution in the future`

**Impact**: `cal_index.dtstart_utc` may be incorrect for events with custom TZIDs.

---

## Database Improvement Recommendations

### 🔴 Critical

### 🟡 Medium Priority

#### 1. Confirm Tree Fidelity and Shadow Role
~~Tree reconstruction is used for GET/HEAD, and `dav_shadow` remains debug-only until removal.
Add and maintain tests that validate tree→content parity (ordering, parameters, folding)
without relying on `dav_shadow`.~~

#### 2. Add Integration Tests for Index Population
~~Verify `cal_index`, `card_index`, `cal_occurrence` are correctly populated.~~

---

## RFC Compliance

| Requirement | Status | Notes |
|-------------|--------|-------|
| RFC 4791 §4.1: One UID per resource | ✅ Enforced | `check_uid_conflict()` |
| RFC 6578: Sync token monotonicity | ✅ Implemented | Revision counter per collection |
| RFC 6578: Tombstone creation | ⚠️ Unverified | Code exists but needs testing |
| RFC 4791 §9.6: ETag stability | ✅ Implemented | Strong ETags from content hash |
| RFC 5545 §3.8.5: Recurrence expansion | ✅ Implemented | `expand_and_store_occurrences()` |
| Atomicity | ✅ Implemented | Transactions for PUT + MOVE |

---

## Effort Estimate

| Task | Effort |
|------|--------|
| Tree reconstruction OR removal | 3-5 days |

**Total**: ~1 week to complete Phase 2 properly

## Next Phase: Phase 3

**Focus**: Basic HTTP Methods (OPTIONS, PROPFIND, PROPPATCH, GET, PUT, DELETE, COPY, MOVE)

**Status**: ⚠️ **MOSTLY COMPLETE (90%)**
