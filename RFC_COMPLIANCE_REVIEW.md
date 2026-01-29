# Shuriken RFC Compliance Review

**Date**: January 29, 2026  
**Project**: Shuriken CalDAV/CardDAV Server  
**Scope**: Comprehensive RFC compliance assessment across all major modules

---

## Executive Summary

Shuriken demonstrates **65-75% overall RFC compliance** with solid architectural foundations but significant gaps in protocol-level features, primarily around ACL management and error handling specifics.

**Key Findings:**
- ✅ Strong: Database design, component parsing, core HTTP methods, entity storage
- ⚠️ Moderate: Query filtering, property discovery, authorization enforcement
- 🔴 Critical: ACL protocol layer, LOCK/UNLOCK (advertised but missing), scheduling

---

## 1. CalDAV (RFC 4791) - ~75% Compliant

### ✅ Correctly Implemented

| Feature | Status | Notes |
|---------|--------|-------|
| VEVENT/VTODO/VJOURNAL handling | ✅ | Full parsing and component indexing |
| RRULE expansion | ✅ | Full RRULE support with occurrence caching |
| ETag generation | ✅ | Content-based, RFC 4918 compliant |
| Sync token infrastructure | ✅ | Monotonic per-collection tokens |
| MKCALENDAR | ✅ | With resource type and properties |
| PROPFIND | ✅ | Depth support, live properties |
| calendar-query REPORT | ✅ | Basic structure, UID filtering |
| calendar-multiget REPORT | ✅ | Batch retrieval |
| sync-collection REPORT | ✅ | Infrastructure complete, basic logic |
| VTIMEZONE component | ✅ | Parsing, IANA mapping, DST handling |
| calendar-data filtering | ⚠️ | Parser exists, reconstruction missing |

### ⚠️ Partially Implemented

| Feature | Gap | Impact |
|---------|-----|--------|
| sync-collection validation | No baseline token retention window checking | Clients may sync incorrectly |
| expand-property REPORT | Hardcoded stubs, no database backing | ACL/principal discovery broken |
| Calendar properties | Missing: `supported-calendar-component-set`, `max-resource-size`, color | Limited discovery |
| Partial retrieval (calendar-data filtering) | Cannot return property subset | Bandwidth waste |
| Text-match on arbitrary properties | Works only on indexed properties | Limited query capability |
| Precondition errors | Missing XML elements for unsupported components | Clients can't distinguish errors |

### 🔴 Not Implemented

| Feature | RFC | Phase | Priority |
|---------|-----|-------|----------|
| free-busy-query REPORT | RFC 4791 §7.10 | Phase 7 | High |
| CalDAV Scheduling (iTIP) | RFC 6638 | Phase 7+ | High |
| Well-Known URIs (.well-known/caldav) | RFC 6764 | Phase 9 | Medium |
| TZID validation | RFC 5545 | - | Medium |

### Recommendations

1. **Immediate**: Implement `supported-calendar-component-set` property
2. **Immediate**: Add RFC 4791 §9 precondition error XML responses
3. **Short-term**: Implement text-match filtering on all properties
4. **Short-term**: Add sync-token retention window validation
5. **Medium-term**: Implement free-busy-query REPORT
6. **Future**: Implement CalDAV Scheduling (RFC 6638)

---

## 2. CardDAV (RFC 6352) - ~65% Compliant

### ✅ Correctly Implemented

| Feature | Status | Notes |
|---------|--------|-------|
| REPORT methods | ✅ | addressbook-query, addressbook-multiget, sync-collection |
| Filter architecture | ✅ | Property filters, parameter filters, text-match modes |
| Indexed queries | ✅ | EMAIL, TEL, FN, N, ORG with full-text search |
| vCard parsing | ✅ | RFC 6350 (v4.0) and RFC 2426 (v3.0) support |
| ETag handling | ✅ | Strong ETags, conditional requests |
| Sync token | ✅ | Monotonic, RFC 6578 compatible |
| Extended MKCOL | ✅ | RFC 5689, initial properties |
| OPTIONS discovery | ✅ | DAV header, addressbook-access capability |
| Preconditions | ✅ | Full set defined in codebase |

### ⚠️ Partially Implemented

| Feature | Gap | Impact |
|---------|-----|--------|
| Collation (RFC 4790) | Framework exists, `i;unicode-casemap` not integrated | Case-insensitive matching non-compliant |
| Collection properties in PROPFIND | Properties defined, not verified in responses | Clients can't discover properties |
| DAV:supported-report-set | Not implemented | Clients don't know available reports |
| Address data negotiation | vCard 3.0 default only | No version selection support |
| PUT error response bodies | Returns status codes only | Clients can't distinguish error types |

### 🔴 Not Implemented

| Feature | RFC | Phase | Priority |
|---------|-----|-------|----------|
| Content negotiation (Accept header) | RFC 6352 §5.1.1 | - | Medium |
| COPY/MOVE on address objects | RFC 6352 §6.3.2 | - | Medium |
| Multi-vCard validation | RFC 6352 §5.1 | - | Low |
| Sync token in PROPFIND | RFC 6578 | - | Medium |
| UID handling on MOVE/COPY | RFC 6352 | - | Medium |
| FN/EMAIL text-match queries | RFC 6352 §10.3 | - | High |

### Recommendations

1. **Immediate**: Implement `supported-report-set` property
2. **Immediate**: Return XML error bodies for PUT precondition failures
3. **Short-term**: Integrate `i;unicode-casemap` collation into filter evaluation
4. **Short-term**: Implement content negotiation for GET (Accept header)
5. **Medium-term**: Add text-match filtering for FN, EMAIL, TEL properties
6. **Medium-term**: Implement UID validation on COPY/MOVE operations

---

## 3. Core WebDAV (RFC 4918) - ~70-75% Compliant

### ✅ Correctly Implemented

| Feature | Status | Notes |
|---------|--------|-------|
| OPTIONS | ✅ | Allow/DAV headers, compliance levels |
| GET/HEAD | ✅ | Content-type, conditional requests, ETag |
| PUT | ✅ | Create/update, If-Match/If-None-Match, 201/204 responses |
| DELETE | ✅ | Soft-delete, tombstones, idempotency, If-Match |
| PROPFIND | ✅ | Depth 0/1, allprop, propname, multistatus XML |
| PROPPATCH | ✅ | Set/remove, protected properties, 207 responses |
| MKCOL | ✅ | 201 Created, 409 Conflict, parent validation |
| COPY | ✅ | Destination header, overwrite semantics, 201/204 |
| MOVE | ✅ | Rename, tombstone generation, sync token updates |
| Response codes | ✅ | 201, 204, 207, 304, 400, 403, 404, 409, 412, 500 |
| ETag/Last-Modified | ✅ | Proper generation, RFC 1123 format |
| Depth header | ✅ | Parse, validate (0, 1, infinity) |
| Multistatus XML | ✅ | Namespace handling, per-resource status |
| Collection vs. resource | ✅ | Proper distinction, resourcetype property |

### ⚠️ Partially Implemented / Edge Cases

| Feature | Gap | Impact |
|---------|-----|--------|
| Complex If headers | Only basic If-Match/If-None-Match | Lock tokens not supported |
| Parent existence checks | May not return 409 on missing parent | Spec compliance gap |
| DELETE Depth semantics | Default on collections unclear | Recursive delete behavior ambiguous |
| Overwrite: F validation | Not fully enforced | Clients may fail unexpectedly |
| Class 2 advertising | DAV header claims Class 2 (LOCK/UNLOCK) | **SPEC VIOLATION** - not implemented |
| HEAD optimization | Loads full entity unnecessarily | Performance issue |
| Missing properties | No `creationdate` property | Limited property discovery |

### 🔴 Not Implemented

| Feature | RFC | Issue |
|---------|-----|-------|
| LOCK method | RFC 4918 | ❌ Advertised (Class 2) but not implemented |
| UNLOCK method | RFC 4918 | ❌ Advertised (Class 2) but not implemented |
| Lock-related If headers | RFC 4918 | Not supported |
| DAV:creationdate property | RFC 4918 | Missing |
| Cross-server COPY/MOVE | RFC 4918 §9.8.4 | Not validated |

### Critical Issue: Class 2 Compliance Violation

**Problem**: Shuriken advertises `2` in the DAV header (Class 2 compliance) but does NOT implement LOCK/UNLOCK methods, which are **REQUIRED** for Class 2 compliance per RFC 4918 §18.1.

**Solutions**:
1. **Remove from DAV header** (Recommended for CalDAV/CardDAV - they don't require locking)
2. Implement full LOCK/UNLOCK support

### Recommendations

1. **CRITICAL**: Remove `2` from DAV header in OPTIONS response OR implement LOCK/UNLOCK
2. **Immediate**: Verify 409 Conflict for non-existent parent collections
3. **Immediate**: Add `creationdate` property support
4. **Short-term**: Verify DELETE Depth semantics on collections
5. **Short-term**: Test Overwrite: F precondition enforcement
6. **Short-term**: Optimize HEAD to avoid full entity deserialization

---

## 4. Authentication & Authorization (RFC 3744) - Minimal Profile Recommended

### Current State: ~30-40% RFC 3744 Compliant

**Note**: Full RFC 3744 compliance requires extensive ACL protocol support. A **minimal profile** is recommended for Shuriken.

### ✅ Currently Implemented (Beyond Minimal)

| Feature | Status |
|---------|--------|
| Principal types (user, group) | ✅ |
| Permission hierarchy (7 levels) | ✅ |
| Casbin path-based enforcement | ✅ |
| Principal expansion (users → groups + public) | ✅ |
| Privilege mapping (read, write, owner, etc.) | ✅ |
| Authorization checks in HTTP handlers | ✅ |
| `current-user-privilege-set` property | ✅ (static) |

### 📋 Minimal RFC 3744 Profile Definition

A minimal profile supports:

**Required:**
1. ✅ `DAV:owner` property (read-only for now)
2. ✅ `DAV:acl` property (readonly in PROPFIND, no ACL method yet)
3. ✅ `DAV:current-user-privilege-set` property (computed per request)
4. ✅ `DAV:supported-privilege-set` property (static tree)
5. Principal types: `DAV:href`, `DAV:all`, `DAV:authenticated`, `DAV:unauthenticated`
6. Core privileges: `read`, `write`, `read-acl`, `write-acl`, `unlock`, `bind`, `unbind`
7. Grant-only ACEs (no deny)
8. ACE markers: `protected` (readonly), `inherited` (readonly)
9. `DAV:need-privileges` error element on 403 Forbidden

**Not Necicarily Required for Minimal, but can be implemented:**
- ACL method (for modifying ACLs)
- Deny ACEs
- Invert ACEs
- Property principals (`DAV:property`, `DAV:self`)
- Advanced principals (`DAV:all`, `DAV:authenticated`, `DAV:unauthenticated` - wait, these ARE required)
- ACL precondition errors (conflict detection)
- ACL REPORT methods
- Principal properties (group-member-set, group-membership, etc.)
- ACL-restrictions property
- inherited-acl-set property
- principal-collection-set property
- LOCK/UNLOCK privilege enforcement

### ⚠️ Gaps in Current Implementation

| Feature | Current | Minimal Profile |
|---------|---------|-----------------|
| ACL property retrieval | Partially (static) | ✅ **Must work** |
| Current-user-privilege-set | ✅ Works | ✅ OK |
| ACL method | ❌ Missing | ❌ Not required |
| Deny ACEs | ❌ Missing | ❌ Not required |
| ACE protection markers | ⚠️ Incomplete | ✅ **Must be read-only** |
| Inherited ACE markers | ⚠️ Incomplete | ✅ **Must be read-only** |
| need-privileges error | ⚠️ Minimal | ✅ **Must return on 403** |
| Pseudo-principals | Partial | ✅ **Must support all/authenticated/unauthenticated** |
| ACL-restrictions property | ❌ Missing | ❌ Not required for minimal |
| Replace current 'public' principal with 'authenticated', 'unauthenticated', and 'all' | ❌ Missing | ✅ Required |

### Recommendations for Minimal RFC 3744 Profile

1. **Immediate**: Ensure `DAV:acl` property is readable via PROPFIND
2. **Immediate**: Return `DAV:need-privileges` XML element in 403 Forbidden responses
3. **Immediate**: Support all four ACE principal types: `DAV:href`, `DAV:all`, `DAV:authenticated`, `DAV:unauthenticated`
4. **Short-term**: Ensure `protected` and `inherited` ACE markers are read-only
5. **Do NOT implement**: ACL method, deny ACEs, advanced principal types, ACL preconditions
6. **Note**: LOCK/UNLOCK not required for CalDAV/CardDAV minimal profile

### Removal of LOCK/UNLOCK

**Decision**: Since LOCK/UNLOCK is not required for CalDAV/CardDAV, remove the Class 2 claim from the DAV header.

---

## 5. Database Schema & Storage (RFC 4791/6352/5545/6350) - ~95% Compliant

### ✅ Correctly Implemented

| Requirement | Status | Notes |
|-------------|--------|-------|
| UID uniqueness per collection | ✅ App-level | 409 responses correct |
| UID globally unique | ✅ | Enforced across collections |
| ETag generation | ✅ | Content-based, stable |
| Last-Modified tracking | ✅ | RFC 1123 format, auto-updated |
| Component tree structure | ✅ | Nested VCALENDAR/VEVENT/VCARD |
| Property type preservation | ✅ | Typed columns (TEXT, DATE, DATETIME, etc.) |
| Property parameters | ✅ | Stored separately with ordering |
| Timezone handling | ✅ | VTIMEZONE cached, IANA mapped |
| Recurrence rules | ✅ | RRULE + occurrence expansion cache |
| Soft-delete & tombstones | ✅ | RFC 6578 compliant |
| Sync token monotonicity | ✅ | Atomic per-collection increments |
| Entity/instance separation | ✅ | Enables sharing, RFC compliant |
| Derived indexes | ✅ | Efficient RFC query support |
| Sync token in dav_collection | ✅ | Incremented on all changes |
| Deletion tracking | ✅ | Tombstones preserve paths and UIDs |

### ⚠️ Minor Issues

| Issue | Recommendation |
|-------|-----------------|
| UID constraint is app-level only | Add database-level unique index for atomicity |
| Sync token retention policy undocumented | Document ≥1 week minimum (RFC 6578) |
| Purge strategy not visible | Ensure soft-deleted records cleaned after retention window |

### ✅ Recommended Database Constraint

```sql
CREATE UNIQUE INDEX uq_dav_instance_collection_uid
ON dav_instance(collection_id, logical_uid)
WHERE deleted_at IS NULL AND logical_uid IS NOT NULL;
```

**Benefit**: Atomic UID uniqueness enforcement under concurrent load.

---

## 6. RFC Parsing & Validation - ~65-70% Compliant

### ✅ Correctly Implemented

| Feature | Status | Notes |
|---------|--------|-------|
| iCalendar line folding | ✅ | 75-octet limit, UTF-8 boundaries |
| vCard line folding | ✅ | Proper CRLF + space handling |
| Component structure validation | ✅ | BEGIN/END pairing, nesting |
| Basic value types | ✅ | DATE, DATETIME, DURATION, OFFSET |
| Text escaping | ✅ | iCalendar (\\, \,, \;, \n) and vCard sequences |
| Component kinds | ✅ | VCALENDAR, VEVENT, VTODO, VJOURNAL, VFREEBUSY, VTIMEZONE, VALARM |
| Property parameter parsing | ✅ | Standard parameters, case-insensitive names |
| Namespace handling | ✅ | Quick-xml parsing, DAV/CalDAV/CardDAV namespaces |

### ⚠️ Partially Implemented

| Feature | Gap | Impact |
|---------|-----|--------|
| Required properties | Not enforced | Malformed data accepted (PRODID, UID, DTSTAMP missing) |
| Component cardinality | Not validated | Multiple PRODID/VERSION allowed | 
| Encoding support | BASE64, QUOTED-PRINTABLE missing | Binary properties unusable |
| Structured values | N, ADR components not validated | Malformed data accepted |
| RRULE validation | UNTIL/COUNT mutual exclusivity not checked | Invalid recurrence rules accepted |
| Timezone references | TZID accepted without VTIMEZONE validation | Silent data corruption possible |

### 🔴 Not Implemented

| Feature | Impact |
|---------|--------|
| RFC 6868 parameter unescaping | Parameter values may be incorrect |
| GEO coordinate bounds (-90/+90, -180/+180) | Invalid coordinates accepted |
| EMAIL/TEL format validation | Malformed addresses accepted |
| Timezone database validation | No IANA zone validation |
| LINE-LENGTH validation before folding | May fail on edge cases |

### Recommendations

1. **Immediate**: Add post-parse schema validator for required properties
2. **Immediate**: Enforce component cardinality constraints
3. **Short-term**: Add BASE64/QUOTED-PRINTABLE support
4. **Short-term**: Validate TZID references against VTIMEZONE blocks
5. **Medium-term**: RFC 6868 parameter unescaping
6. **Medium-term**: GEO bounds, EMAIL/TEL format validation

---

## 7. Testing Infrastructure - ~75% Coverage

### ✅ Well-Covered

| Area | Coverage | Tests |
|------|----------|-------|
| HTTP methods | 9/10 | OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE |
| Error conditions | Strong | 409, 412, 404, 403, 400, 500 |
| Authorization | Very strong | 12+ role/permission tests |
| REPORT variants | Strong | calendar-query, multiget, addressbook-query, sync-collection |
| UID uniqueness | ✅ | Conflict detection tested |
| ETags | ✅ | Conditional requests, validation |

### ⚠️ Gaps in Test Coverage

| Area | Gap | Priority |
|------|-----|----------|
| Text-match filtering | Not tested | **High** |
| If-Modified-Since/If-Unmodified-Since | Not tested | Medium |
| expand-property REPORT | Not tested | Medium |
| Concurrent modifications | Not tested | **High** |
| Timezone queries | Not tested | **High** |
| FN/EMAIL queries (CardDAV) | Not tested | **High** |
| Large result sets | Not tested | Medium |
| Character encoding edge cases | Not tested | Medium |
| LOCK/UNLOCK | Not tested | ✅ **OK - not implementing** |

### Recommendations

1. Add text-match query tests (filter evaluation, property matching)
2. Add concurrent modification tests (race conditions, sync-token correctness)
3. Add timezone handling in time-range queries
4. Test expand-property REPORT (if implementing ACL discovery)
5. Add FN/EMAIL text-match tests for CardDAV

---

## Summary Table: RFC Compliance by Component

| Component | RFC(s) | Compliance | Status |
|-----------|--------|-----------|--------|
| **CalDAV** | 4791, 5545, 6578 | ~75% | Good foundation, needs query/property gaps |
| **CardDAV** | 6352, 6350, 6578, 4790 | ~65% | Solid architecture, needs property discovery |
| **WebDAV Core** | 4918, 5689 | ~70% | Strong, but Class 2 violation on LOCK/UNLOCK |
| **Authorization** | 3744 (minimal) | ~40% (minimal) | Minimal profile recommended, no ACL method |
| **Database** | 4791, 6352, 5545, 6350, 6578 | ~95% | Excellent schema design |
| **Parsing** | 5545, 6350, 4918 | ~65-70% | Functional, validation incomplete |
| **Testing** | All | ~75% | Good coverage, needs advanced scenarios |
| **Overall** | Multiple | **~70%** | Solid foundation, protocol gaps remain |

---

## Critical Action Items

### 🔴 Must Fix (Blocking)

1. **Remove LOCK/UNLOCK from DAV header** or implement full support
   - RFC 4918 §18.1: Cannot advertise Class 2 without LOCK/UNLOCK
   - **Decision**: Remove from DAV header (CalDAV/CardDAV don't require it)

2. **Implement `supported-report-set` property** (CalDAV + CardDAV)
   - Required for clients to discover supported REPORT methods
   - Should return XML listing `calendar-query`, `calendar-multiget`, `addressbook-query`, etc.

3. **Return XML error bodies for PUT failures** (CardDAV)
   - Currently: HTTP status codes only
   - Must return: `<C:valid-address-data>`, `<C:no-uid-conflict>`, etc.

4. **Implement `DAV:acl` property retrieval** (RFC 3744 minimal)
   - Make readable via PROPFIND
   - Return current ACL as XML with ACE elements
   - Mark inherited/protected ACEs as read-only

5. **Add `DAV:need-privileges` error element** (RFC 3744 minimal)
   - Include in 403 Forbidden responses
   - Specify which privilege was denied on which resource

### ⚠️ Should Fix (Important)

1. Add `supported-calendar-component-set` property
2. Integrate `i;unicode-casemap` collation into filter evaluation
3. Implement RFC 4791 §9 precondition error XML responses
4. Add database-level UID uniqueness constraint
5. Implement text-match filtering on all properties
6. Add sync-token validation and retention window checking

### 🔧 Nice to Have (Future)

1. Implement free-busy-query REPORT (RFC 4791)
2. Add content negotiation (Accept header) for GET
3. Implement CalDAV Scheduling (RFC 6638) - Phase 7+
4. Add expand-property REPORT for principal discovery
5. Implement ACL method for ACL modification (beyond minimal profile)

---

## Implementation Priority Matrix

| Priority | Item | Effort | Impact | Phase |
|----------|------|--------|--------|-------|
| **P1** | Remove/implement LOCK/UNLOCK | 1h | Critical | Now |
| **P1** | `supported-report-set` property | 4h | High | 1 |
| **P1** | CardDAV error response bodies | 6h | High | 1 |
| **P1** | `DAV:acl` property PROPFIND | 8h | High | 1 |
| **P1** | `DAV:need-privileges` errors | 4h | High | 1 |
| **P2** | `supported-calendar-component-set` | 3h | Medium | 1 |
| **P2** | Collation integration | 8h | Medium | 1 |
| **P2** | RFC 4791 precondition errors | 8h | Medium | 1 |
| **P2** | Database UID constraint | 2h | Medium | 1 |
| **P2** | Text-match query filtering | 12h | High | 1 |
| **P3** | free-busy-query REPORT | 16h | High | 7 |
| **P3** | ACL method implementation | 20h | High | 7+ |
| **P3** | CalDAV Scheduling | 40h+ | Critical | 7+ |

---

## Notes on Minimal RFC 3744 Profile

### What This Means

A **minimal RFC 3744 profile** means Shuriken will:

✅ **Support:**
- Reading ACL information (DAV:acl property via PROPFIND)
- Computing and returning privilege sets (current-user-privilege-set)
- Reporting missing privileges on 403 errors (need-privileges)
- Simple principal types (href, all, authenticated, unauthenticated)
- Grant-only ACEs (no deny logic)
- Marked (but read-only) inherited and protected ACEs

❌ **NOT Support:**
- Modifying ACLs via ACL method
- Deny ACEs or complex grant/deny logic
- Complex principal types (property principals, self, invert)
- ACL precondition error checking (conflict detection)
- ACL REPORT methods
- Full principal property discovery
- Delegation and advanced ACL patterns

### Why This Makes Sense

1. **CalDAV/CardDAV don't strictly require full RFC 3744**
   - Most clients work with simpler permission models
   - Full ACL support adds significant complexity

2. **Shuriken already enforces access control via Casbin**
   - Authorization is working well
   - Adding ACL modification would require managing Casbin policies via HTTP

3. **Clients can still work effectively**
   - They can read permissions (for UI feedback)
   - Server enforces actual access control (Casbin)
   - No one can modify ACLs through CalDAV/CardDAV (acceptable limitation)

4. **Can be extended later**
   - Minimal profile is a good foundation
   - ACL method can be added in future phases

---

## References

- RFC 4791 - CalDAV (Calendar Access Protocol)
- RFC 6352 - CardDAV (vCard Extensions)
- RFC 4918 - WebDAV (Web Distributed Authoring and Versioning)
- RFC 3744 - WebDAV Access Control Protocol
- RFC 5545 - iCalendar Format
- RFC 6350 - vCard Format 4.0
- RFC 5689 - Extended MKCOL
- RFC 6578 - Sync Collection (Incremental Sync)
- RFC 4790 - LDAP Collation (i;unicode-casemap)
- RFC 7232 - HTTP Conditional Requests
- RFC 7231 - HTTP Semantics

---

**Document Version**: 1.0  
**Last Updated**: 2026-01-29  
**Next Review**: After implementation of P1 items
