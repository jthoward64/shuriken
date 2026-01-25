#!/bin/bash

# Script to create GitHub issues for Shuriken project phases
# Usage: ./create_github_issues.sh
# Requires: GitHub CLI (gh) to be installed and authenticated

set -e

REPO="jthoward64/shuriken"

echo "Creating GitHub issues for Shuriken project phases..."
echo "Repository: $REPO"
echo ""

# Function to create an issue
create_issue() {
    local title="$1"
    local body="$2"
    local labels="$3"
    
    echo "Creating issue: $title"
    gh issue create \
        --repo "$REPO" \
        --title "$title" \
        --body "$body" \
        --label "$labels" 2>&1 | tee /tmp/gh_output.txt
    
    # Extract issue number from output
    issue_url=$(grep -o 'https://github.com/.*/issues/[0-9]*' /tmp/gh_output.txt || echo "")
    if [ -n "$issue_url" ]; then
        issue_number=$(echo "$issue_url" | grep -o '[0-9]*$')
        echo "Created issue #$issue_number"
        echo "$issue_number"
    else
        echo "Failed to create issue: $title"
        echo "0"
    fi
}

#
# Phase 0: Database Schema and Architecture
#

echo "=== Phase 0: Database Schema and Architecture ==="
PHASE0_EPIC=$(create_issue \
    "Phase 0: Database Schema and Architecture" \
    "Phase 0 establishes the foundational database schema for Shuriken's CalDAV/CardDAV server.

**Status**: ✅ COMPLETE (100%)

All core schema elements are implemented:
- ✅ Core Identity Tables (user, auth_user, group, membership, principal)
- ✅ DAV Storage Tables (collection, entity, instance, component, property, parameter, tombstone, shadow)
- ✅ Derived Index Tables (cal_index, card_index, card_email, card_phone)
- ✅ UUID v7 primary keys with PostgreSQL 17 native support
- ✅ Soft deletes with \`deleted_at\` columns
- ✅ Auto-updated timestamps

**Note**: The only critical missing element (\`cal_occurrence\` table) was tracked separately and has been completed as part of Phase 5.

**No sub-issues needed** - Phase 0 is complete.

See \`GITHUB_ISSUES.md\` for details." \
    "epic,phase-0,documentation")

echo ""

#
# Phase 1: Core Parsing & Serialization
#

echo "=== Phase 1: Core Parsing & Serialization ==="
PHASE1_EPIC=$(create_issue \
    "Phase 1: Core Parsing & Serialization" \
    "Phase 1 provides RFC-compliant parsers and serializers for iCalendar (RFC 5545), vCard (RFC 6350/2426), and WebDAV XML (RFC 4918/4791/6352).

**Status**: ✅ COMPLETE (98%)

The parsing and serialization layer is excellent with comprehensive test coverage. Minor known issues exist but don't block functionality.

See \`GITHUB_ISSUES.md\` for complete details and sub-issues." \
    "epic,phase-1,P2")

sleep 1

create_issue \
    "Fix RRULE list handling for comma-separated values" \
    "Currently, only the first RRULE value is parsed when multiple comma-separated values are present in a property.

**Location**: \`src/component/rfc/ical/parse/values.rs\`

**Current Behavior**: 
\`\`\`rust
// For now, just take the first one. TODO: handle lists properly
\`\`\`

**Expected Behavior**: Parse all comma-separated RRULE values and handle them appropriately.

**Impact**: Low - Multi-RRULE properties are rare in practice

**RFC Reference**: RFC 5545 allows list-valued RRULE in some contexts

**Acceptance Criteria**:
- [ ] Parse comma-separated RRULE lists
- [ ] Store multiple RRULE values
- [ ] Add unit tests for multi-value RRULE properties
- [ ] Update documentation

Part of #$PHASE1_EPIC" \
    "phase-1,P2,enhancement,rfc-compliance"

sleep 1

create_issue \
    "Verify and document parameter value list handling" \
    "Some parameters support multiple comma-separated values (e.g., MEMBER, custom X-params). Need to verify complete handling and document behavior.

**Tasks**:
- [ ] Audit parameter parsing for multi-value support
- [ ] Test MEMBER parameter with multiple values
- [ ] Test custom X-parameters with lists
- [ ] Document supported parameter list formats
- [ ] Add unit tests for edge cases

**Impact**: Low - Affects niche use cases

Part of #$PHASE1_EPIC" \
    "phase-1,P3,documentation,testing"

sleep 1

create_issue \
    "Document X-property and X-parameter handling" \
    "X-properties and X-parameters are round-tripped correctly but not documented. Some well-known extensions should be documented.

**Tasks**:
- [ ] Document X-property round-trip behavior
- [ ] List known X-extensions (X-WR-CALNAME, X-APPLE-STRUCTURED-LOCATION, etc.)
- [ ] Document which X-extensions receive special handling (if any)
- [ ] Add examples to documentation

**Impact**: Low - Documentation only, functionality works

Part of #$PHASE1_EPIC" \
    "phase-1,P3,documentation"

echo ""

#
# Phase 2: Database Operations
#

echo "=== Phase 2: Database Operations ==="
PHASE2_EPIC=$(create_issue \
    "Phase 2: Database Operations" \
    "Phase 2 establishes the database layer for CalDAV/CardDAV content storage including CRUD operations, ETag generation, sync revision tracking, and derived indexes.

**Status**: ⚠️ MOSTLY COMPLETE (85%)

Core storage operations are functional. Critical gaps remain in derived index population and transaction verification.

See \`GITHUB_ISSUES.md\` for complete details and sub-issues." \
    "epic,phase-2,P2")

sleep 1

create_issue \
    "Populate derived indexes (cal_index, card_index) on PUT" \
    "Derived index tables exist in the schema but are not populated by PUT handlers. This causes query performance degradation as collections grow.

**Current State**: 
- ✅ \`cal_index\` table structure exists
- ✅ \`card_index\` table structure exists
- ❌ PUT handler does not populate indexes
- ❌ DELETE handler does not clean up indexes

**Impact**: Calendar-query and addressbook-query reports perform full table scans instead of using indexes, significantly degrading performance with large collections.

**Tasks**:
- [ ] Add \`populate_cal_index()\` call in CalDAV PUT handler after entity creation
- [ ] Add \`populate_card_index()\` call in CardDAV PUT handler after vCard creation
- [ ] Add index cleanup in DELETE handler
- [ ] Ensure index updates are atomic with entity/instance changes
- [ ] Add integration tests verifying index population
- [ ] Verify index cleanup on resource deletion

**Files to Modify**:
- \`src/app/api/caldav/method/put/mod.rs\`
- \`src/app/api/carddav/method/put/mod.rs\`
- \`src/app/api/dav/method/delete.rs\`
- \`src/component/db/query/dav/index.rs\` (create if needed)

**Estimated Effort**: 2-3 days

**Acceptance Criteria**:
- [ ] Indexes populated on every PUT
- [ ] Indexes cleaned on DELETE
- [ ] Integration tests verify index population
- [ ] Query performance improved (benchmark with 1000+ events)

Part of #$PHASE2_EPIC" \
    "phase-2,P2,performance,database"

sleep 1

create_issue \
    "Add comprehensive transaction verification tests" \
    "PUT operations appear atomic but lack comprehensive transaction testing. Need to verify rollback behavior on failures.

**Current State**:
- Entity + instance + tombstones appear atomic
- No tests for constraint violations
- No tests for rollback behavior
- Connection pool transaction handling under load not verified

**Impact**: Potential data corruption or inconsistent state on failures

**Tasks**:
- [ ] Add tests for constraint violation rollback
- [ ] Add tests for concurrent write behavior
- [ ] Test transaction boundaries (entity + instance + indexes)
- [ ] Test connection pool transaction handling
- [ ] Document transaction guarantees
- [ ] Test foreign key constraint violations

**Estimated Effort**: 1-2 days

**Acceptance Criteria**:
- [ ] All transaction rollback scenarios tested
- [ ] Concurrent write tests pass
- [ ] Documentation updated with transaction guarantees
- [ ] Test coverage > 80% for database operations

Part of #$PHASE2_EPIC" \
    "phase-2,P2,testing,database"

echo ""

#
# Phase 3: Basic HTTP Methods
#

echo "=== Phase 3: Basic HTTP Methods ==="
PHASE3_EPIC=$(create_issue \
    "Phase 3: Basic HTTP Methods" \
    "Phase 3 implements core HTTP methods required for WebDAV/CalDAV/CardDAV compliance: OPTIONS, PROPFIND, PROPPATCH, GET, PUT, DELETE, COPY, MOVE, MKCALENDAR, MKCOL.

**Status**: ⚠️ MOSTLY COMPLETE (90%)

All critical CRUD operations work correctly. MOVE, MKCALENDAR, and Extended MKCOL need completion.

See \`GITHUB_ISSUES.md\` for complete details and sub-issues." \
    "epic,phase-3,P2")

sleep 1

create_issue \
    "Implement MOVE method handler" \
    "MOVE handler is currently a stub. RFC 4918 §9.9 requires MOVE support for WebDAV Class 1 compliance.

**Current State**: Stub implementation marked with TODO in \`src/app/api/dav/method/move.rs\`

**RFC Requirement**: RFC 4918 §9.9 - MOVE method

**Tasks**:
- [ ] Parse Destination header
- [ ] Parse Overwrite header (T/F)
- [ ] Implement source instance soft delete
- [ ] Create tombstone for source resource
- [ ] Create new instance at destination
- [ ] Update sync revision for both source and destination collections
- [ ] Support cross-collection moves
- [ ] Handle authorization (write on both source and destination)
- [ ] Add integration tests
- [ ] Test with Apple Calendar and Thunderbird

**Files to Modify**:
- \`src/app/api/dav/method/move.rs\`

**Estimated Effort**: 2-3 days

**Acceptance Criteria**:
- [ ] MOVE works within same collection
- [ ] MOVE works across collections
- [ ] Destination header parsed correctly
- [ ] Overwrite header respected
- [ ] Tombstones created for source
- [ ] Sync revisions updated
- [ ] Integration tests pass
- [ ] Clients can reorganize resources

Part of #$PHASE3_EPIC" \
    "phase-3,P2,http-method,rfc-compliance"

sleep 1

create_issue \
    "Implement MKCALENDAR XML body parsing and property application" \
    "MKCALENDAR framework exists but XML body parsing is incomplete. RFC 4791 §5.3.1 recommends supporting initial property setting during calendar creation.

**Current State**: Framework in \`src/app/api/caldav/method/mkcalendar.rs\` but body parsing incomplete

**RFC Requirement**: RFC 4791 §5.3.1 - MKCALENDAR

**Tasks**:
- [ ] Parse \`<C:mkcalendar>\` XML body
- [ ] Extract \`<D:set>\` properties
- [ ] Apply initial properties (displayname, calendar-description, calendar-timezone)
- [ ] Handle property validation errors
- [ ] Return appropriate error codes for invalid combinations
- [ ] Add integration tests
- [ ] Test with Apple Calendar

**Files to Modify**:
- \`src/app/api/caldav/method/mkcalendar.rs\`
- \`src/component/rfc/dav/parse/mkcalendar.rs\` (create if needed)

**Estimated Effort**: 2-3 days

**Impact**: Without this, clients must make two requests (MKCALENDAR + PROPPATCH) instead of one

**Acceptance Criteria**:
- [ ] XML body parsing complete
- [ ] Initial properties applied during creation
- [ ] Error handling for invalid properties
- [ ] Integration tests pass
- [ ] Apple Calendar compatibility verified

Part of #$PHASE3_EPIC" \
    "phase-3,P2,caldav,rfc-compliance"

sleep 1

create_issue \
    "Implement RFC 5689 Extended MKCOL body parsing" \
    "Extended MKCOL (RFC 5689) parsing is incomplete. RFC 6352 §5.2 recommends Extended MKCOL support for CardDAV.

**Current State**: Framework in \`src/app/api/carddav/method/mkcol.rs\` but RFC 5689 parsing incomplete

**RFC Requirement**: RFC 5689 - Extended MKCOL, RFC 6352 §5.2

**Tasks**:
- [ ] Parse Extended MKCOL XML body \`<D:mkcol>\`
- [ ] Extract \`<D:set>\` properties
- [ ] Parse \`<D:resourcetype>\` specification at creation time
- [ ] Apply initial properties for addressbooks
- [ ] Handle validation errors
- [ ] Add integration tests
- [ ] Test with Thunderbird

**Files to Modify**:
- \`src/app/api/carddav/method/mkcol.rs\`
- \`src/component/rfc/dav/parse/mkcol.rs\` (create if needed)

**Estimated Effort**: 2-3 days

**Impact**: Without this, clients must make two requests (MKCOL + PROPPATCH) instead of one

**Acceptance Criteria**:
- [ ] Extended MKCOL body parsing complete
- [ ] Resourcetype specified at creation
- [ ] Initial properties applied
- [ ] Integration tests pass
- [ ] Thunderbird compatibility verified

Part of #$PHASE3_EPIC" \
    "phase-3,P2,carddav,rfc-compliance"

echo ""

#
# Phase 4: Query Reports
#

echo "=== Phase 4: Query Reports ==="
PHASE4_EPIC=$(create_issue \
    "Phase 4: Query Reports" \
    "Phase 4 implements REPORT methods for CalDAV and CardDAV queries: calendar-query, calendar-multiget, addressbook-query, addressbook-multiget, expand-property, sync-collection.

**Status**: ✅ COMPLETE (95%)

All CalDAV and CardDAV query reports work correctly. Missing expand-property report and recurrence expansion in time-range filters (Phase 5 dependency).

See \`GITHUB_ISSUES.md\` for complete details and sub-issues." \
    "epic,phase-4,P2")

sleep 1

create_issue \
    "Implement expand-property report (RFC 3253 §3.8)" \
    "expand-property report is currently a stub. RFC 6352 §6.3.5 requires it for CardDAV principal discovery and group member expansion.

**Current State**: Stub only in \`src/app/api/dav/method/report.rs\`

**RFC Requirement**: RFC 3253 §3.8, RFC 6352 §6.3.5

**Impact**: CardDAV clients must make multiple requests instead of using expand-property for principal discovery

**Tasks**:
- [ ] Parse \`<D:expand-property>\` request body
- [ ] Extract property names to expand
- [ ] Resolve hrefs (principal-URL, member URLs)
- [ ] Implement URL dereferencing
- [ ] Implement cycle detection (track visited URLs)
- [ ] Handle recursive expansion with depth
- [ ] Build nested \`<D:response>\` with expanded properties
- [ ] Add integration tests
- [ ] Test with CardDAV clients

**Files to Create/Modify**:
- \`src/app/api/dav/report/expand_property.rs\` (create)
- \`src/app/api/dav/method/report.rs\` (wire in)
- \`src/component/rfc/dav/parse/report.rs\` (parsing exists, may need updates)

**Estimated Effort**: 1 week (complex due to recursive expansion)

**Acceptance Criteria**:
- [ ] Property expansion works for principals
- [ ] Group member expansion works
- [ ] Cycle detection prevents infinite loops
- [ ] Depth handling correct
- [ ] Integration tests pass
- [ ] CardDAV clients can use expand-property

Part of #$PHASE4_EPIC" \
    "phase-4,P2,carddav,rfc-compliance"

sleep 1

create_issue \
    "Support recurrence expansion in calendar-query time-range filters" \
    "Time-range filters currently only check master event \`dtstart\`/\`dtend\` from \`cal_index\`. Recurring events outside their master range won't match queries.

**Current State**: Time-range filter compares \`dtstart_utc\` and \`dtend_utc\` from \`cal_index\` only

**RFC Requirement**: RFC 4791 §9.9 requires recurrence expansion in time-range filters

**Impact**: Recurring events don't appear in time-range queries for occurrence dates. For example, a weekly meeting starting Jan 1 won't appear in a Feb 1-28 query.

**Dependencies**: Phase 5 must be complete (RRULE expansion engine and \`cal_occurrence\` table)

**Tasks**:
- [ ] Join with \`cal_occurrence\` table for recurring events
- [ ] Filter occurrences by time-range
- [ ] Handle EXDATE exclusions
- [ ] Handle RDATE inclusions
- [ ] Handle RECURRENCE-ID overrides
- [ ] Fallback to \`cal_index\` for non-recurring events
- [ ] Add integration tests
- [ ] Test with various recurrence patterns

**Files to Modify**:
- \`src/component/db/query/caldav/filter.rs\`
- \`src/app/api/caldav/report/calendar_query.rs\`

**Estimated Effort**: 2-3 days (after Phase 5 complete)

**Acceptance Criteria**:
- [ ] Recurring events match time-range queries correctly
- [ ] EXDATE/RDATE handled
- [ ] RECURRENCE-ID overrides work
- [ ] Non-recurring events still work
- [ ] Integration tests verify all recurrence patterns
- [ ] Performance acceptable for large recurrence sets

Part of #$PHASE4_EPIC" \
    "phase-4,P0,caldav,rfc-compliance"

echo ""

#
# Phase 5: Recurrence & Time Zones
#

echo "=== Phase 5: Recurrence & Time Zones ==="
PHASE5_EPIC=$(create_issue \
    "Phase 5: Recurrence & Time Zones" \
    "Phase 5 implements RRULE (recurrence rule) expansion, timezone resolution, and UTC conversion for timezone-aware events.

**Status**: ✅ COMPLETE (100%)

Phase 5 is now completely implemented with comprehensive RRULE expansion, timezone resolution, and occurrence caching. All RFC 4791 recurrence features are functional.

**Completed Features**:
- ✅ RRULE Expansion using \`rrule\` crate
- ✅ Timezone Resolution with \`chrono-tz\`
- ✅ Occurrence Caching in \`cal_occurrence\` table
- ✅ UID-based Component Matching
- ✅ RECURRENCE-ID Exception Handling
- ✅ Expand Modifier for calendar-query
- ✅ Limit-Recurrence-Set Support

**No sub-issues needed** - Phase 5 is complete and ready for production.

See \`GITHUB_ISSUES.md\` for details." \
    "epic,phase-5,P0")

echo ""

#
# Phase 6: Synchronization
#

echo "=== Phase 6: Synchronization ==="
PHASE6_EPIC=$(create_issue \
    "Phase 6: Synchronization (RFC 6578)" \
    "Phase 6 implements RFC 6578 sync-collection support for efficient incremental synchronization. This enables clients to request only changed resources since a previous sync token.

**Status**: ❌ STUB ONLY (10%)

Database schema supports sync tokens and tombstones. All sync-collection report logic is marked TODO.

**Impact**: Without sync-collection, clients must use full PROPFIND or calendar-query on every poll, wasting bandwidth and server resources.

See \`GITHUB_ISSUES.md\` for complete details and sub-issues." \
    "epic,phase-6,P1")

sleep 1

create_issue \
    "Implement sync-collection report with token validation and change detection" \
    "Implement complete sync-collection report logic for efficient incremental synchronization.

**Current State**: 
- ✅ Schema supports sync tokens and tombstones
- ✅ Request parsing exists
- ❌ All logic marked TODO in \`build_sync_collection_response()\`

**RFC Requirement**: RFC 6578 §3 - sync-collection report

**Tasks**:
- [ ] Implement token validation
  - Parse sync-token as \`BIGINT\` revision number
  - Validate token not from future
  - Return \`valid-sync-token\` error for invalid tokens
- [ ] Implement change detection queries
  - Query instances with \`sync_revision > baseline\`
  - Query tombstones with \`sync_revision > baseline\`
  - Apply limit to prevent huge responses
- [ ] Build multistatus response
  - Changed resources with full propstat
  - Deleted resources with 404 status only
  - New sync token in response
- [ ] Implement truncation handling (507 response)
  - Detect when changes exceed limit (e.g., >1000)
  - Return partial results with sync token
  - Allow client to resume with next request
- [ ] Add authorization checks
- [ ] Add integration tests

**Files to Modify**:
- \`src/app/api/dav/method/report.rs\`
- \`src/component/db/query/dav/sync.rs\` (create)

**Estimated Effort**: 3-5 days

**Acceptance Criteria**:
- [ ] Token validation works
- [ ] Change detection queries correct
- [ ] Multistatus response format correct
- [ ] Tombstones included for deletions
- [ ] Truncation (507) works for large change sets
- [ ] Integration tests pass
- [ ] Clients can perform incremental sync

Part of #$PHASE6_EPIC" \
    "phase-6,P1,sync,rfc-compliance"

sleep 1

create_issue \
    "Add DAV:getctag property to PROPFIND" \
    "Expose collection change tag (CTag) for older clients that don't support sync-collection.

**Current State**: 
- Schema has \`synctoken\` column
- CTag not exposed in PROPFIND

**RFC Note**: RFC 6578 deprecates CTag in favor of sync-collection, but some older clients still use it

**Tasks**:
- [ ] Add \`DAV:getctag\` to live properties in PROPFIND handler
- [ ] Map to \`collection.synctoken\`
- [ ] Add tests
- [ ] Verify with older CalDAV clients

**Files to Modify**:
- \`src/app/api/dav/method/propfind/mod.rs\`

**Estimated Effort**: 1 day

**Impact**: Low - sync-collection is superior and recommended

**Acceptance Criteria**:
- [ ] CTag property returned in PROPFIND
- [ ] Value matches synctoken
- [ ] Tests verify correctness

Part of #$PHASE6_EPIC" \
    "phase-6,P2,caldav,compatibility"

sleep 1

create_issue \
    "Add compound indexes for sync-collection performance" \
    "Add database indexes optimized for sync-collection queries to improve performance with large change sets.

**Current State**: Basic indexes exist but not optimized for sync queries

**Tasks**:
- [ ] Add compound index on \`(collection_id, sync_revision, deleted_at)\`
- [ ] Add compound index on tombstones for sync queries
- [ ] Analyze query plans with EXPLAIN ANALYZE
- [ ] Benchmark with various data sizes
- [ ] Test performance with >1000 changes

**Files to Modify**:
- Create new migration in \`migrations/\`

**Estimated Effort**: 1-2 days

**Acceptance Criteria**:
- [ ] Compound indexes created
- [ ] Query plans use indexes
- [ ] Performance benchmarks show improvement
- [ ] Scales to large change sets

Part of #$PHASE6_EPIC" \
    "phase-6,P2,performance,database"

echo ""

#
# Phase 7: Free-Busy & Scheduling
#

echo "=== Phase 7: Free-Busy & Scheduling ==="
PHASE7_EPIC=$(create_issue \
    "Phase 7: Free-Busy & Scheduling" \
    "Phase 7 implements free-busy queries and calendar scheduling features including ATTENDEE management, PARTSTAT updates, and iTIP message exchange.

**Status**: ❌ NOT STARTED (0%)

No implementation. This is essential for multi-user calendar coordination and meeting scheduling.

**Priority**: MEDIUM - Free-busy is commonly used; scheduling required for meeting invitations

See \`GITHUB_ISSUES.md\` for complete details and sub-issues." \
    "epic,phase-7,P2")

sleep 1

create_issue \
    "Implement free-busy-query report (RFC 4791 §7.10)" \
    "Implement free-busy-query report to allow availability queries without accessing event details (privacy-preserving).

**Current State**: No implementation. XML parsing exists but no handler.

**RFC Requirement**: RFC 4791 §7.10 - free-busy-query

**Tasks**:
- [ ] Parse \`<C:free-busy-query>\` request body
- [ ] Extract time-range parameters
- [ ] Extract target principal(s)
- [ ] Implement event aggregation logic
  - Query events in time-range across user's calendars
  - Filter by STATUS (include CONFIRMED, exclude CANCELLED)
  - Filter by TRANSP (include OPAQUE, exclude TRANSPARENT)
  - Handle ATTENDEE PARTSTAT (exclude DECLINED)
- [ ] Handle recurring events (requires Phase 5)
- [ ] Implement period merging algorithm
  - Merge overlapping busy periods
  - Separate BUSY-UNAVAILABLE periods
- [ ] Build VFREEBUSY component
  - Generate FREEBUSY properties with period lists
  - Include FBTYPE parameter (BUSY, BUSY-UNAVAILABLE, BUSY-TENTATIVE)
- [ ] Implement \`read-free-busy\` authorization
  - Lower privilege than \`read\`
  - Don't leak event details
- [ ] Add integration tests
- [ ] Test with Apple Calendar

**Files to Create**:
- \`src/app/api/caldav/report/free_busy_query.rs\`
- \`src/component/caldav/freebusy.rs\`

**Estimated Effort**: 1 week

**Acceptance Criteria**:
- [ ] Free-busy queries return availability
- [ ] Event details not leaked
- [ ] Recurring events handled correctly
- [ ] Period merging works
- [ ] VFREEBUSY format correct
- [ ] Authorization checks work
- [ ] Integration tests pass

Part of #$PHASE7_EPIC" \
    "phase-7,P2,caldav,free-busy,rfc-compliance"

sleep 1

create_issue \
    "Add scheduling inbox/outbox collections and schema" \
    "Create database schema and collections for iTIP scheduling (inbox/outbox).

**Current State**: No scheduling collections exist

**RFC Requirement**: RFC 6638 §2 - Scheduling collections

**Tasks**:
- [ ] Add \`schedule-inbox\` collection for each principal
  - Path: \`/calendars/users/{username}/inbox/\`
- [ ] Add \`schedule-outbox\` collection for each principal
  - Path: \`/calendars/users/{username}/outbox/\`
- [ ] Create \`dav_schedule_message\` table
  - Columns: id, collection_id, sender, recipient, method, ical_data, status, created_at
- [ ] Add principal properties
  - \`CALDAV:schedule-inbox-URL\`
  - \`CALDAV:schedule-outbox-URL\`
  - \`CALDAV:calendar-user-address-set\`
- [ ] Write migration
- [ ] Update schema
- [ ] Add models

**Files to Create/Modify**:
- New migration in \`migrations/\`
- \`src/component/db/model/dav/schedule.rs\`
- \`src/component/db/schema.rs\` (auto-generated)

**Estimated Effort**: 3-5 days

**Acceptance Criteria**:
- [ ] Schema created
- [ ] Inbox/outbox collections created for principals
- [ ] Properties exposed in PROPFIND
- [ ] Models implemented

Part of #$PHASE7_EPIC" \
    "phase-7,P2,scheduling,database"

sleep 1

create_issue \
    "Implement iTIP message generation and local delivery" \
    "Implement iTIP message generation and delivery to local users' inboxes.

**Current State**: No message delivery mechanism

**RFC Requirement**: RFC 6638 §4 - Scheduling inbox/outbox, RFC 5546 - iTIP

**Tasks**:
- [ ] Implement iTIP REQUEST message generation
- [ ] Implement iTIP REPLY message generation
- [ ] Implement iTIP CANCEL message generation
- [ ] Implement local user delivery
  - Lookup recipient principal by mailto: URI
  - Resolve to inbox collection
  - POST iTIP message to recipient's inbox
- [ ] Implement iTIP message wrapping
  - Wrap in VCALENDAR with METHOD property
  - Set appropriate Content-Type
- [ ] Implement delivery status tracking
  - Return \`<C:schedule-response>\` with per-recipient status
- [ ] Add integration tests

**Files to Create**:
- \`src/component/caldav/scheduling/itip.rs\`
- \`src/component/caldav/scheduling/delivery.rs\`
- \`src/app/api/caldav/scheduling/inbox.rs\`
- \`src/app/api/caldav/scheduling/outbox.rs\`

**Estimated Effort**: 1-2 weeks

**Acceptance Criteria**:
- [ ] iTIP messages generated correctly
- [ ] Local delivery works
- [ ] Status tracking correct
- [ ] Integration tests pass
- [ ] Users can schedule meetings with local attendees

Part of #$PHASE7_EPIC" \
    "phase-7,P2,scheduling,itip"

sleep 1

create_issue \
    "Detect ATTENDEE changes and trigger automatic iTIP messages" \
    "Detect scheduling-related changes in PUT operations and automatically generate iTIP messages.

**Current State**: PUT stores events but doesn't trigger scheduling logic

**Tasks**:
- [ ] Detect ORGANIZER changes
  - New ATTENDEE added → send REQUEST
  - ATTENDEE removed → send CANCEL
  - ATTENDEE properties changed → send REQUEST update
- [ ] Detect ATTENDEE changes
  - PARTSTAT updated → send REPLY to organizer
  - DELEGATED-TO/FROM updated → handle delegation
- [ ] Detect cancellation
  - STATUS:CANCELLED → send CANCEL to all attendees
- [ ] Wire into PUT handler
- [ ] Add integration tests
- [ ] Test complete scheduling workflow

**Files to Modify**:
- \`src/app/api/caldav/method/put/mod.rs\`
- \`src/component/caldav/scheduling/detection.rs\` (create)

**Estimated Effort**: 1-2 weeks

**Acceptance Criteria**:
- [ ] ATTENDEE additions trigger REQUEST
- [ ] ATTENDEE removals trigger CANCEL
- [ ] PARTSTAT updates trigger REPLY
- [ ] Cancellations trigger CANCEL
- [ ] Integration tests verify complete workflow

Part of #$PHASE7_EPIC" \
    "phase-7,P2,scheduling,caldav"

echo ""

#
# Phase 8: Authorization Integration
#

echo "=== Phase 8: Authorization Integration ==="
PHASE8_EPIC=$(create_issue \
    "Phase 8: Authorization Integration" \
    "Phase 8 integrates Casbin-based authorization throughout the system and exposes ACL discovery properties to clients.

**Status**: ⚠️ PARTIAL (40%)

Authorization enforcement works correctly but ACL properties missing, preventing clients from discovering permissions.

See \`GITHUB_ISSUES.md\` for complete details and sub-issues." \
    "epic,phase-8,P3")

sleep 1

create_issue \
    "Add current-user-privilege-set and other ACL properties to PROPFIND" \
    "Implement ACL discovery properties so clients can discover what permissions they have on resources.

**Current State**: Clients cannot discover permissions, leading to poor UX

**RFC Requirement**: RFC 3744 §5 - ACL properties

**Impact**: Clients show incorrect UI (e.g., \"Delete\" button when user can't delete)

**Tasks**:
- [ ] Implement \`DAV:current-user-privilege-set\` (RFC 3744 §5.4)
  - Query Casbin for all privileges
  - Return only granted privileges
  - Add to PROPFIND live properties
- [ ] Implement \`DAV:acl\` (RFC 3744 §5.5)
  - List all ACEs for resource
  - Include principal hrefs and privileges
  - Restrict to owner/admin only for privacy
- [ ] Implement \`DAV:principal-collection-set\` (RFC 3744 §5.8)
  - Return static list of principal collection URLs
- [ ] Implement \`DAV:current-user-principal\` (RFC 5397)
  - Return authenticated principal URL
- [ ] Implement \`DAV:owner\` (RFC 3744 §5.1)
  - Return owner principal URL
- [ ] Implement \`DAV:group-membership\` (RFC 3744 §4.4)
  - List groups for principal
  - Only for principal resources
- [ ] Add integration tests
- [ ] Test with CalDAV/CardDAV clients

**Files to Modify**:
- \`src/app/api/dav/method/propfind/mod.rs\`
- \`src/component/auth/acl.rs\` (create for ACL property helpers)

**Estimated Effort**: 1 week

**Acceptance Criteria**:
- [ ] All ACL properties implemented
- [ ] Clients can discover permissions
- [ ] Principal properties work
- [ ] Integration tests pass
- [ ] UI elements shown/hidden correctly based on privileges

Part of #$PHASE8_EPIC" \
    "phase-8,P3,acl,rfc-compliance"

sleep 1

create_issue \
    "Add HTTP API for creating and managing calendar/addressbook shares" \
    "Create HTTP API endpoints for sharing calendars and addressbooks with other users/groups.

**Current State**: No API for creating shares

**Tasks**:
- [ ] Create \`POST /_api/shares\` endpoint
  - Accept resource_id, principal_id, role
  - Validate principal exists
  - Insert Casbin policy
  - Return share details
- [ ] Implement share ceiling enforcement
  - Reader cannot grant any privileges
  - Writer cannot grant owner
  - Owner can grant any privileges
- [ ] Create \`DELETE /_api/shares/{share_id}\` endpoint
  - Verify admin privilege
  - Delete Casbin policy
- [ ] Create \`GET /_api/shares\` endpoint
  - List shares for resource
  - Return principal names and roles
- [ ] Add integration tests
- [ ] Add API documentation

**Files to Create**:
- \`src/app/api/share/mod.rs\`
- \`src/app/api/share/create.rs\`
- \`src/app/api/share/list.rs\`
- \`src/app/api/share/delete.rs\`

**Estimated Effort**: 3-5 days

**Acceptance Criteria**:
- [ ] Shares can be created via API
- [ ] Share ceiling enforced
- [ ] Shares can be revoked
- [ ] Shares can be listed
- [ ] Integration tests pass
- [ ] API documented

Part of #$PHASE8_EPIC" \
    "phase-8,P3,sharing,api"

sleep 1

create_issue \
    "Implement read-free-busy privilege for free-busy queries" \
    "Add \`read-free-busy\` privilege as a lower privilege than \`read\` for privacy-preserving availability queries.

**Current State**: No read-free-busy privilege

**RFC Requirement**: RFC 4791 §9.3 - read-free-busy privilege

**Tasks**:
- [ ] Add \`read-free-busy\` to Casbin model
- [ ] Grant by default to all authenticated users
- [ ] Check in free-busy-query handler (Phase 7)
- [ ] Update documentation
- [ ] Add tests

**Files to Modify**:
- \`src/component/auth/casbin_model.conf\`
- \`src/app/api/caldav/report/free_busy_query.rs\` (when created in Phase 7)

**Estimated Effort**: 1 day

**Acceptance Criteria**:
- [ ] Privilege exists in Casbin model
- [ ] Granted to authenticated users by default
- [ ] Free-busy queries check privilege
- [ ] Users with only read-free-busy can't read event details

Part of #$PHASE8_EPIC" \
    "phase-8,P3,acl,free-busy"

echo ""

#
# Phase 9: Discovery & Polish
#

echo "=== Phase 9: Discovery & Polish ==="
PHASE9_EPIC=$(create_issue \
    "Phase 9: Discovery & Polish" \
    "Phase 9 implements service discovery (well-known URIs), principal discovery, client compatibility, performance optimization, and comprehensive testing.

**Status**: ❌ NOT STARTED (0%)

No implementation. This phase is essential for user-friendly setup and production readiness.

**Priority**: HIGH - Auto-discovery essential for UX

See \`GITHUB_ISSUES.md\` for complete details and sub-issues." \
    "epic,phase-9,P1")

sleep 1

create_issue \
    "Add /.well-known/caldav and /.well-known/carddav endpoints" \
    "Implement RFC 6764 well-known URIs for auto-configuration.

**Current State**: No well-known URI handlers

**RFC Requirement**: RFC 6764 §6, RFC 5785

**Impact**: Without well-known URIs, users must manually enter collection URLs, creating poor UX

**Tasks**:
- [ ] Add handler for \`GET /.well-known/caldav\`
  - Return 301 redirect to calendar home (simple)
  - Or return 207 with principal/home-set properties (better for some clients)
- [ ] Add handler for \`GET /.well-known/carddav\`
  - Return 301 redirect to addressbook home
- [ ] Add integration tests
- [ ] Test with Apple Calendar, Thunderbird
- [ ] Document setup flow

**Files to Create**:
- \`src/app/api/wellknown/caldav.rs\`
- \`src/app/api/wellknown/carddav.rs\`
- \`src/app/api/wellknown/mod.rs\`

**Estimated Effort**: 2 days

**Acceptance Criteria**:
- [ ] Well-known endpoints return correct responses
- [ ] Clients can auto-discover
- [ ] Integration tests pass
- [ ] Real clients connect successfully

Part of #$PHASE9_EPIC" \
    "phase-9,P1,discovery,rfc-compliance"

sleep 1

create_issue \
    "Add principal collection resources and properties" \
    "Create principal resource endpoints and properties for discovery flow.

**Current State**: No principal resources exist

**RFC Requirement**: RFC 5397, RFC 4791 §6.2.1, RFC 6352 §7.1.1

**Tasks**:
- [ ] Define principal URL structure
  - \`/principals/users/{username}/\`
  - \`/principals/groups/{groupname}/\`
  - \`/principals/public/\`
- [ ] Add principal collection routes
- [ ] Implement PROPFIND on principal resources
- [ ] Add \`CALDAV:calendar-home-set\` property
- [ ] Add \`CARDDAV:addressbook-home-set\` property
- [ ] Add \`DAV:current-user-principal\` property (Phase 8 dependency)
- [ ] Add principal displayname
- [ ] Add integration tests
- [ ] Test discovery flow with clients

**Files to Create**:
- \`src/app/api/principal/mod.rs\`
- \`src/app/api/principal/user.rs\`
- \`src/app/api/principal/group.rs\`

**Estimated Effort**: 3-5 days

**Acceptance Criteria**:
- [ ] Principal resources accessible
- [ ] Properties return correct values
- [ ] Discovery flow works end-to-end
- [ ] Integration tests pass
- [ ] Clients can auto-configure

Part of #$PHASE9_EPIC" \
    "phase-9,P1,discovery,principals"

sleep 1

create_issue \
    "Comprehensive client compatibility testing and fixes" \
    "Test Shuriken with real CalDAV/CardDAV clients and fix compatibility issues.

**Current State**: Not tested with real clients

**Tasks**:
- [ ] Set up test accounts in Apple Calendar
  - Test discovery flow
  - Test CRUD operations (create, edit, delete events)
  - Test recurring events
  - Test sync behavior
  - Capture HTTP requests with mitmproxy
  - Fix identified issues
- [ ] Set up test accounts in Thunderbird
  - Test CalDAV and CardDAV
  - Test full workflow
  - Capture requests
  - Fix identified issues
- [ ] Test with iOS Calendar app
- [ ] Test with Android clients (DAVx⁵)
- [ ] Document client-specific quirks
- [ ] Add compatibility shims as needed
- [ ] Update documentation with tested clients

**Estimated Effort**: 2-3 weeks

**Acceptance Criteria**:
- [ ] Apple Calendar works completely
- [ ] Thunderbird works for CalDAV and CardDAV
- [ ] iOS Calendar works
- [ ] At least one Android client works
- [ ] Compatibility issues documented
- [ ] Quirks handled in code

Part of #$PHASE9_EPIC" \
    "phase-9,P1,testing,compatibility"

sleep 1

create_issue \
    "Optimize query performance and add benchmarks" \
    "Optimize database queries and add performance benchmarks.

**Current State**: No performance benchmarks or optimization

**Tasks**:
- [ ] Identify N+1 query patterns
  - Audit handlers for loops fetching resources
  - Use batch queries with JOINs
- [ ] Add compound indexes for common patterns
- [ ] Analyze slow query logs
- [ ] Add query logging with execution times
- [ ] Use EXPLAIN ANALYZE for slow queries
- [ ] Set performance targets
  - calendar-query: <500ms for 1000 events
  - sync-collection: <200ms for <100 changes
  - PROPFIND Depth:1: <300ms for 50 children
  - PUT: <200ms for typical event
- [ ] Add performance benchmarks
- [ ] Load test with realistic data
- [ ] Set up monitoring (Prometheus/Grafana)
- [ ] Document performance characteristics

**Estimated Effort**: 1-2 weeks

**Acceptance Criteria**:
- [ ] Performance targets met
- [ ] Benchmarks added
- [ ] Slow queries optimized
- [ ] Monitoring set up
- [ ] Performance documented

Part of #$PHASE9_EPIC" \
    "phase-9,P2,performance"

sleep 1

create_issue \
    "Add end-to-end integration tests and failure path coverage" \
    "Create comprehensive integration test suite covering end-to-end scenarios and failure paths.

**Current State**: Tests exist for individual methods but no end-to-end scenarios

**Tasks**:
- [ ] Create end-to-end test scenarios
  - Full discovery flow (well-known → principal → home → calendars)
  - Create calendar → PUT event → query → sync
  - Recurring event workflow (PUT RRULE → time-range query → expand)
  - Sharing workflow
- [ ] Add failure path coverage
  - Invalid iCal/vCard syntax errors
  - Unsupported report errors
  - Precondition failures (If-Match, UID conflicts)
  - Authorization failures (403, insufficient privileges)
- [ ] Create quirk suite from real client requests
  - Capture with mitmproxy
  - Save as test fixtures
  - Replay tests for compatibility
- [ ] Improve test organization
- [ ] Add test documentation

**Files to Create**:
- \`tests/e2e/discovery.rs\`
- \`tests/e2e/workflows.rs\`
- \`tests/e2e/failures.rs\`
- \`tests/fixtures/\` (client request fixtures)

**Estimated Effort**: 1-2 weeks

**Acceptance Criteria**:
- [ ] End-to-end scenarios pass
- [ ] Failure paths covered
- [ ] Test coverage >80%
- [ ] Client compatibility verified via tests
- [ ] Tests documented

Part of #$PHASE9_EPIC" \
    "phase-9,P2,testing"

echo ""
echo "=== Issue Creation Complete ==="
echo ""
echo "All GitHub issues have been created successfully!"
echo "Please review the issues at: https://github.com/$REPO/issues"
echo ""
echo "Next steps:"
echo "1. Review and organize issues on GitHub project board"
echo "2. Assign issues to team members"
echo "3. Set milestones for each phase"
echo "4. Remember to link issues in future PRs using keywords like 'Fixes #123'"
echo ""
echo "See GITHUB_ISSUES.md for complete reference documentation."
