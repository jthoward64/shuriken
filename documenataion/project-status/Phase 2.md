# Phase 2: Database Operations

**Status**: ⚠️ **MOSTLY COMPLETE (~85%)**  
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
- [x] Atomic DELETE operations with sync token updates and tombstones

---

### ❌ NOT Implemented / Critical Gaps

#### 1. CardDAV Email/Phone Index Population Missing

**Status**: Not implemented

**Evidence**:
- `card_email`/`card_phone` tables exist but are not populated during CardDAV PUT.
- No mapping layer for email/phone extraction in `src/component/carddav/service/object.rs`.

**Impact**: Addressbook queries that rely on `card_email`/`card_phone` will return empty results.

---

## RFC Compliance

| Requirement | Status | Notes |
|-------------|--------|-------|
| RFC 4791 §4.1: One UID per resource | ✅ Enforced | `check_uid_conflict()` |
| RFC 6578: Sync token monotonicity | ✅ Implemented | Revision counter per collection |
| RFC 6578: Tombstone creation | ✅ Implemented | Covered by DB and integration tests |
| RFC 4791 §9.6: ETag stability | ✅ Implemented | Strong ETags from content hash |
| RFC 5545 §3.8.5: Recurrence expansion | ✅ Implemented | `expand_and_store_occurrences()` |
| Atomicity | ✅ Implemented | Transactions for PUT + MOVE |

---

## Effort Estimate

| Task | Effort |
|------|--------|
| Populate `card_email` + `card_phone` indexes | 1-2 days |

**Total**: ~2 days to finish Phase 2

## Next Phase: Phase 3

**Focus**: Basic HTTP Methods (OPTIONS, PROPFIND, PROPPATCH, GET, PUT, DELETE, COPY, MOVE)

**Status**: ⚠️ **PARTIAL (~60%)**
