# Shuriken CalDAV/CardDAV Implementation: Overall Status

**Last Updated**: 2026-01-25 (Corrected Assessment)  
**Overall Progress**: ~45-50% complete  
**Production Ready**: ❌ Not yet (significant gaps in core functionality)

---

## Executive Summary

Shuriken has a **solid foundation** but the previous status was significantly overstated. Current state:

**What Actually Works:**
- ✅ Database schema is complete and well-designed
- ✅ iCalendar/vCard parsing and serialization (IANA timezones only)
- ✅ Basic HTTP method handlers exist (OPTIONS, PROPFIND, GET, PUT, DELETE, COPY)
- ✅ RRULE expansion engine integrated with `rrule` crate
- ✅ `cal_occurrence` table populated on PUT

**Critical Gaps:**
- ❌ **No transactionality** - PUT operations are not atomic (explicit TODOs in code)
- ❌ **Authorization not wired** - `authorize::require()` exists but handlers don't call it
- ❌ **sync-collection returns empty** - function body is entirely TODO
- ❌ **VTIMEZONE parsing missing** - only IANA timezone names work
- ❌ **MKCOL/MKCALENDAR incomplete** - have explicit TODO comments
- ❌ **Property fetching uses stubs** - expand-property returns hardcoded paths

**Immediate Priorities:**
1. Wire authorization into handlers (security-critical)
2. Add database transactions (data integrity)
3. Implement sync-collection (client sync broken without it)
4. Well-known URIs for discovery

---

## Phase Status Overview (Corrected)

| Phase | Name | Status | Completion | Priority | Est. Effort |
|-------|------|--------|------------|----------|-------------|
| [Phase 0](Phase%200.md) | Database Schema | ✅ Complete | 100% | — | Complete |
| [Phase 1](Phase%201.md) | Parsing & Serialization | ⚠️ Mostly Complete | ~90% | P2 | 2-3 days |
| [Phase 2](Phase%202.md) | Database Operations | ⚠️ Partial | ~60% | P1 | 1 week |
| [Phase 3](Phase%203.md) | Basic HTTP Methods | ⚠️ Partial | ~70% | P1 | 1 week |
| [Phase 4](Phase%204.md) | Query Reports | ⚠️ Partial | ~60% | P2 | 1 week |
| [Phase 5](Phase%205.md) | Recurrence & Timezones | ⚠️ Partial | ~70% | P2 | 3-5 days |
| [Phase 6](Phase%206.md) | Synchronization | ❌ Stub Only | ~5% | P1 | 1-2 weeks |
| [Phase 7](Phase%207.md) | Free-Busy & Scheduling | ❌ Not Started | 0% | P3 | 2-3 weeks |
| [Phase 8](Phase%208.md) | Authorization | ⚠️ Infrastructure Only | ~25% | P1 | 1 week |
| [Phase 9](Phase%209.md) | Discovery & Polish | ❌ Not Started | 0% | P1 | 1-2 weeks |

---

## Critical Path to Production

### 🚨 Blocking Issues (Must Fix First)

#### 1. Authorization Not Wired — **P0 (Security Critical)**
**Current State**: `authorize::require()` exists but handlers don't call it. Any request can access any resource.

**Effort**: 3-5 days

#### 2. No Database Transactions — **P0 (Data Integrity)**
**Current State**: PUT handlers have explicit `// TODO: Use a transaction for atomic updates` comments. A failure mid-operation leaves inconsistent state.

**Effort**: 2-3 days

#### 3. sync-collection Returns Empty — **P1**
**Current State**: `build_sync_collection_response()` returns `Multistatus::new()` with TODO comments. Clients cannot sync.

**Effort**: 1 week

#### 4. Well-Known URIs Missing — **P1**
**Current State**: No `/.well-known/caldav` or `/.well-known/carddav` endpoints. Clients cannot auto-discover.

**Effort**: 2-3 days

---

## RFC Compliance Status (Corrected)

### ⚠️ Mostly Compliant (with gaps)
- **RFC 5545** (iCalendar) — ~90% (VTIMEZONE parsing missing)
- **RFC 6350** (vCard) — ~95%
- **RFC 6868** (Parameter Encoding) — 100%

### ⚠️ Partially Compliant
- **RFC 4791** (CalDAV) — ~50% (sync, free-busy, scheduling missing)
- **RFC 4918** (WebDAV) — ~60% (MKCOL incomplete, no LOCK)
- **RFC 6352** (CardDAV) — ~70% (text-match on arbitrary properties incomplete)
- **RFC 6578** (WebDAV Sync) — ~5% (stub only)
- **RFC 3744** (WebDAV ACL) — ~25% (infrastructure only, not enforced)

### ❌ Not Compliant
- **RFC 6638** (CalDAV Scheduling) — 0%
- **RFC 5546** (iTIP) — 0%
- **RFC 6764** (Service Discovery) — 0%

---

## Test Coverage Reality

**Total tests**: 459 `#[test]` functions, 114 `#[tokio::test]` async tests

**Warning**: Most integration tests are marked `#[ignore = "requires database seeding"]` and don't run in CI.

### Actually Running
- Parser/serializer unit tests
- Value parsing tests
- XML parsing tests

### Ignored (Need Database)
- PUT/GET/DELETE integration tests
- PROPFIND integration tests
- Report integration tests

---

## Database Improvement Recommendations

### 🔴 Critical Changes

#### 1. Remove `dav_shadow` Dependency
**Problem**: GET responses read raw bytes from `dav_shadow.raw_canonical` instead of reconstructing from component tree.
**Impact**: The component tree (`dav_component`, `dav_property`, `dav_parameter`) is unused for output.
**Recommendation**: Either:
- (A) Delete component tree tables and store only raw bytes (simpler)
- (B) Implement proper tree→iCalendar/vCard reconstruction (correct)

#### 2. Add Proper Indexes for Time-Range Queries
**Problem**: `cal_occurrence` lacks composite indexes for common query patterns.
**Recommendation**:
```sql
CREATE INDEX idx_cal_occurrence_entity_time 
  ON cal_occurrence (entity_id, start_utc, end_utc) 
  WHERE deleted_at IS NULL;
```

#### 3. Consider Removing `dav_entity` Table
**Problem**: Entity/instance separation adds complexity but content sharing across collections is rare.
**Recommendation**: For MVP, merge entity into instance. Add entity separation later if needed.

### 🟡 Moderate Changes

#### 4. Add `collection_id` to `cal_index` and `cal_occurrence`
**Problem**: Queries must join through `dav_instance` to filter by collection.
**Recommendation**: Denormalize `collection_id` into index tables for faster queries.

#### 5. Add VTIMEZONE Cache Table Usage
**Problem**: `cal_timezone` table exists but isn't used. Timezone resolution only uses `chrono-tz`.
**Recommendation**: Either use it for custom VTIMEZONE storage or remove it.

#### 6. Simplify Property Storage
**Problem**: Typed value columns (`value_text`, `value_int`, `value_float`, `value_datetime`, `value_bool`) are complex.
**Recommendation**: Consider storing parsed properties as JSONB for flexibility, or raw text for simplicity.

### 🟢 Minor Optimizations

#### 7. Add Full-Text Search for CardDAV
**Problem**: `card_index.search_tsv` exists but isn't populated.
**Recommendation**: Populate on insert for efficient contact search.

#### 8. Consider Partitioning for Large Deployments
**Problem**: `cal_occurrence` can grow very large with recurring events.
**Recommendation**: Consider range partitioning by `start_utc` for large deployments.

---

## Architecture Decision: Simplification Option

For faster time-to-production, consider this simplified architecture:

### Current (Complex)
```
Request → Parse → Component Tree → DB Tables → Reconstruct → Serialize → Response
```

### Simplified Option
```
Request → Parse → Validate → Store Raw Bytes → Return Raw Bytes → Response
```

**Trade-offs**:
- ✅ Much simpler implementation
- ✅ Perfect round-trip fidelity
- ✅ Faster development
- ❌ Less query flexibility (must parse for each filter)
- ❌ Harder to implement CalDAV-specific features

**Recommendation**: The current schema is good but underutilized. Either:
1. Commit to tree storage: Implement proper reconstruction from tree
2. Simplify: Remove tree tables, store only raw bytes + indexes

---

## Conclusion

Shuriken has **good infrastructure** but is **not production-ready**. The 70% completion estimate was optimistic; actual completion is ~45-50%.

**Immediate priorities**:
1. Wire authorization (security)
2. Add transactions (data integrity)  
3. Implement sync-collection (client compatibility)
4. Add well-known URIs (discovery)

**Estimated time to MVP**: 4-6 weeks of focused development

**With 4-5 weeks of focused effort on Phases 5, 6, and 9**, Shuriken would be a fully functional CalDAV/CardDAV server ready for production use.

The codebase follows good practices:
- Clean module organization
- Comprehensive test coverage for completed features
- RFC-compliant implementations
- Flexible architecture for future extensions

**Next Priority**: Begin Phase 5 implementation immediately to unblock production readiness.
