# Shuriken CalDAV/CardDAV Implementation Status

This document provides a comprehensive audit of the Shuriken CalDAV/CardDAV implementation against the plan in `docs/CalDAV-CardDAV-Implementation-Guide.md` and relevant RFC specifications.

**Audit Date**: 2026-01-25  
**Audited Through**: Phase 5 (Recurrence & Time Zones)

---

## Executive Summary

| Phase | Status | Completion | Critical Issues |
|-------|--------|------------|-----------------|
| Phase 0: Database Schema | ✅ Complete | 100% | None |
| Phase 1: Core Parsing & Serialization | ✅ Complete | 98% | Minor RRULE list handling |
| Phase 2: Database Operations | ⚠️ Mostly Complete | 85% | Missing `cal_occurrence` table, no RRULE expansion |
| Phase 3: Basic HTTP Methods | ⚠️ Mostly Complete | 90% | MOVE incomplete, MKCALENDAR/MKCOL need full parsing |
| Phase 4: Query Reports | ✅ Complete | 95% | expand-property stub only |
| Phase 5: Recurrence & Time Zones | ❌ Not Implemented | 0% | **CRITICAL**: No RRULE expansion, no timezone handling |
| Phase 6: Synchronization | ❌ Stub Only | 10% | sync-collection stub, no incremental sync |
| Phase 7: Free-Busy & Scheduling | ❌ Not Started | 0% | No free-busy, no scheduling |
| Phase 8: Authorization Integration | ⚠️ Partial | 40% | Casbin integrated, no ACL properties |
| Phase 9: Discovery & Polish | ❌ Not Started | 0% | No well-known URIs, no principal discovery |

**Overall Progress**: ~50% complete through planned Phase 5

---

## Phase-by-Phase Analysis

### Phase 0: Database Schema and Architecture ✅ **COMPLETE**

**Implementation Status**: All required tables exist with proper structure.

#### ✅ Implemented Features

- [x] **Core Identity Tables**
  - `user`: User accounts with email, name, principal_id
  - `auth_user`: External authentication provider mappings
  - `group`: Organizational groups
  - `group_name`: Group names and aliases
  - `membership`: Many-to-many user-group relationships
  - `principal`: Unified principal namespace (users, groups, system/public/resource)
  - `casbin_rule`: Authorization rules

- [x] **DAV Storage Tables**
  - `dav_collection`: Collections (calendars/addressbooks) with sync tokens
  - `dav_entity`: Canonical content entities (shareable across collections)
  - `dav_instance`: Per-collection resource instances with ETags
  - `dav_component`: Component tree for iCalendar/vCard content
  - `dav_property`: Properties with typed value columns
  - `dav_parameter`: Parameters associated with properties
  - `dav_tombstone`: Deletion tombstones for sync correctness
  - `dav_shadow`: Debug/compat payload storage

- [x] **Derived Index Tables**
  - `cal_index`: CalDAV query index with time-range, UID, recurrence fields
  - `card_index`: CardDAV query index with FN, UID, full-text search
  - `card_email`: Indexed vCard email addresses
  - `card_phone`: Indexed vCard phone numbers

- [x] **Schema Features**
  - UUID v7 primary keys (time-ordered)
  - Soft deletes via `deleted_at` columns
  - Auto-updated `updated_at` timestamps via `diesel_manage_updated_at()`
  - Foreign key constraints
  - Check constraints (e.g., collection type validation)

#### ❌ Missing Elements

- [ ] **`cal_occurrence` table** — **CRITICAL MISSING**
  - Referenced in `src/component/db/schema.rs` line 1 comment
  - Not created in any migration
  - Required for efficient recurrence expansion queries
  - Should contain: instance_id, dtstart_utc, dtend_utc, sequence
  
  **Impact**: Without this table, recurring event queries must expand RRULE on every query, which is expensive and doesn't scale.

#### RFC Compliance Notes

- ✅ **RFC 4791 §4.1**: Entity/instance separation supports one UID per resource
- ✅ **RFC 6578**: Tombstones and sync revision tracking ready
- ✅ **RFC 3744**: Principal-based ACL model supports WebDAV ACL

---

### Phase 1: Core Parsing & Serialization ✅ **COMPLETE (98%)**

**Implementation Status**: Comprehensive RFC-compliant parsers and serializers for iCalendar, vCard, and WebDAV XML.

#### ✅ Implemented Features

**iCalendar Parser** (`src/component/rfc/ical/parse/`)
- [x] Content line parsing with unfolding (RFC 5545 §3.1)
  - Handles CRLF+SPACE folding
  - Normalizes bare LF to CRLF
  - Preserves UTF-8 multi-byte sequences
- [x] Parameter parsing with quoting
  - Quoted-string support: `CN="Doe, Jane"`
  - Multi-value parameters: `ROLE=REQ-PARTICIPANT,OPT-PARTICIPANT`
  - RFC 6868 caret encoding: `^n`, `^'`, `^^`
- [x] Value type parsing
  - DATE: `YYYYMMDD`
  - DATE-TIME: UTC (`Z`) and timezone (`TZID=`) forms
  - TIME: `HHMMSS[Z]`
  - DURATION: ISO 8601 format
  - PERIOD: start/end or start/duration
  - RRULE: Complete recurrence rule support
  - BOOLEAN, INTEGER, FLOAT, UTC-OFFSET, TEXT (with unescaping)
- [x] RRULE parsing
  - FREQ, COUNT, UNTIL, INTERVAL
  - BYDAY with ordinals (-53 to 53)
  - BYMONTH, BYMONTHDAY, BYYEARDAY, BYWEEKNO, BYHOUR, BYMINUTE, BYSECOND
  - BYSETPOS
  - WKST (week start day)
- [x] Component hierarchy
  - VCALENDAR, VEVENT, VTODO, VJOURNAL, VFREEBUSY, VTIMEZONE, VALARM
  - Nested component support
  - Property/parameter attachment
- [x] **40+ unit tests** covering all value types and edge cases

**iCalendar Serializer** (`src/component/rfc/ical/build/`)
- [x] Line folding at 75 octets
  - Preserves UTF-8 multi-byte sequences
  - Inserts CRLF+SPACE
- [x] Text escaping
  - Backslash: `\\`
  - Newline: `\n`
  - Semicolon: `\;`
  - Comma: `\,`
- [x] Parameter escaping
  - Quoted values for special characters
  - RFC 6868 caret encoding
- [x] Canonical property ordering for deterministic output
- [x] Round-trip fidelity (preserves unknown properties/parameters)

**vCard Parser** (`src/component/rfc/vcard/parse/`)
- [x] Line unfolding (identical to iCalendar)
- [x] Parameter parsing with case-insensitive names
- [x] vCard-specific value types
  - Structured name (FN, N with 5 components)
  - Address (ADR with 7 components)
  - Dates/times with partial formats (year-only, month-only)
  - Gender, Organization, Related, Phone URIs
- [x] Version support: 3.0 and 4.0
- [x] **40+ unit tests**

**vCard Serializer** (`src/component/rfc/vcard/build/`)
- [x] vCard-specific escaping (backslash, newline, comma, semicolon)
- [x] RFC 6868 caret encoding for parameters
- [x] Canonical ordering
- [x] Round-trip fidelity

**WebDAV XML Parser** (`src/component/rfc/dav/parse/`)
- [x] PROPFIND parsing
  - `<allprop>`, `<propname>`, `<prop>`
  - `<include>` for additional properties
- [x] PROPPATCH parsing
  - `<set>` and `<remove>` operations
  - Per-property application
- [x] REPORT parsing
  - CalDAV: `calendar-query`, `calendar-multiget`, `free-busy-query`
  - CardDAV: `addressbook-query`, `addressbook-multiget`
  - WebDAV: `sync-collection`, `expand-property`
- [x] Filter parsing
  - Component filters (VEVENT, VTODO, etc.)
  - Property filters with text-match
  - Parameter filters
  - Time-range filters
- [x] XML namespace handling
  - DAV:, CALDAV:, CARDDAV:, CS: (Apple extensions)
  - QName with namespace prefixes

**WebDAV XML Serializer** (`src/component/rfc/dav/build/`)
- [x] Multistatus generation (207 Multi-Status)
- [x] PropStat serialization with status codes
- [x] Error element generation (preconditions)
- [x] Href encoding and normalization

#### ⚠️ Known Issues

1. **RRULE list handling** (Minor)
   - Location: `src/component/rfc/ical/parse/values.rs`
   - Issue: `// For now, just take the first one. TODO: handle lists properly`
   - Impact: If a property has multiple comma-separated RRULE values, only the first is parsed
   - RFC Violation: RFC 5545 allows list-valued RRULE in some contexts
   - **Fix Required**: Parse comma-separated lists and handle all values
   
2. **Parameter value list handling** (Minor)
   - Some parameters (MEMBER, custom X-params) support multiple comma-separated values
   - Needs verification of complete handling
   
3. **X-properties and custom types** (Documentation gap)
   - X-properties are round-tripped but not documented
   - No specialized parsing for known X- extensions (X-WR-CALNAME, etc.)

#### ❌ Not Implemented

- [ ] Timezone expansion (deferred to Phase 5)
- [ ] iCalendar VALARM dedicated tests/fixtures
- [ ] Partial date/time format validation in vCard

#### RFC Compliance Status

| RFC | Status | Notes |
|-----|--------|-------|
| RFC 5545 (iCalendar) | ✅ Compliant | Minor RRULE list handling issue |
| RFC 6350 (vCard 4.0) | ✅ Compliant | v3 and v4 supported |
| RFC 2426 (vCard 3.0) | ✅ Compliant | Full support |
| RFC 6868 (Parameter Encoding) | ✅ Compliant | Caret encoding implemented |
| RFC 4918 (WebDAV) | ✅ Compliant | XML parsing complete |
| RFC 4791 (CalDAV) | ✅ Compliant | Filter parsing complete |
| RFC 6352 (CardDAV) | ✅ Compliant | Query parsing complete |

---

### Phase 2: Database Operations ⚠️ **MOSTLY COMPLETE (85%)**

**Implementation Status**: Core CRUD operations exist, but recurrence expansion and derived index population need work.

#### ✅ Implemented Features

**Entity Storage** (`src/component/db/query/dav/entity/`)
- [x] Entity CRUD operations
  - `create_entity()`: Insert canonical entity with component tree
  - `update_entity()`: Replace entity content
  - `get_entity()`: Retrieve entity by ID
  - `get_entity_by_instance()`: Join through instance
- [x] UID conflict detection
  - `check_uid_conflict()`: Prevent duplicate UIDs in collection
- [x] Component tree insertion
  - Hierarchical storage: entity → components → properties → parameters
  - Preserves unknown properties for round-trip fidelity

**Instance Operations** (`src/component/db/query/dav/instance/`)
- [x] Instance CRUD
  - `create_instance()`: Link entity to collection
  - `update_instance()`: Update ETag, sync revision
  - `delete_instance()`: Soft delete with tombstone
  - `get_instance()`: Retrieve by URI or ID
- [x] ETag generation
  - Strong ETags from content hash
  - Updates on every content change
- [x] Sync revision tracking
  - Monotonic revision counter per collection
  - Updated on create/update/delete

**Collection Operations** (`src/component/db/query/dav/collection.rs`)
- [x] Collection queries
  - `get_collection()`: Retrieve collection metadata
  - `list_collections()`: List collections for principal
  - Sync token retrieval
- [x] Collection type enforcement
  - Calendar vs addressbook via `resourcetype` column

**Mapping Functions** (`src/component/db/map/`)
- [x] iCalendar → DB models (`dav/ical.rs`)
  - Component tree flattening
  - Property/parameter extraction
  - Value type mapping
- [x] vCard → DB models (`dav/vcard.rs`)
  - Similar structure to iCalendar
- [x] DB models → iCalendar/vCard (partially)
  - Component tree reconstruction

**Index Structures** (Schema ready, population TBD)
- [x] `cal_index` table structure
  - Columns: uid, component_type, dtstart_utc, dtend_utc, all_day, recurrence_id_utc, rrule_text, organizer, summary, timezone_tzid
- [x] `card_index` table structure
  - Columns: uid, fn, version, kind

#### ⚠️ Incomplete Features

1. **Derived Index Population** (Partial)
   - Schema exists but not fully wired to PUT/PROPPATCH
   - `cal_index` should be populated on every calendar object write
   - `card_index` should be populated on every vCard write
   - **Impact**: Query performance will be poor until indexes are populated
   
2. **Recurrence Index** (Not started)
   - `cal_occurrence` table missing entirely
   - RRULE expansion logic not implemented
   - **Impact**: Time-range queries on recurring events won't work correctly

3. **Transactionality** (Needs verification)
   - PUT operations should be atomic: entity + instance + indexes + tombstones
   - Rollback behavior on constraint violations needs testing
   - **Test Gap**: No integration tests for transaction boundaries

#### ❌ Not Implemented

- [ ] **`cal_occurrence` table creation** — **CRITICAL**
  - Required for Phase 5 (Recurrence Expansion)
  - Should store expanded event occurrences for efficient queries
  - Structure: `(id, instance_id, dtstart_utc, dtend_utc, sequence)`
  
- [ ] **RRULE expansion logic**
  - No occurrence generation from RRULE
  - No EXDATE/RDATE handling
  - No recurrence-id matching
  
- [ ] **Timezone resolution**
  - TZID parameters parsed but not resolved to UTC
  - `cal_index.dtstart_utc` populated from DATE-TIME but without timezone conversion
  
- [ ] **Automatic index updates**
  - PUT handler should trigger index population
  - Delete handler should clean up index entries

#### RFC Compliance Status

| Requirement | Status | Notes |
|-------------|--------|-------|
| RFC 4791 §4.1: One UID per resource | ✅ Enforced | `check_uid_conflict()` prevents duplicates |
| RFC 6578: Sync token monotonicity | ✅ Implemented | Revision counter per collection |
| RFC 6578: Tombstone creation | ✅ Implemented | Soft deletes create tombstones |
| RFC 4791 §9.6: ETag stability | ✅ Implemented | Strong ETags from content hash |
| RFC 5545 §3.8.5: Recurrence expansion | ❌ Missing | No RRULE expansion yet |

---

### Phase 3: Basic HTTP Methods ⚠️ **MOSTLY COMPLETE (90%)**

**Implementation Status**: Most HTTP methods work, but MOVE, MKCALENDAR, and MKCOL need completion.

#### ✅ Implemented Features

**OPTIONS Handler** (`src/app/api/dav/method/options.rs`)
- [x] DAV compliance classes
  - `DAV: 1` (WebDAV Class 1)
  - Conditionally `DAV: calendar-access, addressbook` for collections
- [x] Allow header generation
  - Correct methods per resource type (collection vs item)
- [x] Content-Type handling
- [x] **Integration tests**: 5 test cases covering collections and resources

**PROPFIND Handler** (`src/app/api/dav/method/propfind/`)
- [x] Depth handling
  - Depth: 0 (target only)
  - Depth: 1 (target + immediate children)
  - Depth: infinity (configurable rejection)
- [x] Property retrieval
  - Live properties: `DAV:resourcetype`, `DAV:displayname`, `DAV:getcontenttype`, `DAV:getetag`, `DAV:getlastmodified`, `DAV:creationdate`
  - CalDAV properties: `CALDAV:calendar-home-set`, `CALDAV:supported-calendar-component-set`
  - CardDAV properties: `CARDDAV:addressbook-home-set`, `CARDDAV:supported-address-data`
  - `DAV:supported-report-set` (advertises available reports)
- [x] Multistatus generation
  - Per-property status (200 for supported, 404 for unknown)
- [x] Authorization integration
  - Checks read permission before serving properties
- [x] **Integration tests**: 8 test cases

**PROPPATCH Handler** (`src/app/api/dav/method/proppatch.rs`)
- [x] Property setting
  - `DAV:displayname` (writable)
  - `CALDAV:calendar-description` (writable)
  - `CARDDAV:addressbook-description` (writable)
- [x] Protected property rejection
  - Returns 403 for attempts to set protected properties
- [x] Per-property status codes
  - 200 for successful sets/removes
  - 403 for protected properties
  - 404 for unknown properties
- [x] Authorization integration

**GET/HEAD Handler** (`src/app/api/dav/method/get_head/`)
- [x] Resource retrieval
  - iCalendar content for `.ics`
  - vCard content for `.vcf`
- [x] ETag and Last-Modified headers
- [x] If-None-Match conditional GET (304 Not Modified)
- [x] Content-Type handling
  - `text/calendar; charset=utf-8` for iCalendar
  - `text/vcard; charset=utf-8` for vCard
- [x] HEAD method (returns headers only)
- [x] Authorization integration
- [x] **Integration tests**: 6 test cases

**PUT Handler** (`src/app/api/caldav/method/put/` and `src/app/api/carddav/method/put/`)
- [x] Content parsing and validation
  - iCalendar parsing with error reporting
  - vCard parsing with error reporting
- [x] Precondition checking
  - If-None-Match: * (safe create)
  - If-Match (safe update)
  - UID conflict detection
- [x] CalDAV-specific validation
  - `valid-calendar-data` precondition
  - `no-uid-conflict` precondition
- [x] CardDAV-specific validation
  - `valid-address-data` precondition
  - `no-uid-conflict` precondition
- [x] Entity storage
  - Create or update entity
  - Update instance with new ETag
  - Increment collection sync revision
- [x] Response codes
  - 201 Created (with Location header)
  - 204 No Content (update)
  - 412 Precondition Failed
- [x] Authorization integration
- [x] **Integration tests**: 12 test cases for CalDAV, 8 for CardDAV

**DELETE Handler** (`src/app/api/dav/method/delete.rs`)
- [x] Resource deletion
  - Soft delete instance
  - Create tombstone with sync revision
  - Increment collection sync token
- [x] Authorization integration
- [x] Response codes
  - 204 No Content (success)
  - 404 Not Found
  - 403 Forbidden
- [x] **Integration tests**: 4 test cases

**COPY Handler** (`src/app/api/dav/method/copy.rs`)
- [x] Resource copying
  - Destination header parsing
  - Overwrite header handling
  - Copy entity to new instance
  - Generate new ETag for destination
- [x] Authorization integration (checks write on destination)
- [x] Response codes
  - 201 Created
  - 204 No Content (overwrite)
  - 412 Precondition Failed (overwrite=F conflict)

#### ⚠️ Incomplete Features

1. **MOVE Handler** (`src/app/api/dav/method/move.rs`)
   - **Status**: Stub implementation marked with TODO
   - **Missing**:
     - Destination parsing
     - Overwrite handling
     - Tombstone creation for source
     - Sync revision updates
   - **RFC Violation**: RFC 4918 §9.9 requires MOVE support
   
2. **MKCALENDAR Handler** (`src/app/api/caldav/method/mkcalendar.rs`)
   - **Status**: Framework exists but body parsing incomplete
   - **Missing**:
     - XML body parsing for `<set>` properties
     - Initial property application (displayname, description)
   - **RFC Violation**: RFC 4791 §5.3.1 SHOULD support property setting at creation
   
3. **MKCOL Handler** (`src/app/api/carddav/method/mkcol.rs`)
   - **Status**: Framework exists but RFC 5689 parsing incomplete
   - **Missing**:
     - Extended MKCOL body parsing
     - Initial property application
   - **RFC Violation**: RFC 6352 §5.2 recommends Extended MKCOL support

#### ❌ Not Implemented

- [ ] Collection recursive delete (optional, but common clients expect it)
- [ ] LOCK/UNLOCK methods (WebDAV Class 2, not required for CalDAV/CardDAV)

#### RFC Compliance Status

| RFC Requirement | Status | Notes |
|-----------------|--------|-------|
| RFC 4918 §8.1: OPTIONS | ✅ Compliant | DAV header correct |
| RFC 4918 §9.1: PROPFIND | ✅ Compliant | All cases handled |
| RFC 4918 §9.2: PROPPATCH | ✅ Compliant | Protected properties enforced |
| RFC 4918 §9.4: GET | ✅ Compliant | ETags, conditional requests |
| RFC 4918 §9.7: PUT | ✅ Compliant | Preconditions, safe create/update |
| RFC 4918 §9.6: DELETE | ✅ Compliant | Tombstones for sync |
| RFC 4918 §9.8: COPY | ✅ Compliant | Destination, overwrite |
| RFC 4918 §9.9: MOVE | ❌ Incomplete | Stub only |
| RFC 4918 §9.3: MKCOL | ⚠️ Partial | Basic creation works, property setting missing |
| RFC 4791 §5.3.1: MKCALENDAR | ⚠️ Partial | Body parsing incomplete |
| RFC 5689: Extended MKCOL | ⚠️ Partial | Body parsing incomplete |
| RFC 4791 §9.6: Strong ETags | ✅ Compliant | Content-based ETags |
| RFC 4791 §4.1: UID uniqueness | ✅ Enforced | Precondition returned on conflict |
| RFC 6352 §5.1: no-uid-conflict | ✅ Enforced | Precondition returned |

---

### Phase 4: Query Reports ✅ **COMPLETE (95%)**

**Implementation Status**: All required reports implemented except expand-property.

#### ✅ Implemented Features

**calendar-query Report** (`src/app/api/caldav/report/calendar_query.rs`)
- [x] Filter evaluation (`src/component/db/query/caldav/filter.rs`)
  - Component filters (VEVENT, VTODO, VJOURNAL, VFREEBUSY)
  - Property filters with text-match
    - Case-sensitive and case-insensitive matching
    - Starts-with, ends-with, contains, equals
  - Time-range filtering
    - dtstart_utc/dtend_utc comparison
    - **NOTE**: Does NOT expand recurrence yet (Phase 5 dependency)
  - Limit support
- [x] Partial retrieval
  - Component selection (VEVENT-only vs full VCALENDAR)
  - Property selection (include/exclude specific properties)
- [x] Authorization integration
  - Checks read permission on collection
- [x] Multistatus response generation

**calendar-multiget Report** (`src/app/api/caldav/report/calendar_multiget.rs`)
- [x] Href-based retrieval
  - Fetches multiple resources by URI
  - Returns 404 propstat for missing resources
- [x] Partial retrieval (same as calendar-query)
- [x] Authorization integration

**addressbook-query Report** (`src/app/api/carddav/report/addressbook_query.rs`)
- [x] Filter evaluation (`src/component/db/query/carddav/filter.rs`)
  - Property filters (FN, N, EMAIL, TEL, ADR, etc.)
  - Text-match with collation support
    - `i;unicode-casemap` (default)
    - `i;ascii-casemap`
    - Returns `supported-collation` error for unsupported collations
  - anyof/allof logic
  - Limit support
- [x] Partial retrieval
  - Property selection for vCard
- [x] Authorization integration

**addressbook-multiget Report** (`src/app/api/carddav/report/addressbook_multiget.rs`)
- [x] Href-based retrieval
- [x] Partial retrieval
- [x] Authorization integration

#### ⚠️ Incomplete Features

1. **expand-property Report** (RFC 3253 §3.8)
   - **Status**: Stub only in `src/app/api/dav/method/report.rs`
   - **Missing**:
     - Property expansion logic
     - URL dereferencing
     - Cycle detection
   - **Impact**: CardDAV clients use this for principal discovery
   - **RFC Violation**: RFC 6352 §6.3.5 requires `expand-property` support
   
2. **Recurrence in Time-Range Filtering**
   - **Status**: Time-range filter compares dtstart/dtend only
   - **Missing**: RRULE expansion for recurring events
   - **Impact**: Recurring events outside their master dtstart/dtend range won't match queries
   - **RFC Violation**: RFC 4791 §9.9 requires recurrence expansion in time-range
   - **Depends On**: Phase 5 (RRULE expansion)

#### RFC Compliance Status

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

---

### Phase 5: Recurrence & Time Zones ❌ **NOT IMPLEMENTED (0%)**

**Implementation Status**: **CRITICAL MISSING FUNCTIONALITY** — No recurrence expansion or timezone handling.

#### ❌ Not Implemented

**Core Missing Features**:

1. **RRULE Expansion Engine** — **CRITICAL**
   - No algorithm to generate occurrence dates from RRULE
   - Missing features:
     - [ ] Frequency iteration (DAILY, WEEKLY, MONTHLY, YEARLY)
     - [ ] BYxxx rule application (BYDAY, BYMONTH, BYMONTHDAY, etc.)
     - [ ] BYSETPOS filtering
     - [ ] COUNT limiting
     - [ ] UNTIL limiting
     - [ ] EXDATE exclusion
     - [ ] RDATE inclusion
     - [ ] Recurrence-ID override matching
   - **Impact**: Recurring events are completely non-functional
   - **RFC Violation**: RFC 4791 §9.9 requires recurrence expansion for time-range queries
   
2. **`cal_occurrence` Table** — **CRITICAL**
   - Table does not exist in schema
   - Needed to cache expanded occurrences
   - Structure should be:
     ```sql
     CREATE TABLE cal_occurrence (
         id UUID PRIMARY KEY DEFAULT uuidv7(),
         instance_id UUID NOT NULL REFERENCES dav_instance(id),
         dtstart_utc TIMESTAMPTZ NOT NULL,
         dtend_utc TIMESTAMPTZ NOT NULL,
         sequence INTEGER DEFAULT 0,
         INDEX idx_cal_occurrence_timerange (dtstart_utc, dtend_utc),
         INDEX idx_cal_occurrence_instance (instance_id)
     );
     ```
   - **Impact**: Without cached occurrences, queries must expand RRULE on every request (expensive)
   
3. **VTIMEZONE Parser** — **HIGH PRIORITY**
   - No parsing of VTIMEZONE components
   - No TZID resolution
   - Missing features:
     - [ ] STANDARD/DAYLIGHT block parsing
     - [ ] TZOFFSETFROM/TZOFFSETTO extraction
     - [ ] DST transition date calculation
     - [ ] RRULE support in VTIMEZONE (for recurring DST rules)
   - **Impact**: Cannot convert local times to UTC for time-range queries
   - **RFC Violation**: RFC 4791 §4.1 requires VTIMEZONE inclusion for every unique TZID
   
4. **UTC Conversion Utilities** — **HIGH PRIORITY**
   - No logic to convert DATE-TIME values to UTC
   - Missing features:
     - [ ] TZID → timezone definition lookup
     - [ ] Local time → UTC conversion with DST handling
     - [ ] DST gap handling (non-existent times)
     - [ ] DST fold handling (ambiguous times)
   - **Impact**: `cal_index.dtstart_utc` populated incorrectly for TZID-bearing events
   
5. **`expand` and `limit-recurrence-set` Handling** — **MEDIUM PRIORITY**
   - RFC 4791 §9.6.4 and §9.6.5
   - Calendar-query supports modifiers:
     - `<expand start="..." end="..."/>`: Return expanded instances
     - `<limit-recurrence-set start="..." end="..."/>`: Limit recurrence range
   - **Impact**: Clients requesting expanded output receive unexpanded master events
   
6. **Recurrence-ID Matching** — **MEDIUM PRIORITY**
   - No logic to match overrides to master events
   - `cal_index.recurrence_id_utc` column exists but unused
   - **Impact**: Exception instances (RECURRENCE-ID) not associated with master

#### Recommended Implementation Path

**Step 1**: Create `cal_occurrence` table
- Add migration: `/migrations/YYYY-MM-DD-create-cal-occurrence/up.sql`
- Update `src/component/db/schema.rs`

**Step 2**: Integrate RRULE expansion library
- Use existing Rust crate: `rrule` or `icalendar-rrule`
- Implement `expand_rrule()` function in `src/component/rfc/ical/expand/`
- Unit tests with RFC 5545 examples

**Step 3**: Implement timezone resolution
- Option A: Use `chrono-tz` for IANA timezone database
- Option B: Parse VTIMEZONE components and build timezone rules
- Implement `convert_to_utc()` in `src/component/rfc/ical/timezone/`

**Step 4**: Wire expansion into PUT handler
- On PUT:
  1. Parse iCalendar
  2. Extract RRULE, EXDATE, RDATE
  3. Expand occurrences (with max limit)
  4. Populate `cal_occurrence` table
  5. Set `cal_index.dtstart_utc` to UTC-converted time

**Step 5**: Update calendar-query filter
- Use `cal_occurrence` table for time-range queries on recurring events
- Fallback to `cal_index` for non-recurring events

#### RFC Compliance Status

| RFC Requirement | Status | Impact |
|-----------------|--------|--------|
| RFC 5545 §3.8.5: RRULE | ❌ Missing | Recurring events non-functional |
| RFC 5545 §3.3.10: RECUR value | ❌ Missing | No expansion logic |
| RFC 4791 §9.9: Time-range + recurrence | ❌ Missing | Queries fail for recurring events |
| RFC 5545 §3.6.5: VTIMEZONE | ❌ Missing | Timezone-aware events broken |
| RFC 4791 §4.1: VTIMEZONE inclusion | ❌ Missing | No TZID validation |
| RFC 7986 §5.7: RRULE extensions | ❌ Missing | No extension support |

**CRITICAL**: Phase 5 is essential for production CalDAV. Without recurrence expansion, the server cannot handle recurring calendar events, which are ubiquitous in real-world usage.

---

### Phase 6: Synchronization ❌ **STUB ONLY (10%)**

**Implementation Status**: Framework exists but no actual sync logic.

#### ✅ Implemented Features

**Schema Support**
- [x] `dav_instance.sync_revision`: Monotonic revision counter
- [x] `dav_tombstone`: Deletion tombstones with sync revision
- [x] `dav_collection.synctoken`: Collection-level sync token (same as max sync_revision)

**Request Parsing**
- [x] `sync-collection` report XML parsing
- [x] Sync-token extraction
- [x] Limit support
- [x] Depth enforcement (must be 0)

#### ❌ Not Implemented

**sync-collection Report** (`src/app/api/dav/method/report.rs`)
- [ ] Token validation
  - No `valid-sync-token` error checking
- [ ] Change detection
  - No query for instances with `sync_revision > token`
- [ ] Tombstone inclusion
  - No query for tombstones with `sync_revision > token`
- [ ] Multistatus response building
  - Changed resources: propstat with requested properties
  - Deleted resources: status-only 404 response
- [ ] New token generation
  - Should return collection's current sync token
- [ ] Truncation handling (507 response)
  - No paging logic for large change sets
- [ ] Authorization integration
  - Should check read permission on collection

**Status**: All logic is marked TODO in `build_sync_collection_response()`

**CTag Property** (`DAV:getctag`)
- [ ] Not exposed in PROPFIND
- [ ] Schema has `synctoken` but not `ctag` (they should be equivalent)

#### RFC Compliance Status

| RFC Requirement | Status | Impact |
|-----------------|--------|--------|
| RFC 6578 §3.1: DAV:sync-token | ⚠️ Partial | Schema ready, no handler logic |
| RFC 6578 §3.2: sync-collection | ❌ Stub only | No incremental sync |
| RFC 6578 §3.3: valid-sync-token | ❌ Missing | No token validation |
| RFC 6578 §4: Depth: 0 | ⚠️ Parsed | Enforcement not tested |
| RFC 6578 §5: Truncation (507) | ❌ Missing | No paging support |
| RFC 6578 §6: Deletion tombstones | ⚠️ Partial | Tombstones created but not queried |
| CalDAV: DAV:getctag | ❌ Missing | CTag not exposed |

**Impact**: Without sync-collection, clients must use full PROPFIND + calendar-query on every poll, which is expensive and doesn't scale.

---

### Phase 7: Free-Busy & Scheduling ❌ **NOT STARTED (0%)**

**Implementation Status**: No free-busy or scheduling features implemented.

#### ❌ Not Implemented

**free-busy-query Report** (RFC 4791 §7.10)
- [ ] Request parsing (XML parsing exists but no handler)
- [ ] Event aggregation logic
  - Query events in time-range
  - Exclude CANCELLED and TRANSPARENT events
  - Extract busy periods
- [ ] Period merging
  - Merge overlapping busy periods
  - Maintain separate BUSY-UNAVAILABLE periods
- [ ] VFREEBUSY generation
  - Build VFREEBUSY component
  - FREEBUSY property with periods
- [ ] Authorization
  - `read-free-busy` privilege (lower than `read`)
  - Must not leak event details (only busy times)

**Scheduling Collections** (RFC 6638)
- [ ] `schedule-inbox` collection
  - Receive incoming scheduling messages
  - iTIP REQUEST/REPLY/CANCEL processing
- [ ] `schedule-outbox` collection
  - Send outgoing scheduling messages
  - iTIP generation
- [ ] Principal properties
  - `CALDAV:schedule-inbox-URL`
  - `CALDAV:schedule-outbox-URL`

**Scheduling Detection on PUT**
- [ ] Organizer change detection
  - ATTENDEE additions/removals
  - ATTENDEE PARTSTAT changes
- [ ] Attendee change detection
  - PARTSTAT updates
  - Generate REPLY messages
- [ ] Cancellation detection
  - STATUS:CANCELLED generates CANCEL

**Internal Scheduling Delivery**
- [ ] Inbox delivery for local users
- [ ] iTIP message wrapping
- [ ] Content-Type: `text/calendar; method=REQUEST`

**iMIP Gateway** (Future)
- [ ] Outbound email for external attendees
- [ ] Inbound email parsing
- [ ] DKIM/SPF verification

#### RFC Compliance Status

| RFC Requirement | Status | Impact |
|-----------------|--------|--------|
| RFC 4791 §7.10: free-busy-query | ❌ Missing | No free-busy support |
| RFC 6638 §2: Scheduling collections | ❌ Missing | No scheduling |
| RFC 6638 §3: Implicit scheduling | ❌ Missing | No iTIP |
| RFC 5546: iTIP | ❌ Missing | No scheduling messages |
| RFC 6047: iMIP | ❌ Missing | No email scheduling |

**Impact**: Without free-busy, clients cannot query availability. Without scheduling, calendar invitations don't work.

---

### Phase 8: Authorization Integration ⚠️ **PARTIAL (40%)**

**Implementation Status**: Casbin integrated but ACL discovery properties missing.

#### ✅ Implemented Features

**Casbin Integration** (`src/component/auth/`)
- [x] Casbin enforcer initialization
- [x] ReBAC model (`casbin_model.conf`)
  - Roles: `freebusy`, `reader`, `writer`, `owner`
  - Type-based permissions per resource type
  - Flat group model (no nested groups)
- [x] Subject expansion
  - `{user} ∪ groups(user) ∪ {public}`
- [x] Basic authorization checks
  - `authorize::require()` function
  - Subject/object/action triplets

**Middleware** (`src/component/middleware/auth.rs`)
- [x] Authentication middleware
  - `DepotUser::{User, Public}`
  - Basic Auth parsing
  - Session token validation (if implemented)

**Authorization in Handlers**
- [x] PROPFIND checks read permission
- [x] PUT checks write permission
- [x] DELETE checks write permission
- [x] COPY/MOVE checks write on destination
- [x] Reports check read permission

#### ❌ Not Implemented

**ACL Discovery Properties** (RFC 3744)
- [ ] `DAV:current-user-privilege-set`
  - Describes what the current user can do
  - Required for clients to enable/disable UI features
- [ ] `DAV:acl`
  - Lists ACEs (Access Control Entries)
  - May be restricted to owner/admin
- [ ] `DAV:principal-collection-set`
  - Lists principal collections
  - Used for principal search
- [ ] `DAV:current-user-principal`
  - Returns URL of authenticated principal
  - Required for discovery flow
- [ ] `DAV:owner`
  - Returns owner principal URL
- [ ] `DAV:group-membership`
  - Lists groups the principal belongs to

**Privilege Hierarchy** (RFC 3744 §3.1)
- [ ] No explicit `read-free-busy` privilege
  - Should be lower than `read`
  - Allows free-busy queries without reading event details
- [ ] No aggregated privileges (`all`, `read-write`)

**Shared Calendar/Addressbook Support**
- [ ] Share creation API
  - No HTTP endpoint to create shares
  - No UI for permission management
- [ ] Share ceiling enforcement
  - Reader cannot grant writer
  - Writer cannot grant owner
- [ ] Share revocation

#### RFC Compliance Status

| RFC Requirement | Status | Impact |
|-----------------|--------|--------|
| RFC 3744 §3.1: Privileges | ⚠️ Partial | Enforced but not discoverable |
| RFC 3744 §5: ACL properties | ❌ Missing | Clients can't discover permissions |
| RFC 3744 §5.4: current-user-privilege-set | ❌ Missing | No permission introspection |
| RFC 3744 §9: Principal properties | ❌ Missing | No principal discovery |
| RFC 4791 §9.3: read-free-busy | ❌ Missing | No freebusy-specific privilege |
| CalDAV: Sharing | ❌ Missing | No shared calendars |
| CardDAV: Sharing | ❌ Missing | No shared addressbooks |

**Impact**: Without ACL properties, clients cannot discover what actions are permitted, leading to poor UX (e.g., showing "Delete" button when delete is forbidden).

---

### Phase 9: Discovery & Polish ❌ **NOT STARTED (0%)**

**Implementation Status**: No discovery or well-known URI support.

#### ❌ Not Implemented

**Well-Known URIs** (RFC 6764 / RFC 5785)
- [ ] `/.well-known/caldav`
  - Should return 301/302 redirect to calendar home
  - Or 207 Multi-Status with principal URL
- [ ] `/.well-known/carddav`
  - Should return 301/302 redirect to addressbook home
  - Or 207 Multi-Status with principal URL

**Principal Discovery Flow**
- [ ] `DAV:current-user-principal` property
  - Returns authenticated user's principal URL
- [ ] `CALDAV:calendar-home-set` property
  - Returns URL(s) where calendars live
- [ ] `CARDDAV:addressbook-home-set` property
  - Returns URL(s) where addressbooks live
- [ ] Principal URL structure
  - Suggested: `/principals/users/{username}/`
  - Must be consistent across properties

**Collection Discovery**
- [ ] Depth: 1 PROPFIND on home set
  - Lists available calendars/addressbooks
  - Returns resourcetype, displayname, description
- [ ] `DAV:supported-report-set` correctness
  - Must advertise exactly what's implemented
  - No "lying" about supported reports

**Apple/Google Client Compatibility**
- [ ] Apple Calendar quirks
  - Specific header expectations
  - Non-standard properties (CS: namespace)
- [ ] Google Calendar quirks
  - Sync behavior oddities
  - Rate limiting considerations
- [ ] Thunderbird quirks
  - CardDAV discovery differences

**Performance Optimization**
- [ ] Query optimization
  - N+1 query prevention
  - Index tuning
  - Prepared statement caching
- [ ] Budget/SLA targets
  - calendar-query: <500ms for 1000 events
  - sync-collection: <200ms for typical change set
  - PROPFIND Depth:1: <300ms for 50 children

**Integration Tests**
- [ ] End-to-end scenarios
  - Full discovery → create calendar → PUT event → query → sync
- [ ] Failure path coverage
  - Invalid iCal/vCard errors
  - Unsupported report errors
  - Precondition failures
- [ ] Quirk suite
  - Captured real client requests
  - Replay tests

#### RFC Compliance Status

| RFC Requirement | Status | Impact |
|-----------------|--------|--------|
| RFC 6764 §6: Well-known CalDAV | ❌ Missing | Clients can't auto-discover |
| RFC 6764 §6: Well-known CardDAV | ❌ Missing | Clients can't auto-discover |
| RFC 5397: current-user-principal | ❌ Missing | No principal discovery |
| RFC 4791 §6.2.1: calendar-home-set | ❌ Missing | No home set discovery |
| RFC 6352 §7.1.1: addressbook-home-set | ❌ Missing | No home set discovery |

**Impact**: Without discovery, clients cannot configure accounts automatically. Users must manually enter collection URLs.

---

## Critical Issues Summary

### Blocking Production Use

1. **Phase 5: Recurrence Expansion** — **CRITICAL BLOCKER**
   - No RRULE expansion logic
   - `cal_occurrence` table missing
   - Time-range queries fail for recurring events
   - **Estimated Effort**: 2-3 weeks
   - **Priority**: P0

2. **Phase 5: Timezone Handling** — **CRITICAL BLOCKER**
   - No VTIMEZONE parsing
   - No UTC conversion
   - Time-range queries incorrect for TZID events
   - **Estimated Effort**: 1-2 weeks
   - **Priority**: P0

3. **Phase 6: Synchronization** — **HIGH PRIORITY**
   - sync-collection stub only
   - No incremental sync
   - Clients forced to re-download everything on every poll
   - **Estimated Effort**: 1 week
   - **Priority**: P1

4. **Phase 9: Discovery** — **HIGH PRIORITY**
   - No well-known URIs
   - No principal properties
   - Clients cannot auto-configure
   - **Estimated Effort**: 1 week
   - **Priority**: P1

### Important but Not Blocking

5. **Phase 3: MOVE/MKCALENDAR/MKCOL Completion** — **MEDIUM**
   - MOVE stub needs implementation
   - MKCALENDAR/MKCOL need body parsing
   - **Estimated Effort**: 3-5 days
   - **Priority**: P2

6. **Phase 4: expand-property** — **MEDIUM**
   - Required by CardDAV
   - Used for principal discovery
   - **Estimated Effort**: 3-5 days
   - **Priority**: P2

7. **Phase 7: Free-Busy** — **MEDIUM**
   - No free-busy queries
   - Common client feature
   - **Estimated Effort**: 1 week
   - **Priority**: P2

8. **Phase 8: ACL Properties** — **LOW**
   - Authorization works but not discoverable
   - Poor UX without introspection
   - **Estimated Effort**: 3-5 days
   - **Priority**: P3

---

## Recommended Implementation Order

Based on dependencies and impact:

1. **Phase 5: Recurrence & Timezones** (P0)
   - Create `cal_occurrence` table
   - Implement RRULE expansion
   - Implement timezone resolution
   - Wire into PUT and calendar-query

2. **Phase 6: Synchronization** (P1)
   - Implement sync-collection logic
   - Token validation and change detection
   - Tombstone queries

3. **Phase 9: Discovery** (P1)
   - Well-known URIs
   - Principal properties
   - Collection discovery

4. **Phase 3: Method Completion** (P2)
   - Complete MOVE
   - Complete MKCALENDAR/MKCOL body parsing

5. **Phase 4: expand-property** (P2)
   - Property expansion logic

6. **Phase 7: Free-Busy** (P2)
   - free-busy-query implementation

7. **Phase 8: ACL Properties** (P3)
   - ACL discovery properties

8. **Phase 7: Scheduling** (P3)
   - Scheduling collections
   - iTIP message handling

---

## RFC Compliance Summary

### Fully Compliant

- ✅ RFC 5545 (iCalendar parsing/serialization) — 98%
- ✅ RFC 6350 (vCard parsing/serialization) — 98%
- ✅ RFC 4918 (WebDAV core methods) — 85%
- ✅ RFC 6352 (CardDAV addressbook-query) — 95%

### Partially Compliant

- ⚠️ RFC 4791 (CalDAV) — 60%
  - Missing: Recurrence expansion, free-busy, scheduling
- ⚠️ RFC 6578 (WebDAV Sync) — 30%
  - Missing: sync-collection logic
- ⚠️ RFC 3744 (WebDAV ACL) — 40%
  - Missing: ACL discovery properties

### Not Compliant

- ❌ RFC 6638 (CalDAV Scheduling) — 0%
- ❌ RFC 5546 (iTIP) — 0%
- ❌ RFC 6764 (Service Discovery) — 0%

---

## Test Coverage Summary

### Strong Test Coverage

- ✅ iCalendar parsing: 40+ unit tests
- ✅ vCard parsing: 40+ unit tests
- ✅ WebDAV XML parsing: 25+ unit tests
- ✅ PUT handlers: 20+ integration tests
- ✅ PROPFIND: 8 integration tests
- ✅ GET/HEAD: 6 integration tests

### Weak Test Coverage

- ⚠️ Database operations: Limited integration tests
- ⚠️ Reports: No integration tests for calendar-query/addressbook-query
- ⚠️ Sync: No tests (not implemented)
- ⚠️ Authorization: No permission matrix tests

### Missing Test Coverage

- ❌ Recurrence expansion: No tests (not implemented)
- ❌ Timezone conversion: No tests (not implemented)
- ❌ Free-busy: No tests (not implemented)
- ❌ Scheduling: No tests (not implemented)
- ❌ Discovery flow: No end-to-end tests

---

## Conclusion

Shuriken has made **excellent progress** on Phases 0-4, with strong foundations in:
- Database schema design
- RFC-compliant parsing/serialization
- Core HTTP methods
- Query reports

However, **Phase 5 (Recurrence) is a critical blocker** for production use. Without RRULE expansion and timezone handling, the CalDAV server cannot handle recurring events, which are essential for real-world calendar applications.

**Recommended next steps**:
1. Prioritize Phase 5 implementation
2. Add `cal_occurrence` table migration
3. Integrate RRULE expansion library
4. Implement timezone resolution
5. Complete Phase 6 (sync-collection)
6. Complete Phase 9 (discovery)

With these additions, Shuriken would reach **functional parity** with production CalDAV/CardDAV servers.
