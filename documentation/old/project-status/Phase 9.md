# Phase 9: Discovery & Polish

**Status**: ❌ **NOT STARTED (0%)**  
**Last Updated**: 2026-01-25

---

## Overview

Phase 9 focuses on service discovery and client compatibility. It implements RFC 6764 well-known URIs (`.well-known/caldav`, `.well-known/carddav`) for auto-configuration, principal discovery properties for client setup, and compatibility quirks for popular clients (Apple Calendar, Google Calendar, Thunderbird). This phase also includes performance optimization and comprehensive integration testing.

**Priority**: HIGH — Auto-discovery is essential for user-friendly setup. Without it, users must manually enter collection URLs.

**Complexity**: MEDIUM — Mostly plumbing work, but client quirks require testing with real clients.

---

## Implementation Status

### ❌ Not Implemented

#### 1. Well-Known URIs (RFC 6764 / RFC 5785)

**Current State**: No well-known URI handlers.

**What's Missing**:

##### `/.well-known/caldav`

**Purpose**: Auto-discovery entry point for CalDAV clients.

**RFC 6764 §6**: Client performs GET/PROPFIND on `https://example.com/.well-known/caldav`.

**Recommended Response Option A (Redirect)**:
```http
HTTP/1.1 301 Moved Permanently
Location: https://example.com/calendars/
```

**Recommended Response Option B (207 Multi-Status)**:
```xml
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>/.well-known/caldav</D:href>
    <D:propstat>
      <D:prop>
        <D:current-user-principal>
          <D:href>/principals/users/{username}/</D:href>
        </D:current-user-principal>
        <C:calendar-home-set>
          <D:href>/calendars/users/{username}/</D:href>
        </C:calendar-home-set>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>
```

**Recommended Implementation**:
1. Add handler: `GET /.well-known/caldav`
2. Return 301 redirect to calendar home (simpler)
3. Alternative: Return 207 with principal/home-set (better for some clients)

**Estimated Effort**: 1 day

##### `/.well-known/carddav`

**Purpose**: Auto-discovery entry point for CardDAV clients.

**RFC 6764 §6**: Client performs GET/PROPFIND on `https://example.com/.well-known/carddav`.

**Recommended Response**: Same as CalDAV but for addressbooks.
```http
HTTP/1.1 301 Moved Permanently
Location: https://example.com/addressbooks/
```

**Recommended Implementation**:
1. Add handler: `GET /.well-known/carddav`
2. Return 301 redirect to addressbook home

**Estimated Effort**: 1 day

---

#### 2. Principal Discovery Flow

**Current State**: No principal discovery properties implemented.

**What's Missing**:

The RFC 5397 / RFC 6764 discovery flow requires clients to:
1. Start at well-known URI
2. Discover current-user-principal
3. Query principal for calendar-home-set / addressbook-home-set
4. Query home set for available collections

**Step 1**: `DAV:current-user-principal` property (Phase 8 dependency)

**Purpose**: Returns authenticated user's principal URL.

**Added in**: Phase 8 ACL properties

**Step 2**: `CALDAV:calendar-home-set` property

**Current State**: ⚠️ Partially implemented in PROPFIND but not tested.

**Purpose**: Returns URL(s) where user's calendars live.

**Example**:
```xml
<C:calendar-home-set xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:href>/calendars/users/alice/</D:href>
</C:calendar-home-set>
```

**Recommended Implementation**:
1. Add to PROPFIND for principal resources
2. Return calendar home URL for principal
3. Verify with real clients (Apple Calendar, Thunderbird)

**Estimated Effort**: 1 day

**Step 3**: `CARDDAV:addressbook-home-set` property

**Current State**: ⚠️ Partially implemented in PROPFIND but not tested.

**Purpose**: Returns URL(s) where user's addressbooks live.

**Example**:
```xml
<C:addressbook-home-set xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:href>/addressbooks/users/alice/</D:href>
</C:addressbook-home-set>
```

**Recommended Implementation**:
1. Add to PROPFIND for principal resources
2. Return addressbook home URL for principal
3. Verify with real clients (Thunderbird)

**Estimated Effort**: 1 day

**Step 4**: Principal URL structure

**Current State**: No principal resources exist.

**Recommended Structure**:
- **Users**: `/principals/users/{username}/`
- **Groups**: `/principals/groups/{groupname}/`
- **System principals**: `/principals/public/`

**Implementation Requirements**:
1. Add principal collection routes
2. Implement PROPFIND on principal resources
3. Return principal properties (displayname, calendar-home-set, etc.)

**Estimated Effort**: 3-5 days

---

#### 3. Collection Discovery

**Current State**: PROPFIND works but not tested with real clients.

**What's Missing**:

##### Depth: 1 PROPFIND on home set

**Purpose**: List available calendars/addressbooks for user.

**Request**:
```http
PROPFIND /calendars/users/alice/ HTTP/1.1
Depth: 1
Content-Type: application/xml

<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:resourcetype/>
    <D:displayname/>
    <D:sync-token/>
    <D:supported-report-set/>
  </D:prop>
</D:propfind>
```

**Expected Response**:
```xml
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>/calendars/users/alice/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/></D:resourcetype>
        <D:displayname>Alice's Calendars</D:displayname>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/calendars/users/alice/work/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype>
          <D:collection/>
          <C:calendar/>
        </D:resourcetype>
        <D:displayname>Work Calendar</D:displayname>
        <D:sync-token>42</D:sync-token>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>
```

**Verification Steps**:
1. Test with Apple Calendar
2. Test with Thunderbird
3. Test with Google Calendar (if supporting)

**Estimated Effort**: 2-3 days (testing)

##### `DAV:supported-report-set` correctness

**Current State**: ⚠️ Advertises reports but not verified.

**Purpose**: Tell clients which REPORT methods are available.

**Critical**: Must advertise EXACTLY what's implemented. Don't "lie" about supported reports.

**Recommended Audit**:
1. Review all advertised reports
2. Remove stubs (e.g., `expand-property` until implemented)
3. Test each advertised report

**Estimated Effort**: 1 day

---

#### 4. Apple/Google Client Compatibility

**Current State**: Not tested with real clients.

**What's Missing**:

##### Apple Calendar Quirks

- [ ] Specific header expectations (e.g., `X-Apple-Calendar-*`)
- [ ] Non-standard properties (`CS:` namespace)
- [ ] Push notification support (optional)
- [ ] Attachment handling quirks

**Recommended Testing**:
1. Set up test account in Apple Calendar
2. Create/edit/delete events
3. Capture HTTP requests with mitmproxy
4. Identify missing properties or error responses
5. Add compatibility shims as needed

**Estimated Effort**: 1 week (testing + fixes)

##### Google Calendar Quirks

- [ ] Sync behavior oddities (Google uses non-standard sync)
- [ ] Rate limiting expectations
- [ ] Non-standard properties

**Note**: Google Calendar may not fully support CalDAV. Focus on Apple and Thunderbird first.

**Estimated Effort**: 1 week (testing + fixes)

##### Thunderbird Quirks

- [ ] CardDAV discovery differences
- [ ] Non-standard vCard properties
- [ ] Sync behavior

**Recommended Testing**:
1. Set up CalDAV and CardDAV accounts in Thunderbird
2. Test full workflow (create, edit, delete, sync)
3. Capture requests and identify issues

**Estimated Effort**: 1 week (testing + fixes)

---

#### 5. Performance Optimization

**Current State**: No performance benchmarks or optimization.

**What's Missing**:

##### Query Optimization

- [ ] N+1 query prevention
  - Identify handlers that fetch resources in loops
  - Use batch queries with JOINs
- [ ] Index tuning
  - Add compound indexes for common query patterns
  - Analyze slow query logs
- [ ] Prepared statement caching
  - Diesel compiles queries at compile-time, but verify execution plans

**Recommended Approach**:
1. Add query logging with execution times
2. Identify slow queries (>100ms)
3. Analyze with `EXPLAIN ANALYZE`
4. Add indexes or rewrite queries

**Estimated Effort**: 1 week

##### Budget/SLA Targets

**Recommended Targets**:
- **calendar-query**: <500ms for 1000 events
- **sync-collection**: <200ms for typical change set (<100 changes)
- **PROPFIND Depth:1**: <300ms for 50 children
- **PUT**: <200ms for typical event

**Measurement**:
1. Add structured logging with timing
2. Set up monitoring (Prometheus/Grafana)
3. Load test with realistic data sets

**Estimated Effort**: 1 week (setup + testing)

---

#### 6. Integration Tests

**Current State**: Integration tests exist for individual methods but no end-to-end scenarios.

**What's Missing**:

##### End-to-End Scenarios

- [ ] Full discovery flow: `.well-known/caldav` → principal → home set → calendars
- [ ] Create calendar → PUT event → calendar-query → sync-collection
- [ ] Recurring event: PUT with RRULE → time-range query → expand
- [ ] Sharing: Share calendar → other user queries → sees shared calendar

**Recommended Approach**:
1. Create `tests/e2e/` directory
2. Use `salvo::test::TestClient` for in-process tests
3. Simulate real client workflows

**Estimated Effort**: 1-2 weeks

##### Failure Path Coverage

- [ ] Invalid iCal/vCard errors (syntax errors, missing required properties)
- [ ] Unsupported report errors (client requests unimplemented report)
- [ ] Precondition failures (If-Match failures, UID conflicts)
- [ ] Authorization failures (403 Forbidden, insufficient privileges)

**Recommended Approach**:
1. Add negative test cases for each handler
2. Verify error responses match RFC requirements
3. Test error message clarity

**Estimated Effort**: 1 week

##### Quirk Suite (Real Client Requests)

- [ ] Capture real client requests with mitmproxy
- [ ] Save as test fixtures
- [ ] Replay tests to ensure compatibility

**Recommended Approach**:
1. Set up mitmproxy between client and server
2. Perform typical workflows
3. Extract requests and save as YAML fixtures
4. Create replay tests

**Estimated Effort**: 1 week

---

## RFC Compliance

| RFC Requirement | Status | Impact |
|-----------------|--------|--------|
| RFC 6764 §6: Well-known CalDAV | ❌ Missing | Clients can't auto-discover |
| RFC 6764 §6: Well-known CardDAV | ❌ Missing | Clients can't auto-discover |
| RFC 5397: current-user-principal | ❌ Missing | No principal discovery (Phase 8) |
| RFC 4791 §6.2.1: calendar-home-set | ⚠️ Partial | Exists but not tested |
| RFC 6352 §7.1.1: addressbook-home-set | ⚠️ Partial | Exists but not tested |

**Compliance Score**: 0/5 features (0%)

---

## Next Steps

### Immediate Priorities

1. **Implement well-known URIs** — HIGH PRIORITY
   - `/.well-known/caldav`
   - `/.well-known/carddav`
   - Estimated effort: 2 days

2. **Implement principal resources** — HIGH PRIORITY
   - `/principals/users/{username}/`
   - Add principal properties (calendar-home-set, addressbook-home-set)
   - Estimated effort: 3-5 days

3. **Test with real clients** — CRITICAL
   - Apple Calendar
   - Thunderbird
   - Fix compatibility issues
   - Estimated effort: 2-3 weeks

### Nice-to-Have

4. **Performance optimization** — MEDIUM PRIORITY
   - Query optimization
   - Load testing
   - Estimated effort: 1-2 weeks

5. **Integration test suite** — MEDIUM PRIORITY
   - End-to-end scenarios
   - Failure path coverage
   - Estimated effort: 1-2 weeks

---

## Client Setup Flow

### Without Discovery (Current State)

1. User must manually enter URLs:
   - Server URL: `https://example.com/`
   - Calendar path: `/calendars/users/alice/personal/`
   - Addressbook path: `/addressbooks/users/alice/contacts/`
2. User must know exact collection paths
3. Error-prone and frustrating

### With Discovery (Goal)

1. User enters only:
   - Server URL: `https://example.com/`
   - Username: `alice`
   - Password: `password`
2. Client performs discovery:
   - GET `/.well-known/caldav`
   - PROPFIND on principal for `calendar-home-set`
   - PROPFIND Depth: 1 on home set to list calendars
3. Client automatically configures accounts

**Impact**: Dramatically improved user experience. Essential for production deployment.

---

## Dependencies

**Blocks**: None — Phase 9 is final polish, doesn't block other features.

**Depends On**: 
- Phase 8 (Authorization Integration) — Needs `current-user-principal` property
- All previous phases — Discovery requires working CalDAV/CardDAV implementation

---

## Post-Phase 9: Production Readiness

After Phase 9, the following areas may need attention for production deployment:

1. **Security Audit** — Penetration testing, vulnerability scanning
2. **Scalability Testing** — Load testing with thousands of users
3. **Backup/Restore** — Data backup strategy, disaster recovery
4. **Monitoring** — Metrics, alerting, log aggregation
5. **Documentation** — Admin guide, API docs, troubleshooting guide
6. **Deployment** — Docker images, Kubernetes manifests, CI/CD pipeline
7. **Migration Tools** — Import from other CalDAV servers (Radicale, Baikal, etc.)

**Estimated Effort**: 4-8 weeks for full production readiness
