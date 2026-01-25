# Shuriken CalDAV/CardDAV Implementation Checklist

**Last Updated**: 2026-01-25  
**Purpose**: Quick reference checklist for tracking implementation progress

See [Implementation-Status.md](./Implementation-Status.md) for detailed analysis and RFC compliance notes.

---

## Phase 0: Database Schema and Architecture ✅ COMPLETE

- [x] Core identity tables (user, auth_user, group, group_name, membership, principal)
- [x] Casbin rules table
- [x] DAV storage tables (collection, entity, instance, component, property, parameter)
- [x] Tombstone and shadow tables
- [x] Derived index tables (cal_index, card_index, card_email, card_phone)
- [x] UUID v7 primary keys
- [x] Soft delete support
- [x] Auto-updated timestamps
- [ ] **CRITICAL MISSING**: `cal_occurrence` table for recurrence expansion cache

---

## Phase 1: Core Parsing & Serialization ✅ 98% COMPLETE

### iCalendar (RFC 5545)
- [x] Content line lexer with unfolding
- [x] Parameter parsing with quoting
- [x] Value type parsing (DATE, DATE-TIME, DURATION, PERIOD, RRULE, etc.)
- [x] Component hierarchy parsing (VCALENDAR, VEVENT, VTODO, etc.)
- [x] Line folding serializer
- [x] Text escaping (backslash, newline, semicolon, comma)
- [x] Parameter escaping (RFC 6868 caret encoding)
- [x] Canonical ordering for deterministic output
- [x] Round-trip fidelity
- [x] 40+ unit tests
- [ ] **Minor**: RRULE list handling (only first value parsed)

### vCard (RFC 6350 / RFC 2426)
- [x] Line unfolding
- [x] Parameter parsing
- [x] Value type parsing (structured name, address, dates, etc.)
- [x] Version 3.0 and 4.0 support
- [x] Line folding serializer
- [x] vCard-specific escaping
- [x] RFC 6868 caret encoding
- [x] Canonical ordering
- [x] Round-trip fidelity
- [x] 40+ unit tests

### WebDAV XML (RFC 4918 / RFC 4791 / RFC 6352)
- [x] PROPFIND request parsing
- [x] PROPPATCH request parsing
- [x] REPORT request parsing (CalDAV and CardDAV)
- [x] Filter parsing (component, property, parameter, time-range)
- [x] Multistatus response serialization
- [x] PropStat serialization
- [x] Error element generation
- [x] Namespace handling (DAV:, CALDAV:, CARDDAV:, CS:)
- [x] 25+ unit tests

---

## Phase 2: Database Operations ⚠️ 85% COMPLETE

### Entity Storage
- [x] create_entity() — Insert canonical entity with component tree
- [x] update_entity() — Replace entity content
- [x] get_entity() — Retrieve entity by ID
- [x] UID conflict detection
- [x] Component tree insertion

### Instance Operations
- [x] create_instance() — Link entity to collection
- [x] update_instance() — Update ETag, sync revision
- [x] delete_instance() — Soft delete with tombstone
- [x] get_instance() — Retrieve by URI or ID
- [x] Strong ETag generation
- [x] Sync revision tracking

### Collection Operations
- [x] get_collection() — Retrieve collection metadata
- [x] list_collections() — List collections for principal
- [x] Sync token retrieval
- [x] Collection type enforcement

### Mapping Functions
- [x] iCalendar → DB models (component tree flattening)
- [x] vCard → DB models
- [x] DB models → iCalendar/vCard (partial reconstruction)

### Derived Indexes
- [x] cal_index table structure
- [x] card_index, card_email, card_phone table structures
- [ ] **Missing**: Automatic index population on PUT
- [ ] **Missing**: Index cleanup on DELETE
- [ ] **CRITICAL**: cal_occurrence table creation
- [ ] **CRITICAL**: RRULE expansion logic
- [ ] **CRITICAL**: Timezone resolution

---

## Phase 3: Basic HTTP Methods ⚠️ 90% COMPLETE

### Implemented Methods
- [x] OPTIONS — DAV headers, Allow methods (5 tests)
- [x] PROPFIND — Depth handling, property retrieval, multistatus (8 tests)
- [x] PROPPATCH — Property setting, protected property rejection (documented)
- [x] GET/HEAD — Resource retrieval, ETags, conditional requests (6 tests)
- [x] PUT — Content parsing, preconditions, CalDAV/CardDAV validation (20 tests)
- [x] DELETE — Soft delete, tombstones (4 tests)
- [x] COPY — Resource copying, overwrite handling (documented)

### Incomplete Methods
- [ ] **MOVE** — Stub only, needs full implementation (RFC 4918 §9.9)
- [ ] **MKCALENDAR** — Framework exists, needs XML body parsing (RFC 4791 §5.3.1)
- [ ] **MKCOL (Extended)** — Framework exists, needs RFC 5689 body parsing

### Missing Optional Methods
- [ ] LOCK/UNLOCK (WebDAV Class 2, not required for CalDAV/CardDAV)

---

## Phase 4: Query Reports ✅ 95% COMPLETE

### CalDAV Reports
- [x] calendar-query — Filter evaluation, time-range, component/property filters
- [x] calendar-multiget — Href-based retrieval
- [ ] **Partial**: Time-range recurrence expansion (depends on Phase 5)

### CardDAV Reports
- [x] addressbook-query — Property filters, text-match, collation support
- [x] addressbook-multiget — Href-based retrieval

### WebDAV Reports
- [ ] **Stub**: expand-property — Property expansion for principal discovery (RFC 3253 §3.8)

### Partial Retrieval
- [x] calendar-data component selection
- [x] calendar-data property selection
- [x] address-data property selection

---

## Phase 5: Recurrence & Time Zones ❌ 0% COMPLETE — **CRITICAL BLOCKER**

### RRULE Expansion
- [ ] **CRITICAL**: Frequency iteration (DAILY, WEEKLY, MONTHLY, YEARLY)
- [ ] **CRITICAL**: BYxxx rule application (BYDAY, BYMONTH, BYMONTHDAY, etc.)
- [ ] **CRITICAL**: BYSETPOS filtering
- [ ] **CRITICAL**: COUNT limiting
- [ ] **CRITICAL**: UNTIL limiting
- [ ] **CRITICAL**: EXDATE exclusion
- [ ] **CRITICAL**: RDATE inclusion
- [ ] **CRITICAL**: Recurrence-ID override matching

### cal_occurrence Table
- [ ] **CRITICAL**: Create migration
- [ ] **CRITICAL**: Define schema (id, instance_id, dtstart_utc, dtend_utc, sequence)
- [ ] **CRITICAL**: Add indexes for time-range queries
- [ ] **CRITICAL**: Wire population into PUT handler
- [ ] **CRITICAL**: Wire queries into calendar-query report

### Timezone Handling
- [ ] **CRITICAL**: VTIMEZONE parser
- [ ] **CRITICAL**: STANDARD/DAYLIGHT block parsing
- [ ] **CRITICAL**: TZOFFSETFROM/TZOFFSETTO extraction
- [ ] **CRITICAL**: DST transition calculation
- [ ] **CRITICAL**: TZID → timezone definition lookup
- [ ] **CRITICAL**: Local time → UTC conversion
- [ ] **CRITICAL**: DST gap handling (non-existent times)
- [ ] **CRITICAL**: DST fold handling (ambiguous times)

### Query Modifiers
- [ ] expand modifier — Return expanded instances (RFC 4791 §9.6.4)
- [ ] limit-recurrence-set modifier — Limit recurrence range (RFC 4791 §9.6.5)

### Recommended Approach
1. Create `cal_occurrence` table migration
2. Integrate RRULE expansion library (e.g., `rrule` crate)
3. Implement timezone resolution (use `chrono-tz` or parse VTIMEZONE)
4. Wire expansion into PUT handler
5. Update calendar-query to use occurrence cache
6. Add comprehensive tests with RFC 5545 examples

**Estimated Effort**: 2-3 weeks

---

## Phase 6: Synchronization ❌ 10% COMPLETE

### Schema Support (Ready)
- [x] sync_revision column in dav_instance
- [x] dav_tombstone table
- [x] synctoken in dav_collection

### Request Parsing (Ready)
- [x] sync-collection report XML parsing
- [x] Sync-token extraction
- [x] Limit support
- [x] Depth enforcement

### Logic (Missing)
- [ ] Token validation (valid-sync-token error)
- [ ] Change detection (query instances with sync_revision > token)
- [ ] Tombstone inclusion (query tombstones with sync_revision > token)
- [ ] Multistatus response building
  - [ ] Changed resources with propstat
  - [ ] Deleted resources with 404 status-only
- [ ] New token generation
- [ ] Truncation handling (507 response for paging)
- [ ] Authorization integration

### CTag Property
- [ ] Expose DAV:getctag in PROPFIND
- [ ] Keep CTag = synctoken

**Estimated Effort**: 1 week

---

## Phase 7: Free-Busy & Scheduling ❌ 0% COMPLETE

### Free-Busy
- [ ] free-busy-query REPORT handler
- [ ] Event aggregation logic (query events in time-range)
- [ ] Period merging (merge overlapping busy periods)
- [ ] VFREEBUSY generation
- [ ] Authorization (read-free-busy privilege)
- [ ] Exclude CANCELLED/TRANSPARENT events

### Scheduling Collections (RFC 6638)
- [ ] schedule-inbox collection creation
- [ ] schedule-outbox collection creation
- [ ] Principal properties (schedule-inbox-URL, schedule-outbox-URL)

### Scheduling Detection
- [ ] Organizer change detection (ATTENDEE additions/removals)
- [ ] Attendee change detection (PARTSTAT updates)
- [ ] Cancellation detection (STATUS:CANCELLED)

### Internal Delivery
- [ ] Inbox delivery for local users
- [ ] iTIP message wrapping (REQUEST, REPLY, CANCEL)
- [ ] Content-Type: text/calendar; method=REQUEST

### iMIP Gateway (Future)
- [ ] Outbound email for external attendees
- [ ] Inbound email parsing
- [ ] DKIM/SPF verification

**Estimated Effort**: 2-3 weeks for free-busy and basic scheduling

---

## Phase 8: Authorization Integration ⚠️ 40% COMPLETE

### Casbin Integration (Done)
- [x] Casbin enforcer initialization
- [x] ReBAC model (freebusy, reader, writer, owner)
- [x] Subject expansion (user ∪ groups ∪ public)
- [x] Basic authorization checks in handlers

### ACL Discovery Properties (Missing)
- [ ] DAV:current-user-privilege-set — What the current user can do
- [ ] DAV:acl — List of ACEs
- [ ] DAV:principal-collection-set — Principal collections
- [ ] DAV:current-user-principal — Authenticated principal URL
- [ ] DAV:owner — Owner principal URL
- [ ] DAV:group-membership — Groups the principal belongs to

### Privilege Hierarchy
- [ ] Explicit read-free-busy privilege (lower than read)
- [ ] Aggregated privileges (all, read-write)

### Sharing Support
- [ ] Share creation API (HTTP endpoint)
- [ ] Share ceiling enforcement (reader cannot grant writer)
- [ ] Share revocation

**Estimated Effort**: 3-5 days for ACL properties

---

## Phase 9: Discovery & Polish ❌ 0% COMPLETE

### Well-Known URIs (RFC 6764 / RFC 5785)
- [ ] /.well-known/caldav — Redirect to calendar home
- [ ] /.well-known/carddav — Redirect to addressbook home

### Principal Discovery
- [ ] DAV:current-user-principal property
- [ ] CALDAV:calendar-home-set property
- [ ] CARDDAV:addressbook-home-set property
- [ ] Principal URL structure (/principals/users/{username}/)
- [ ] Consistent property values across endpoints

### Collection Discovery
- [ ] Depth: 1 PROPFIND on home set
- [ ] List available calendars/addressbooks
- [ ] Return resourcetype, displayname, description
- [ ] DAV:supported-report-set correctness (advertise only what's implemented)

### Client Compatibility
- [ ] Apple Calendar quirks (CS: namespace properties)
- [ ] Google Calendar quirks (sync behavior)
- [ ] Thunderbird quirks (CardDAV discovery differences)
- [ ] Quirk test suite (replay captured real client requests)

### Performance Optimization
- [ ] Query optimization (N+1 prevention, index tuning)
- [ ] Prepared statement caching
- [ ] Budget/SLA targets:
  - [ ] calendar-query: <500ms for 1000 events
  - [ ] sync-collection: <200ms for typical change set
  - [ ] PROPFIND Depth:1: <300ms for 50 children

### Integration Tests
- [ ] End-to-end scenarios (discovery → create → PUT → query → sync)
- [ ] Failure path coverage (invalid data, unsupported reports, preconditions)
- [ ] Quirk suite (captured real client requests)

**Estimated Effort**: 2-3 weeks for full discovery and polish

---

## Test Coverage Checklist

### Unit Tests ✅ Strong
- [x] iCalendar parser (40+ tests)
- [x] vCard parser (40+ tests)
- [x] WebDAV XML parser (25+ tests)

### Integration Tests ⚠️ Weak
- [x] PUT handlers (20 tests)
- [x] PROPFIND (8 tests)
- [x] GET/HEAD (6 tests)
- [x] OPTIONS (5 tests)
- [x] DELETE (4 tests)
- [ ] Report handlers (0 tests) — **Gap**
- [ ] Authorization matrix (0 tests) — **Gap**
- [ ] Database transactions (limited tests) — **Gap**

### Missing Tests ❌
- [ ] Recurrence expansion (not implemented)
- [ ] Timezone conversion (not implemented)
- [ ] sync-collection (not implemented)
- [ ] End-to-end discovery flow (not implemented)
- [ ] Free-busy (not implemented)
- [ ] Scheduling (not implemented)

---

## RFC Compliance Checklist

### Fully Compliant ✅
- [x] RFC 5545 (iCalendar) — 98%
- [x] RFC 6350 (vCard) — 98%
- [x] RFC 6868 (Parameter Encoding)
- [x] RFC 6352 (CardDAV addressbook-query)

### Partially Compliant ⚠️
- [x] RFC 4918 (WebDAV) — 85% (missing MOVE, LOCK/UNLOCK)
- [x] RFC 4791 (CalDAV) — 60% (missing recurrence, free-busy, scheduling)
- [x] RFC 6578 (WebDAV Sync) — 30% (stub only)
- [x] RFC 3744 (WebDAV ACL) — 40% (missing discovery properties)
- [x] RFC 3253 (REPORT framework) — 85% (missing expand-property)
- [x] RFC 5689 (Extended MKCOL) — 50% (body parsing incomplete)

### Not Compliant ❌
- [ ] RFC 6638 (CalDAV Scheduling)
- [ ] RFC 5546 (iTIP)
- [ ] RFC 6047 (iMIP)
- [ ] RFC 6764 (Service Discovery)
- [ ] RFC 5397 (current-user-principal)

---

## Priority Order

Based on dependencies and impact:

### P0 — Critical Blockers
1. **Phase 5: Recurrence & Timezones** (2-3 weeks)
   - Create cal_occurrence table
   - Implement RRULE expansion
   - Implement timezone resolution
   - Wire into PUT and calendar-query

### P1 — High Priority
2. **Phase 6: Synchronization** (1 week)
   - Implement sync-collection logic
   - Token validation and change detection

3. **Phase 9: Discovery** (1 week)
   - Well-known URIs
   - Principal properties

### P2 — Medium Priority
4. **Phase 3: Method Completion** (3-5 days)
   - Complete MOVE
   - Complete MKCALENDAR/MKCOL body parsing

5. **Phase 4: expand-property** (3-5 days)
   - Property expansion logic

6. **Phase 7: Free-Busy** (1 week)
   - free-busy-query implementation

### P3 — Low Priority
7. **Phase 8: ACL Properties** (3-5 days)
   - ACL discovery properties

8. **Phase 7: Scheduling** (2-3 weeks)
   - Scheduling collections
   - iTIP message handling

---

## Summary

**Current Status**: ~50% complete through planned Phase 5

**Strengths**:
- ✅ Excellent RFC-compliant parsing/serialization
- ✅ Solid database schema design
- ✅ Core HTTP methods working
- ✅ Query reports functional for non-recurring events

**Critical Gaps**:
- ❌ Phase 5 (Recurrence) — **BLOCKS PRODUCTION USE**
- ❌ Phase 6 (Sync) — Efficiency issue
- ❌ Phase 9 (Discovery) — Auto-configuration issue

**Next Steps**:
1. Implement Phase 5 (recurrence expansion)
2. Implement Phase 6 (sync-collection)
3. Implement Phase 9 (discovery)
4. Complete remaining method stubs
5. Add integration test coverage
6. Performance optimization
7. Client compatibility testing

With Phase 5-6-9 complete, Shuriken would reach **functional parity** with production CalDAV/CardDAV servers.
