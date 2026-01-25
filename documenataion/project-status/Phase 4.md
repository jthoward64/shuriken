# Phase 4: Query Reports

**Status**: ✅ **COMPLETE (95%)**  
**Last Updated**: 2026-01-25

---

## Overview

Phase 4 implements the REPORT method with CalDAV and CardDAV query reports. These reports enable clients to efficiently query calendar events and contact cards using filters (component type, time-range, property matching) and retrieve multiple resources in a single request. All required reports are functional except for `expand-property` and recurrence-aware time-range filtering.

**Key Achievement**: All CalDAV and CardDAV query reports work correctly with comprehensive filter support.

**Critical Gap**: Recurrence expansion in time-range filters and `expand-property` report.

---

## Implementation Status

### ✅ Completed Features

#### calendar-query Report (`src/app/api/caldav/report/calendar_query.rs`)

- [x] **Filter evaluation** (`src/component/db/query/caldav/filter.rs`)
  - **Component filters**: VEVENT, VTODO, VJOURNAL, VFREEBUSY
  - **Property filters** with text-match:
    - Case-sensitive and case-insensitive matching
    - Match types: starts-with, ends-with, contains, equals
    - Negation support (`negate-condition="yes"`)
  - **Time-range filtering**:
    - Compares `dtstart_utc` and `dtend_utc` from `cal_index`
    - Handles all-day events (`all_day` flag)
    - **Limitation**: Does NOT expand recurrence yet (Phase 5 dependency)
  - **Limit support**: `<C:limit><C:nresults>N</C:nresults></C:limit>`
  
- [x] **Partial retrieval** — RFC 4791 §9.10
  - **Component selection**: Return full VCALENDAR or VEVENT-only
  - **Property selection**: Include/exclude specific properties (SUMMARY, DTSTART, etc.)
  - Reduces bandwidth for large calendar objects
  
- [x] **Authorization integration**
  - Checks read permission on collection before querying
  
- [x] **Multistatus response generation**
  - RFC 4918 §13 compliant XML
  - Per-resource `<D:response>` with href, propstat, status

#### calendar-multiget Report (`src/app/api/caldav/report/calendar_multiget.rs`)

- [x] **Href-based retrieval** — Fetch multiple resources by URI
  - Accepts list of `<D:href>` elements
  - Returns 404 propstat for missing resources
  - Efficient batch retrieval (single query per collection)
  
- [x] **Partial retrieval** — Same as calendar-query
  - Component and property selection
  
- [x] **Authorization integration**
  - Checks read permission on collection

#### addressbook-query Report (`src/app/api/carddav/report/addressbook_query.rs`)

- [x] **Filter evaluation** (`src/component/db/query/carddav/filter.rs`)
  - **Property filters**: FN, N, EMAIL, TEL, ADR, NICKNAME, ORG, TITLE, etc.
  - **Text-match with collation support**:
    - `i;unicode-casemap` (default, case-insensitive Unicode)
    - `i;ascii-casemap` (ASCII case-insensitive)
    - Returns `supported-collation` precondition error for unsupported collations
  - **anyof/allof logic**: Combine multiple filters with OR/AND semantics
  - **Limit support**: `<C:limit><C:nresults>N</C:nresults></C:limit>`
  
- [x] **Partial retrieval** — RFC 6352 §10.3
  - Property selection for vCard (FN, EMAIL only, etc.)
  - Reduces bandwidth for large addressbooks
  
- [x] **Authorization integration**
  - Checks read permission on addressbook

#### addressbook-multiget Report (`src/app/api/carddav/report/addressbook_multiget.rs`)

- [x] **Href-based retrieval** — Batch vCard fetch
  - Accepts list of `<D:href>` elements
  - Returns 404 propstat for missing resources
  
- [x] **Partial retrieval** — Same as addressbook-query
  - Property selection
  
- [x] **Authorization integration**
  - Checks read permission on addressbook

---

### ⚠️ Incomplete Features

#### 1. expand-property Report (RFC 3253 §3.8)

**Current State**: Stub only in `src/app/api/dav/method/report.rs`.

**What's Missing**:
- Property expansion logic (`<D:expand-property>` parsing)
- URL dereferencing (follow hrefs to retrieve referenced resources)
- Cycle detection (prevent infinite loops)
- Depth handling (recursive expansion)

**Impact**: CardDAV clients use `expand-property` for principal discovery and group member expansion. Without it, clients must make multiple requests.

**RFC Violation**: RFC 6352 §6.3.5 requires `expand-property` support for CardDAV.

**Recommended Fix**:
1. Parse `<D:expand-property>` request body
2. Extract property names to expand
3. Resolve hrefs (principal-URL, member URLs)
4. Build nested `<D:response>` with expanded properties
5. Implement cycle detection (track visited URLs)

**Estimated Effort**: 1 week (complex due to recursive expansion)

#### 2. Recurrence in Time-Range Filtering

**Current State**: Time-range filter compares `dtstart_utc` and `dtend_utc` from `cal_index` only.

**What's Missing**:
- RRULE expansion for recurring events
- Matching occurrences within the time-range
- EXDATE exclusion
- RDATE inclusion
- RECURRENCE-ID override handling

**Impact**: Recurring events outside their master `dtstart`/`dtend` range won't match time-range queries. For example, a weekly meeting starting Jan 1 won't appear in a Feb 1-28 query.

**RFC Violation**: RFC 4791 §9.9 requires recurrence expansion in time-range filters.

**Depends On**: Phase 5 (RRULE expansion engine and `cal_occurrence` table).

**Recommended Fix**:
1. Join with `cal_occurrence` table for recurring events
2. Filter occurrences by `dtstart_utc` and `dtend_utc`
3. Fallback to `cal_index` for non-recurring events

**Estimated Effort**: 2-3 days (once Phase 5 is complete)

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
| RFC 4791 §7.8: calendar-query | ⚠️ Partial | Works for non-recurring events, recurrence expansion missing |
| RFC 4791 §7.9: calendar-multiget | ✅ Compliant | Full support |
| RFC 6352 §8.6: addressbook-query | ✅ Compliant | Collations, filters |
| RFC 6352 §8.7: addressbook-multiget | ✅ Compliant | Full support |
| RFC 3253 §3.8: expand-property | ❌ Stub only | Required by CardDAV |
| RFC 4791 §9.9: Time-range recurrence | ❌ Missing | No RRULE expansion |
| RFC 4791 §9.10: Partial retrieval | ✅ Compliant | Component/property selection |
| RFC 6352 §10.5: Text-match collation | ✅ Compliant | Unicode-casemap, ASCII-casemap |

**Compliance Score**: 5/8 required features (63%)

---

## Next Steps

### Immediate Priorities

1. **Implement expand-property Report** — HIGH PRIORITY
   - Required for CardDAV principal discovery
   - Unblocks group expansion and addressbook delegation
   - Estimated effort: 1 week

### Phase 5 Dependencies

2. **Add recurrence expansion to time-range filters** — CRITICAL
   - Depends on Phase 5 RRULE expansion engine
   - Join with `cal_occurrence` table
   - Estimated effort: 2-3 days (after Phase 5)

### Nice-to-Have

3. **Optimize query performance** — MEDIUM PRIORITY
   - Add query plan analysis
   - Ensure indexes are used effectively
   - Add query caching for repeated filters
   - Estimated effort: 3-5 days

---

## Dependencies

**Blocks**: None — Phase 4 gaps don't block other phases (except expand-property for CardDAV).

**Depends On**: 
- Phase 2 (Database Operations) — Fully implemented
- Phase 5 (Recurrence & Time Zones) — Needed for time-range recurrence

---

## Next Phase: Phase 5

**Focus**: Recurrence & Time Zones (RRULE expansion, VTIMEZONE parsing, occurrence caching)

**Status**: ❌ **NOT IMPLEMENTED (0%)**
