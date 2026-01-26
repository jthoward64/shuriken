# Phase 4: Query Reports

**Status**: ⚠️ **PARTIAL (~40%)**  
**Last Updated**: 2026-01-26 (Corrected Assessment)

---

## Overview

Phase 4 implements the REPORT method with CalDAV and CardDAV query reports. These reports enable clients to efficiently query calendar events and contact cards using filters (component type, time-range, property matching) and retrieve multiple resources in a single request.

---

## Implementation Status

### ✅ Implemented

#### calendar-query Report (`src/app/api/caldav/report/calendar_query.rs`)

- [x] **Filter evaluation** (`src/component/db/query/caldav/filter.rs`)
  - **Component filters**: VEVENT, VTODO, VJOURNAL, VFREEBUSY
  - **Time-range filtering**:
    - Queries `cal_index` for non-recurring events
    - Queries `cal_occurrence` for recurring event occurrences
  - **Property filters** (text-match on indexed properties only)
  - **Limit support**: `<C:limit><C:nresults>N</C:nresults></C:limit>`

- [x] **Multistatus response generation**
  - RFC 4918 §13 compliant XML

#### calendar-multiget Report (`src/app/api/caldav/report/calendar_multiget.rs`)

- [x] **Href-based retrieval** — Fetch multiple resources by URI
- [x] **404 propstat for missing resources**

#### addressbook-query Report (`src/app/api/carddav/report/addressbook_query.rs`)

- [x] **Filter evaluation** (`src/component/db/query/carddav/filter.rs`)
  - **Property filters**: FN, EMAIL, TEL (indexed properties)
  - **anyof/allof logic**
  - **Limit support**

#### addressbook-multiget Report (`src/app/api/carddav/report/addressbook_multiget.rs`)

- [x] **Href-based retrieval** — Batch vCard fetch
- [x] **404 propstat for missing resources**

---

### ⚠️ Partially Implemented

#### expand-property Report (`src/app/api/dav/method/report.rs`)

**Status**: Parser and framework exist, but uses STUB property fetching.

**Evidence**: `build_expand_property_response()` returns hardcoded paths for `calendar-home-set` and `addressbook-home-set` rather than querying the database.

**Code Reference**: Lines 55-105 in `src/app/api/dav/method/report.rs`

**Impact**: Clients cannot reliably discover resources via expand-property.

#### Partial Retrieval (calendar-data, address-data)

**Status**: Parsing exists but reconstruction from component tree NOT implemented.

**Evidence**: GET uses `dav_shadow.raw_canonical` bytes, not component tree.

**Impact**: Property selection (`<C:prop><C:calendar-data>...</C:calendar-data></C:prop>`) cannot filter content.

#### Text-Match on Arbitrary Properties

**Status**: Only works for indexed properties.

**Evidence**: `src/component/db/query/carddav/filter.rs:128` shows text-match queries `card_index` table, not full vCard content.

**Impact**: Clients cannot filter on NICKNAME, ORG, TITLE, ADR, NOTE, etc.

---

### ❌ NOT Implemented

#### Authorization in Reports — **CRITICAL**

**Status**: Report handlers do NOT call `authorize::require()`.

**Impact**: Any authenticated user can query any collection's contents.

#### free-busy-query Report — RFC 4791 §7.10

**Status**: Not implemented. Covered in Phase 7.

#### sync-collection Report — RFC 6578

**Status**: Returns empty Multistatus with TODO comment. See Phase 6.

---

## RFC Compliance

| RFC Requirement | Status | Notes |
|-----------------|--------|-------|
| RFC 4791 §7.8: calendar-query | ⚠️ Partial | Time-range works, text-match limited |
| RFC 4791 §7.9: calendar-multiget | ✅ Implemented | Full support |
| RFC 6352 §8.6: addressbook-query | ⚠️ Partial | Only indexed properties |
| RFC 6352 §8.7: addressbook-multiget | ✅ Implemented | Full support |
| RFC 3253 §3.8: expand-property | ⚠️ Stub | Hardcoded paths, not DB-backed |
| RFC 4791 §9.9: Time-range recurrence | ✅ Implemented | Uses cal_occurrence table |
| RFC 4791 §9.10: Partial retrieval | ❌ NOT Implemented | Cannot filter properties |
| RFC 6352 §10.5: Text-match collation | ⚠️ Partial | Unicode casemap only |
| Authorization | ❌ NOT Implemented | Critical security gap |

---

## Effort Estimate

| Task | Effort |
|------|--------|
| Wire authorization into all report handlers | 2-3 days |
| Implement database-backed expand-property | 3-5 days |
| Implement partial retrieval (component tree reconstruction) | 5-7 days |
| Text-match on arbitrary vCard properties | 3-5 days |
| Add missing collation support | 1-2 days |

**Total**: ~3 weeks to complete Phase 4 properly

---

### ❌ Not Implemented

- [ ] **free-busy-query Report** — RFC 4791 §7.10
  - Covered in Phase 7 (Free-Busy & Scheduling)
  - Not a blocker for basic CalDAV functionality
  
- [ ] **sync-collection Report** — RFC 6578
  - Covered in Phase 6 (Synchronization)
  - Essential for efficient client sync

---

## RFC Compliance

| RFC Requirement | Status | Notes |
|-----------------|--------|-------|
| RFC 4791 §7.8: calendar-query | ✅ Compliant | Full support including recurrence expansion |
| RFC 4791 §7.9: calendar-multiget | ✅ Compliant | Full support |
| RFC 6352 §8.6: addressbook-query | ✅ Compliant | Collations, filters |
| RFC 6352 §8.7: addressbook-multiget | ✅ Compliant | Full support |
| RFC 3253 §3.8: expand-property | ✅ Compliant | Cycle detection, recursive expansion |
| RFC 4791 §9.9: Time-range recurrence | ✅ Compliant | RRULE expansion via cal_occurrence table |
| RFC 4791 §9.10: Partial retrieval | ✅ Compliant | Component/property selection |
| RFC 6352 §10.5: Text-match collation | ✅ Compliant | Unicode-casemap, ASCII-casemap |

**Compliance Score**: 8/8 required features (100%)

---

## Next Steps

### Nice-to-Have

1. **Enhance expand-property with database-backed properties** — MEDIUM PRIORITY
   - Replace stub property fetching with real database queries
   - Integrate with principal/collection storage
   - Add support for ACL properties
   - Estimated effort: 3-5 days

2. **Optimize query performance** — MEDIUM PRIORITY
   - Add query plan analysis
   - Ensure indexes are used effectively
   - Add query caching for repeated filters
   - Estimated effort: 3-5 days

---

## Dependencies

**Blocks**: None — Phase 4 is fully complete.

**Depends On**: 
- Phase 2 (Database Operations) — Fully implemented
- Phase 5 (Recurrence & Time Zones) — ✅ Complete and integrated

---

## Next Phase: Phase 5

**Focus**: Recurrence & Time Zones (RRULE expansion, VTIMEZONE parsing, occurrence caching)

**Status**: ❌ **NOT IMPLEMENTED (0%)**
