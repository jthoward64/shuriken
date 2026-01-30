# Shuriken RFC Compliance Review: Comprehensive Assessment {#executive-summary}

**Date**: January 29, 2026  
**Project**: Shuriken CalDAV/CardDAV Server  
**Scope**: Comprehensive RFC compliance assessment with deep architectural analysis  
**Status**: ✅ Complete with architectural verdict

---

## Executive Summary {#executive-summary-details}

Shuriken demonstrates **70-75% RFC compliance** with **sound architectural foundations** that inherently support RFC requirements. **The architecture is fundamentally correct - NO REDESIGN NEEDED.**

### Key Architectural Strength {#architecture-strength}

The compliance gap is **purely protocol-layer** (missing properties, error responses, discovery mechanisms) rather than storage or architectural design issues. The UUID-based internal architecture with glob-path ACLs creates a robust foundation for compliance.

**Critical Finding**: Shuriken's architectural decisions are fundamentally sound for RFC compliance. The UUID-based storage, entity/instance separation, and component tree structure create a robust foundation. With focused implementation of ~40 hours of protocol-layer code, Shuriken can achieve 85%+ RFC compliance across CalDAV, CardDAV, WebDAV, and ACL.

### Compliance Summary {#compliance-summary}

**Key Findings:**
- ✅ **Architecture**: UUID-based storage, glob paths, component trees, entity/instance separation are all RFC-compliant
- ✅ **Storage Layer**: ~95% compliant - database design properly supports RFC requirements
- ✅ **Architectural Decisions Are Sound**: Design enables RFC compliance without sacrificing flexibility
- ⚠️ **Protocol Layer**: ~65% - missing discovery properties, error response bodies, precondition signaling
- 🔴 **Critical Issues**: ~~DAV header Class 2 violation (LOCK/UNLOCK)~~ ✅ Fixed, ~~missing `supported-report-set` property~~ ✅ Implemented, ~~precondition error XML elements~~ ✅ Implemented for PUT operations

**Path Forward**: 40 hours of additive protocol-layer changes (no redesign needed) to reach 85% compliance.

### Compliance by Component {#compliance-by-component}

| Component | RFC(s) | Compliance | Status |
|-----------|--------|-----------|--------|
| **CalDAV** | 4791, 5545, 6578 | ~75% | Good foundation, needs query/property gaps |
| **CardDAV** | 6352, 6350, 6578, 4790 | ~65% | Solid architecture, needs property discovery |
| **WebDAV Core** | 4918, 5689 | ~70% | Strong, but Class 2 violation on LOCK/UNLOCK |
| **Authorization** | 3744 (minimal) | ~40% (minimal) | Minimal profile recommended, no ACL method |
| **Sync Protocol** | 6578 | ~85% | Strong foundation, needs token validation |
| **Database Schema** | 4791, 6352, 5545, 6350, 6578 | ~95% | Excellent design, minor constraints needed |
| **RFC Parsing** | 5545, 6350, 4918 | ~65-70% | Functional, validation incomplete |
| **Testing** | All | ~75% | Good coverage, needs advanced scenarios |
| **Overall** | Multiple | **~70-75%** | Solid foundation, protocol gaps remain |

---

## Table of Contents {#table-of-contents}

1. [CalDAV (RFC 4791) Compliance](#caldav-compliance)
   - [Core MUST Requirements](#caldav-must-requirements)
   - [Correctly Implemented Features](#caldav-correct)
   - [Partially Implemented Features](#caldav-partial)
   - [Not Implemented Features](#caldav-not-implemented)
   - [Query & Filter Validation](#caldav-query-filter)
   - [Partial Retrieval Implementation](#caldav-partial-retrieval)
   - [Precondition/Postcondition Errors](#caldav-preconditions)
   - [Recommendations](#caldav-recommendations)

2. [CardDAV (RFC 6352) Compliance](#carddav-compliance)
   - [Core MUST Requirements](#carddav-must-requirements)
   - [Correctly Implemented Features](#carddav-correct)
   - [Partially Implemented Features](#carddav-partial)
   - [Not Implemented Features](#carddav-not-implemented)
   - [Precondition/Postcondition Errors](#carddav-preconditions)
   - [Recommendations](#carddav-recommendations)

3. [Core WebDAV (RFC 4918) Compliance](#webdav-compliance)
   - [WebDAV Compliance Classes](#webdav-classes)
   - [Core MUST Requirements](#webdav-must-requirements)
   - [Correctly Implemented Features](#webdav-correct)
   - [Partially Implemented Features](#webdav-partial)
   - [Not Implemented Features](#webdav-not-implemented)
   - [Critical Issue: Class 2 Compliance Violation](#webdav-class2-violation)
   - [Recommendations](#webdav-recommendations)

4. [Authentication & Authorization (RFC 3744) Compliance](#auth-compliance)
   - [Core MUST Requirements](#auth-must-requirements)
   - [Minimal RFC 3744 Profile Definition](#auth-minimal-profile)
   - [Current Implementation Status](#auth-current)
   - [Gaps in Minimal Profile](#auth-gaps)
   - [ACL Evaluation](#auth-evaluation)
   - [Why Minimal Profile for Shuriken](#auth-why-minimal)
   - [Recommendations](#auth-recommendations)

5. [Sync Collection (RFC 6578) Compliance](#sync-compliance)
   - [Core MUST Requirements](#sync-must-requirements)
   - [Correctly Implemented Features](#sync-correct)
   - [Partially Implemented Features](#sync-partial)
   - [Recommendations](#sync-recommendations)

6. [Database Schema & Storage Compliance](#database-compliance)
   - [Correctly Implemented Features](#database-correct)
   - [Minor Issues](#database-issues)
   - [Recommendations](#database-recommendations)

7. [RFC Parsing & Validation](#parsing-compliance)
   - [Correctly Implemented Features](#parsing-correct)
   - [Partially Implemented Features](#parsing-partial)
   - [Not Implemented Features](#parsing-not-implemented)
   - [Recommendations](#parsing-recommendations)

8. [Testing Infrastructure](#testing-infrastructure)
   - [Well-Covered Areas](#testing-covered)
   - [Gaps in Test Coverage](#testing-gaps)
   - [Recommendations](#testing-recommendations)

9. [Architectural Impact Analysis](#architectural-analysis)
   - [Overview: Strengths of Current Architecture](#architectural-strengths)
   - [UUID-Based Internal Storage vs RFC Path Requirements](#uuid-architecture)
   - [Glob-Path ACL Model vs Individual Resource ACLs](#glob-acl-architecture)
   - [Component Tree Structure](#component-tree-architecture)
   - [Entity/Instance Separation](#entity-instance-architecture)
   - [Application Structure](#application-structure)
   - [Protocol-Layer Gaps (Not Architectural)](#protocol-gaps)

10. [Risk Assessment](#risk-assessment)
    - [Architectural Gaps: NONE](#risk-architectural)
    - [Protocol Gaps: MODERATE](#risk-protocol)
    - [Path Forward](#risk-path-forward)

11. [Missing RFC Requirements - Deep Dive](#missing-requirements)
    - [RFC 4791 (CalDAV) Missed Requirements](#missing-caldav)
    - [RFC 6352 (CardDAV) Missed Requirements](#missing-carddav)
    - [RFC 3744 (ACL) Missed Requirements](#missing-acl)
    - [RFC 4918 (WebDAV) Class Violation](#missing-webdav)
    - [RFC 5545 (iCalendar) Parsing Gaps](#missing-icalendar)
    - [RFC 6350 (vCard) Parsing Gaps](#missing-vcard)

12. [Protocol Layer vs Storage Layer Analysis](#protocol-vs-storage)
    - [What's Strong (Storage Layer)](#storage-strong)
    - [What's Broken (Protocol Layer)](#storage-broken)
    - [No Design Issues](#storage-no-issues)

13. [Critical Action Items](#critical-action-items)
    - [Must Fix (Blocking)](#action-must-fix)
    - [Should Fix (Important)](#action-should-fix)
    - [Nice to Have (Future)](#action-nice-to-have)

14. [Implementation Priority Matrix](#priority-matrix)

15. [Implementation Roadmap](#implementation-roadmap)
    - [Phase 0: Critical Fixes (1 Day)](#roadmap-phase0)
    - [Phase 1: Discovery & Errors (1 Week)](#roadmap-phase1)
    - [Phase 2: Query Improvements (2 Weeks)](#roadmap-phase2)
    - [Phase 3: Advanced Features (Future)](#roadmap-phase3)

16. [Detailed Implementation Guide](#implementation-guide)
    - [P0 Actions (This Sprint)](#implementation-p0)
    - [P1 Actions (Next Sprint)](#implementation-p1)

17. [Specific RFC Requirements Matrix](#requirements-matrix)
    - [RFC 4791 Requirements](#requirements-caldav)
    - [RFC 3744 Minimal Profile Requirements](#requirements-acl)

18. [References](#references)

---

## 1. CalDAV (RFC 4791) - ~75% Compliant {#caldav-compliance}

### RFC 4791 Core MUST Requirements {#caldav-must-requirements}

**To advertise CalDAV support, a server MUST:**
1. ✅ Support iCalendar (RFC 2445/5545) as media type
2. ⚠️ Support WebDAV Class 1 (RFC 4918) - actually should be Class 3 per RFC 4791 if supporting all features
3. ✅ Support WebDAV ACL (RFC 3744) - via Casbin
4. ⚠️ Support TLS transport (RFC 2818) - configuration/deployment concern
5. ✅ Support ETags (RFC 2616) with specific requirements (§5.3.4)
6. ✅ Support all calendaring reports (§7) - most implemented
7. ✅ Advertise `DAV:supported-report-set` property - **COMPLETE** (2026-01-29)

**SHOULD support:**
- ✅ MKCALENDAR method

### ✅ Correctly Implemented {#caldav-correct}

| Feature | Status | Notes | RFC Ref |
|---------|--------|-------|---------|
| VEVENT/VTODO/VJOURNAL handling | ✅ | Full parsing and component indexing | 4.1 |
| UID uniqueness per collection | ✅ | Enforced, returns proper 409 | 4.1 |
| Single component type per resource | ✅ | VTIMEZONE excepted per spec | 4.1 |
| No METHOD property in collections | ✅ | Enforced | 4.1 |
| RRULE expansion | ✅ | Full RRULE support with occurrence caching | 3.2 |
| ETag generation | ✅ | Content-based, RFC 4918 compliant | 5.3.4 |
| Sync token infrastructure | ✅ | Monotonic per-collection tokens | 3.2 |
| Calendar collection resourcetype | ✅ | Reports CALDAV:calendar element | 4.2 |
| Collection membership restrictions | ✅ | No non-calendar resources at top level | 4.2 |
| Collection nesting restrictions | ✅ | No nested calendar collections | 4.2 |
| MKCALENDAR method | ✅ | With resource type and properties | 5.3.1 |
| PROPFIND | ✅ | Depth support, live properties | 9.1 |
| calendar-query REPORT | ✅ | Basic structure, UID filtering, time-range | 7.8 |
| calendar-multiget REPORT | ✅ | Full implementation with slug-based lookup and calendar-data | 7.9 |
| sync-collection REPORT | ✅ | Infrastructure complete, basic logic | RFC 6578 |
| VTIMEZONE component | ✅ | Parsing, IANA mapping, DST handling | 7.3 |
| Date/floating time handling | ✅ | Per §7.3 | 7.3 |
| Time-range filtering | ✅ | On indexed components | 7.4 |
| calendar-data filtering | ⚠️ | Parser exists, reconstruction missing | 7.6 |
| iCalendar parser compliance | ✅ | Line folding, escaping, component structure | RFC 5545 |

### ⚠️ Partially Implemented {#caldav-partial}

| Feature | Gap | RFC Ref | Impact |
|---------|-----|---------|--------|
| `DAV:supported-report-set` | ✅ Implemented on all collections | RFC 3253 via 4791 | Clients can discover calendar-query, calendar-multiget, sync-collection |
| `CALDAV:supported-calendar-component-set` | Missing | 5.2.3 | Clients can't know if server supports VEVENT/VTODO |
| `CALDAV:supported-calendar-data` | Missing | 5.2.4 | Clients can't know media type support |
| `CALDAV:max-resource-size` | Missing | 5.2.5 | Clients can't know size limits |
| `CALDAV:min-date-time` | Missing | 5.2.6 | Clients don't know query range limits |
| `CALDAV:max-date-time` | Missing | 5.2.7 | Clients don't know query range limits |
| `CALDAV:max-instances` | Missing | 5.2.8 | Recurring event expansion limits unknown |
| `CALDAV:max-attendees-per-instance` | Missing | 5.2.9 | Attendee limits unknown |
| `CALDAV:supported-collation-set` | Missing | 7.5.1 | Collation support undiscoverable |
| sync-collection validation | No baseline token retention window | RFC 6578 | Clients may sync incorrectly with stale tokens |
| expand-property REPORT | Hardcoded stubs, no database | RFC 3253 §3.8 | ACL/principal discovery broken |
| Partial retrieval (calendar-data) | Cannot reconstruct filtered properties | 7.6, 9.6 | Full data returned; bandwidth waste |
| Text-match collation | Works but not integrated into filters | 7.5, 9.7.5 | Only exact matches work |
| Precondition errors | Missing specific XML elements | §1.3, 9 | No `<C:supported-calendar-component>`, `<C:supported-calendar-data>`, `<C:valid-calendar-data>` |

### 🔴 Not Implemented {#caldav-not-implemented}

| Feature | RFC | Issue | Phase |
|---------|-----|-------|-------|
| free-busy-query REPORT | 7.10 | No FREEBUSY query endpoint | Phase 7 |
| CalDAV Scheduling (iTIP) | RFC 6638 | No ORGANIZER/ATTENDEE handling, no implicit scheduling | Phase 7+ |
| Well-Known URIs | RFC 6764 | No `/.well-known/caldav` or `/.well-known/carddav` | Phase 9 |
| CALDAV:read-free-busy privilege | 6.1 | Not defined in privilege model | Phase 7 |
| CALDAV:calendar-home-set property | 6.2.1 | Not discoverable for principals | Future |
| Non-standard component support | 5.3.3 | Rejected per RFC; may need extension | Future |
| Partial RRULE expansion limits | 9.6.7 (`limit-freebusy-set`) | No client-side RRULE expansion control | Future |

### Query & Filter Validation: The Silent Compliance Killer {#caldav-query-filter}

**RFC 4791 §7 & §9.7 Missing Requirements:**

#### ❌ CRITICAL: Unsupported Filter Signaling

RFC 4791 §7.7 states: "Servers MUST fail with the CALDAV:supported-filter precondition if a calendaring REPORT request uses a CALDAV:comp-filter, CALDAV:prop-filter, or CALDAV:param-filter XML element that makes reference to a non-standard component, property, or parameter name on which the server does not support queries."

**Current State in Shuriken**: 
- ✅ Can parse filter requests
- ✅ Can execute basic filters (time-range, comp-filter, UID)
- ❌ No validation that filter is supported
- ❌ No `<C:supported-filter>` error response
- ❌ Will silently return empty results instead of 403 Forbidden

**Example - Missed Scenario**:
```xml
<C:calendar-query>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:prop-filter name="X-CUSTOM-PROP">
          <!-- Server doesn't support X-CUSTOM-PROP filtering -->
          <C:text-match>value</C:text-match>
        </C:prop-filter>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>

<!-- Current: Returns 207 with empty results -->
<!-- RFC Compliant: Returns 403 with: -->
<D:error>
  <C:supported-filter>
    <C:prop-filter name="X-CUSTOM-PROP"/>
  </C:supported-filter>
</D:error>
```

**RFC Impact**: HIGH - Affects all REPORT methods  
**Architectural Solution**: Add filter capability registry, validate before execution

#### ❌ Text-Match Collation Enforcement

RFC 4791 §7.5.1 states: "Any XML attribute specifying a collation MUST specify a collation supported by the server as described in Section 7.5"

**Current State**:
- ✅ Parses `collation` attribute
- ⚠️ Accepts but doesn't validate against `supported-collation-set`
- ❌ No precondition error for unsupported collation
- ⚠️ Implements collation semantics locally (case-folding works, but not standardized)

**Missing**:
```xml
<!-- This should fail with CALDAV:supported-collation precondition -->
<C:text-match collation="i;unsupported-collation">search-text</C:text-match>
```

**RFC Impact**: MEDIUM - CardDAV §8.3 has same requirement for `i;unicode-casemap`

#### ❌ Supported-Filter Property Discovery

RFC 4791 §7.7 states: "Servers SHOULD report the CALDAV:comp-filter, CALDAV:prop-filter, or CALDAV:param-filter for which it does not provide support [in error response]"

**Example XML Response**:
```xml
<!-- Client should be able to discover this -->
<C:supported-filter xmlns:C="urn:ietf:params:xml:ns:caldav">
  <C:comp-filter name="VCALENDAR">
    <C:comp-filter name="VEVENT">
      <C:prop-filter name="SUMMARY"/>
      <C:prop-filter name="DTSTART"/>
      <C:prop-filter name="DTEND"/>
      <!-- No prop-filter for X-CUSTOM-PROP -->
    </C:comp-filter>
  </C:comp-filter>
</C:supported-filter>
```

**Not Implemented**: Would be in error response or PROPFIND property

### Partial Retrieval Implementation {#caldav-partial-retrieval}

**RFC 4791 §7.6 & §9.6 - Partial Retrieval Semantics:**

RFC 4791 states: "A CalDAV client can request particular WebDAV property values, all WebDAV property values, or a list of the names of the resource's WebDAV properties. A CalDAV client can also request calendar data to be returned and specify whether all calendar components and properties should be returned, or only particular ones."

**Current State in Shuriken**: 
- ✅ Parses `<C:calendar-data>` with `<C:comp>` and `<C:prop>` selectors
- ✅ Stores component tree in database
- ⚠️ **RECONSTRUCTION FROM TREE IS INCOMPLETE**
- ❌ Cannot reconstruct filtered iCalendar with only selected properties
- ❌ Cannot exclude nested components from output

**Current Implementation Gap**:
```rust
// From src/component/db/query/report_property.rs
async fn load_calendar_data(
    conn: &mut DbConnection<'_>,
    instance: &DavInstance,
    prop_name: &PropertyName,
) -> anyhow::Result<Option<String>> {
    let tree = entity::get_entity_with_tree(conn, instance.entity_id).await?;
    let data = serialize_ical_tree(tree)?;  // ← Full serialization
    
    if let Some(request) = prop_name.calendar_data_request() {
        let filtered = filter_calendar_data(&data, request)?;  // ← Post-hoc filtering
        Ok(Some(filtered))
    } else {
        Ok(Some(data))
    }
}
```

**The Problem**:
- Currently: Serialize FULL iCalendar → Parse again → Filter
- Should be: Traverse component tree → Selectively serialize only requested components/properties

**Example Missed Scenario**:
```xml
<!-- Client requests only VEVENT with SUMMARY and DTSTART -->
<C:calendar-data>
  <C:comp name="VCALENDAR">
    <C:prop name="VERSION"/>
    <C:comp name="VEVENT">
      <C:prop name="SUMMARY"/>
      <C:prop name="DTSTART"/>
      <!-- Note: not requesting DTEND, DESCRIPTION, ALARM, etc. -->
    </C:comp>
  </C:comp>
</C:calendar-data>

<!-- Current: Returns ALL properties of VEVENT
     RFC Compliant: Returns ONLY VERSION, SUMMARY, DTSTART -->
```

**Architectural Impact**: Component tree is perfect for this - just need selective serialization  
**Effort**: Medium - requires component-aware filter + selective serialization

#### Expansion vs Limit-Recurrence-Set Semantics

RFC 4791 §7.6 & §9.6.5/9.6.6 defines two modes:

**expand mode**: "A CalDAV client with no support for recurrence properties can request to receive only the recurrence instances that overlap a specified time range as separate calendar components that each define exactly one recurrence instance"

**limit-recurrence-set mode**: "A CalDAV client that is only interested in the recurrence instances that overlap a specified time range can request to receive only the 'master component', along with the 'overridden components' that impact the specified time range"

**Current State**: 
- ✅ Supports expansion mode (returns expanded occurrences)
- ✅ Supports limit mode (returns master + overrides)
- ❌ **Semantic Differences Not Enforced**

**The RFC Semantics**:

| Mode | Returns | RRULE Present? | USE CASE |
|------|---------|---|----------|
| `expand` | Each occurrence as separate VEVENT | **NO** | Clients that don't understand recurrence |
| `limit-recurrence-set` | Master event + exception instances | **YES** | Smart clients that expand locally |

**Current Issue**: Both modes implemented, but not validating that expanded mode removes RRULE

**RFC Impact**: MEDIUM - Edge case for old/limited clients

### Precondition/Postcondition Errors - MISSING IMPLEMENTATION {#caldav-preconditions}

Per RFC 4791 §1.3, when preconditions fail, server MUST return specific XML elements as children of `DAV:error`:

**Missing:**
- `<CALDAV:supported-calendar-component>` (409) - §5.3.2.1 for unsupported component types
- `<CALDAV:supported-calendar-data>` (403) - §5.3.2.1 for unsupported media types
- `<CALDAV:valid-calendar-data>` (403) - §5.3.2.1 for invalid iCalendar
- `<CALDAV:valid-calendar-object-resource>` (409) - §5.3.2.1 when UID conflict
- `<CALDAV:no-uid-conflict>` (409) - When creating/updating events with duplicate UID

### Recommendations (Priority Order) {#caldav-recommendations}

1. ✅ **Implemented**: `DAV:supported-report-set` on all calendar collections and resources (2026-01-29)
2. **P1 (Critical)**: Add precondition error XML responses (5 missing elements)
3. **P1 (High)**: Implement `CALDAV:supported-calendar-component-set` property
4. **P1 (High)**: Implement `CALDAV:supported-calendar-data` property
5. **P1 (High)**: Validate CALDAV:supported-filter on REPORT requests
6. **P2 (Medium)**: Add `CALDAV:max-resource-size`, `min-date-time`, `max-date-time` properties
7. **P2 (Medium)**: Implement text-match collation integration
8. **P2 (Medium)**: Add sync-token retention window validation (RFC 6578 minimum 1 week)
9. **P2 (Medium)**: Implement selective iCalendar serialization from component tree
10. **P3 (Lower)**: Implement partial calendar-data retrieval (property filtering)
11. **P3 (Future)**: Implement free-busy-query REPORT (Phase 7)
12. **P3 (Future)**: Implement CalDAV Scheduling (Phase 7+)

---

## 2. CardDAV (RFC 6352) - ~65% Compliant {#carddav-compliance}

### RFC 6352 Core MUST Requirements {#carddav-must-requirements}

**To advertise CardDAV support, a server MUST:**
1. ✅ Support vCard v3 (RFC 2426) as media type
2. ⚠️ Support WebDAV Class 3 (RFC 4918) - missing LOCK/UNLOCK (Class 2)
3. ✅ Support WebDAV ACL (RFC 3744)
4. ⚠️ Support TLS with proper certificate validation
5. ✅ Support ETags (RFC 2616) with specific requirements (§6.3.2.3)
6. ✅ Support all address book reports (§8) - most implemented
7. ⚠️ Advertise `DAV:supported-report-set` property - **MISSING**

**SHOULD support:**
- ⚠️ vCard v4 (RFC 6350)
- ✅ Extended MKCOL (RFC 5689)
- ⚠️ DAV:current-user-principal-URL (RFC 5397)

### ✅ Correctly Implemented {#carddav-correct}

| Feature | Status | Notes | RFC Ref |
|---------|--------|-------|---------|
| Single vCard per resource | ✅ | One vCard component only | 5.1 |
| UID uniqueness per collection | ✅ | Enforced, returns 409 conflict | 5.1 |
| Address object resourcetype | ✅ | Reports CARDDAV:addressbook element | 5.2 |
| Collection membership restrictions | ✅ | Only address objects at top level | 5.2 |
| Collection nesting restrictions | ✅ | No nested address book collections | 5.2 |
| Extended MKCOL support | ✅ | RFC 5689, initial properties | 6.3.1 |
| REPORT methods | ✅ | addressbook-query (full), addressbook-multiget (full with slug-based lookup) | 8.6, 8.7 |
| Filter architecture | ✅ | Property, parameter, text-match filters | 10.5 |
| Indexed queries | ✅ | EMAIL, TEL, FN, N, ORG with full-text | 8.6 |
| vCard parsing | ✅ | RFC 6350 (v4.0) and RFC 2426 (v3.0) | 5.1 |
| ETag handling | ✅ | Strong ETags, conditional requests | 6.3.2.3 |
| Sync token | ✅ | Monotonic, RFC 6578 compatible | RFC 6578 |
| sync-collection REPORT | ✅ | Basic sync functionality | RFC 6578 |
| OPTIONS discovery | ✅ | DAV header, addressbook-access capability | 6.1 |

### ⚠️ Partially Implemented {#carddav-partial}

| Feature | Gap | RFC Ref | Impact |
|---------|-----|---------|--------|
| `DAV:supported-report-set` | ✅ Implemented on all collections | RFC 3253 via 6352 | Clients can discover addressbook-query, addressbook-multiget, sync-collection |
| `CARDDAV:supported-address-data` | Missing | 6.2.2 | Clients can't know vCard version support (v3 vs v4) |
| `CARDDAV:addressbook-description` | Defined, property support unclear | 6.2.1 | Clients can't discover collection purpose |
| `CARDDAV:max-resource-size` | Missing | 6.2.3 | Clients can't know size limits |
| `CARDDAV:addressbook-home-set` | Missing for principals | 7.1.1 | Clients can't discover addressbook locations |
| `CARDDAV:principal-address` | Missing for principals | 7.1.2 | Cannot associate principal with vCard |
| `CARDDAV:supported-collation-set` | Missing | 8.3.1 | Collation support undiscoverable |
| Collation integration (RFC 4790) | Framework exists, `i;unicode-casemap` not used | 8.3 | Case-insensitive matching non-compliant |
| Content negotiation (Accept header) | Missing GET support for version negotiation | 5.1.1 | Can't request specific vCard version |
| GET precondition | `CARDDAV:supported-address-data-conversion` missing | 5.1.1.1 | Media type errors not specific |
| PUT error response bodies | Returns status codes only, no XML | 6.3.2.1 | No `<C:valid-address-data>`, `<C:no-uid-conflict>` |
| COPY/MOVE preconditions | Not fully validated | 6.3.2.1 | UID conflict handling incomplete |
| Property filters in queries | TEXT-MATCH not on all properties | 8.6, 10.5.4 | FN/EMAIL/TEL queries limited |
| Partial retrieval (address-data) | Cannot return property subset | 8.4, 10.4 | Full vCard data always returned |
| Query result limits | Framework exists but enforcement unclear | 8.6.1 | CARDDAV:nresults handling incomplete |
| Query truncation signaling | Not implemented | 8.6.2 | Clients don't know results are truncated |

### 🔴 Not Implemented {#carddav-not-implemented}

| Feature | RFC | Issue | Phase |
|---------|-----|-------|-------|
| Content negotiation response header | RFC 2616 | Accept header not used for version selection | Future |
| vCard v4 full support | RFC 6350 | Only v3 required, v4 SHOULD supported | Future |
| DAV:current-user-principal-URL | RFC 5397 | Principal discovery not optimized | Future |
| Service discovery via SRV | 11 | Not implemented | Future |
| Advanced query features | 8.6 | GROUP-BY, GROUP-CONCAT not in use cases | Future |

### Precondition/Postcondition Errors - MISSING IMPLEMENTATION {#carddav-preconditions}

Per RFC 6352 §6.3.2.1, when preconditions fail, server MUST return specific XML elements as children of `DAV:error`:

**Missing:**
- `<CARDDAV:supported-address-data>` (403) - §5.1.1.1 for unsupported media type conversion
- `<CARDDAV:supported-address-data-conversion>` (403) - When media type conversion fails
- `<CARDDAV:valid-address-data>` (403) - §6.3.2.1 for invalid vCard
- `<CARDDAV:no-uid-conflict>` (409) - §6.3.2.1 when UID conflict
- `<CARDDAV:addressbook-multiget-parse-error>` (403) - Malformed REPORT request

### Recommendations (Priority Order) {#carddav-recommendations}

1. ✅ **Implemented**: `DAV:supported-report-set` on all collections and resources (2026-01-29)
2. **P1 (Critical)**: Add precondition error XML responses (5 missing elements)
3. **P1 (High)**: Implement `CARDDAV:supported-address-data` property
4. **P1 (High)**: Implement `CARDDAV:supported-collation-set` property
5. **P2 (High)**: Implement content negotiation (Accept header) for GET/REPORT
6. **P2 (Medium)**: Integrate `i;unicode-casemap` collation into text-match filters
7. **P2 (Medium)**: Add `CARDDAV:max-resource-size` property
8. **P2 (Medium)**: Implement text-match on FN, EMAIL, TEL properties with proper collation
9. **P2 (Medium)**: Add query result truncation signaling (§8.6.2)
10. **P3 (Lower)**: Implement partial address-data retrieval (property filtering)
11. **P3 (Future)**: Add `CARDDAV:addressbook-home-set` and `CARDDAV:principal-address` for principals
12. **P3 (Future)**: Full vCard v4 support

---

## 3. Core WebDAV (RFC 4918) - ~70-75% Compliant {#webdav-compliance}

### WebDAV Compliance Classes (RFC 4918 §18) {#webdav-classes}

| Class | Status | Requirement | Implementation |
|-------|--------|-----------|-----------------|
| **Class 1** | ✅ Required | GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, OPTIONS | Fully implemented |
| **Class 2** | ✅ **NOT ADVERTISED (CORRECT)** | Class 1 + LOCK, UNLOCK | Not implemented, correctly not advertised |
| **Class 3** | ⚠️ Partial | Class 1 + COPY, MOVE | Implemented |

**Current DAV header claim**: `1, 2, 3, calendar-access, addressbook`  
**Current**: `1, 3, calendar-access, addressbook` ✅ (correctly omits `2` since LOCK/UNLOCK not implemented)

### RFC 4918 Core MUST Requirements {#webdav-must-requirements}

**WebDAV servers MUST support:**
1. ✅ GET, HEAD methods
2. ✅ PUT method for resource creation/modification
3. ✅ DELETE method with proper preconditions
4. ✅ PROPFIND with Depth header support (0, 1, infinity)
5. ✅ PROPPATCH for property modification
6. ✅ OPTIONS with Allow and DAV headers
7. ✅ Proper HTTP status codes (201, 204, 207, 304, 400, 403, 404, 409, 412, 500)
8. ✅ ETag support (strong ETags, conditional requests)
9. ✅ Multistatus (207) responses for batch operations
10. ⚠️ LOCK/UNLOCK (if advertising Class 2) - NOT IMPLEMENTED

### ✅ Correctly Implemented {#webdav-correct}

| Feature | Status | Notes | RFC Ref |
|---------|--------|-------|---------|
| OPTIONS method | ✅ | Allow/DAV headers, compliance levels | 9.2, 10.1 |
| GET/HEAD methods | ✅ | Content-type, conditional requests, ETag | 9.4 |
| PUT method | ✅ | Create/update, If-Match/If-None-Match, 201/204 | 9.7 |
| DELETE method | ✅ | Soft-delete, tombstones, idempotency, If-Match | 9.6 |
| PROPFIND method | ✅ | Depth 0/1/infinity, allprop, propname, multistatus | 9.1 |
| PROPPATCH method | ✅ | Set/remove, protected properties, 207 responses | 9.2 |
| MKCOL method | ✅ | 201 Created, 409 Conflict, parent validation | 9.3 |
| COPY method | ✅ | Destination header, overwrite semantics, 201/204 | 9.8 |
| MOVE method | ✅ | Rename, tombstone generation, sync update | 9.9 |
| Collection resourcetype | ✅ | DAV:collection element properly reported | 15 |
| Resource distinction | ✅ | Proper collection vs. resource distinction | 5.2 |
| Response codes | ✅ | 201, 204, 207, 304, 400, 403, 404, 409, 412, 500 | 11, 12 |
| ETag generation | ✅ | Strong ETags, content-based, stable | 8.6 |
| Last-Modified header | ✅ | RFC 1123 format, auto-updated | DAV property |
| If-Match/If-None-Match | ✅ | Precondition checking, 412 responses | 10.4 |
| Depth header | ✅ | Parse, validate (0, 1, infinity), defaults | 10.2 |
| Multistatus XML | ✅ | Namespace handling, per-resource status | 13 |
| Error XML bodies | ✅ | DAV:error element with specific conditions | 8.7, 16 |
| Overwrite header | ✅ | COPY/MOVE overwrite control | 10.6 |
| Destination header | ✅ | URL parsing, validation | 10.3 |
| allprop behavior | ✅ | Returns live properties | 9.1.5 |
| propname behavior | ✅ | Returns property names only | 9.1.4 |
| Protected property handling | ✅ | Prevents modification of live properties | 9.2 |

### ⚠️ Partially Implemented / Edge Cases {#webdav-partial}

| Feature | Gap | RFC Ref | Impact |
|---------|-----|---------|--------|
| Complex If headers | Only basic If-Match/If-None-Match; no lock tokens, tagged conditions | 10.4 | Lock syntax not supported |
| Parent existence checks | May not return 409 on missing parent for PUT/COPY/MOVE | 9.7, 9.8, 9.9 | Spec compliance gap |
| DELETE Depth semantics | Default behavior on collections unclear | 9.6.1 | Recursive delete ambiguous |
| Overwrite: F validation | Framework present but may not fully enforce | 10.6 | Clients may fail unexpectedly |
| Class 2 advertising | ✅ Correctly omits Class 2 from DAV header | 18.2 | Fixed 2026-01-29 |
| HEAD optimization | Loads full entity unnecessarily | 9.4 | Performance issue, not spec violation |
| Range header support | May not support partial content (206) | 8 | Not required but useful |
| DAV:creationdate property | Not implemented | 15 | Missing optional live property |
| Cross-server COPY/MOVE | Not validated | 9.8.4 | May fail silently |
| Lock tokens in If header | Not supported | 6.5, 10.4 | Lock conditions unavailable |
| Depth: infinity handling | May have scalability issues on large trees | 10.2 | Not tested at scale |
| POST for collections | Defined but may not fully support | 9.5 | CalDAV/CardDAV specific |
| Location header on 201 | May not be returned | 8.7 | Minor convenience feature |

### 🔴 Not Implemented {#webdav-not-implemented}

| Feature | RFC | Issue | Impact |
|---------|-----|-------|--------|
| LOCK method | 9.10, Class 2 | ❌ Not implemented | Advertised but missing - spec violation |
| UNLOCK method | 9.11, Class 2 | ❌ Not implemented | Advertised but missing - spec violation |
| Write locks | 7 | Not supported | Affects COPY/MOVE/DELETE preconditions |
| Lock-Token header | 10.5 | Not supported | Precondition checking incomplete |
| Lock refresh (LOCK on locked) | 9.10.2 | Not supported | Lock timeout management missing |
| activelock XML | 14.1 | Not supported | Lock information unavailable |
| lockscope/locktype | 6.1-6.2 | Not supported | Exclusive/shared lock semantics missing |
| 423 Locked status | 11.3 | Not returned | Can't signal lock conflicts |
| 424 Failed Dependency | 11.4 | Not tested | Multi-request atomicity unclear |
| 507 Insufficient Storage | 11.5 | May not be returned | Quota failures unclear |

### Critical Issue: Class 2 Compliance Violation {#webdav-class2-violation}

**RFC 4918 §18.2: DAV Compliance Class 2**

"A server compliant to Class 2 MUST support Class 1 requirements in addition to LOCK, UNLOCK, and the If request header."

**Problem in Shuriken:**
- ✅ Advertises `DAV: 2` in OPTIONS response
- ❌ Does NOT implement LOCK method
- ❌ Does NOT implement UNLOCK method
- ❌ Complex If conditions (lock tokens) not supported

**RFC Compliance Impact**: **SPEC VIOLATION**

**Solution (Recommended for CalDAV/CardDAV):**
1. Remove `2` from DAV header
2. Update to: `DAV: 1, 3, calendar-access, addressbook`
3. Rationale: CalDAV (RFC 4791) and CardDAV (RFC 6352) do NOT require Class 2 - they only require Class 1 and basic ACL support

### Recommendations (Priority Order) {#webdav-recommendations}

1. **P0 (Critical - Immediate)**: Remove `2` from DAV header or implement full LOCK/UNLOCK support
2. **P1 (High)**: Verify 409 Conflict for non-existent parent collections in PUT/COPY/MOVE
3. **P1 (High)**: Add DAV:creationdate property support
4. **P2 (Medium)**: Verify DELETE recursive semantics (Depth: infinity on collections)
5. **P2 (Medium)**: Test Overwrite: F precondition enforcement
6. **P2 (Medium)**: Optimize HEAD to avoid full entity deserialization
7. **P3 (Lower)**: Document DELETE and COPY/MOVE Depth header defaults
8. **P3 (Future)**: Implement LOCK/UNLOCK (if needed beyond CalDAV/CardDAV)

---

## 4. Authentication & Authorization (RFC 3744) - Minimal Profile Recommended {#auth-compliance}

### RFC 3744 Core MUST Requirements (Full Profile) {#auth-must-requirements}

**For servers advertising "access-control" capability (§7.2), MUST support:**
1. ACL method (§8) - Modify ACLs
2. DAV:acl property (§5.5) - Read ACL
3. DAV:current-user-privilege-set (§5.4) - User's effective privileges
4. DAV:supported-privilege-set (§5.3) - Server's privilege model
5. Principals with principal URLs (§2, §4)
6. ACE evaluation and enforcement (§6)
7. Precondition enforcement (§8.1.1)
8. need-privileges error element (§7.1.1)

**For principals, MUST support:**
1. DAV:displayname property (§4 reference to RFC 2518)
2. DAV:resourcetype with DAV:principal element (§4)
3. DAV:principal-URL property (§4.2)
4. Optional: DAV:group-member-set, DAV:group-membership (§4.3, §4.4)

### Current State: ~30-40% RFC 3744 Compliant (Full Profile) {#auth-current}

**Status**: Shuriken should NOT advertise "access-control" in DAV header until minimal profile is implemented.

### 📋 Minimal RFC 3744 Profile Definition (Recommended for Shuriken) {#auth-minimal-profile}

A **minimal profile** provides ACL *discovery* without ACL *modification*:

#### **Profile Requirements - MUST Implement:**

| Feature | Requirement | Shuriken Status |
|---------|-------------|-----------------|
| **DAV:acl property** | Readable via PROPFIND; returns current ACLs as XML | ⚠️ Partially |
| **DAV:current-user-privilege-set** | Computed per request; contains user's effective privileges | ✅ Works |
| **DAV:supported-privilege-set** | Static tree of available privileges on resource type | ✅ Works |
| **ACE principal types** | Support `DAV:href`, `DAV:all`, `DAV:authenticated`, `DAV:unauthenticated` | ⚠️ Partial |
| **Core privileges** | `read`, `write`, `read-acl`, `write-acl`, `bind`, `unbind`, `all` | ✅ Works |
| **Grant-only ACEs** | Support grant clauses (no deny) | ✅ Works |
| **ACE markers (read-only)** | `protected` and `inherited` elements marked as non-modifiable | ⚠️ Incomplete |
| **need-privileges error** | Return `<DAV:need-privileges>` in 403 responses | ❌ Missing |
| **Pseudo-principals** | Support `DAV:all`, `DAV:authenticated`, `DAV:unauthenticated` | ⚠️ Partial |
| **DAV:owner property** | Read-only property identifying resource owner | ✅ Works |

#### **Profile Does NOT Require:**
- ❌ ACL method (no modification)
- ❌ Deny ACEs or complex grant/deny logic
- ❌ Complex principal types (`DAV:property`, `DAV:self`)
- ❌ ACL precondition error checking (`no-ace-conflict`, etc.)
- ❌ ACL REPORT methods (principal-property-search, etc.)
- ❌ Full principal property discovery (group-member-set, alternate-URI-set)
- ❌ ACL-restrictions property
- ❌ inherited-acl-set property
- ❌ principal-collection-set property
- ❌ Lock privilege enforcement (LOCK/UNLOCK)

### ✅ Currently Implemented (Beyond Minimal) {#auth-current-impl}

| Feature | Status | Notes |
|---------|--------|-------|
| Principal types (user, group) | ✅ | UUID-based with optional slug |
| Permission hierarchy (7 levels) | ✅ | freebusy → reader → writer → manager → editor → owner |
| Casbin path-based enforcement | ✅ | UUID-based resource paths, glob patterns |
| Principal expansion (users → groups + public) | ✅ | Automatic group resolution |
| Privilege mapping (read, write, owner, etc.) | ✅ | Casbin g2 role-to-permission |
| Authorization checks in HTTP handlers | ✅ | Guards on all collection operations |
| DAV:current-user-privilege-set property | ✅ | Static XML generation |
| DAV:supported-privilege-set property | ✅ | Static XML tree |
| DAV:owner property | ✅ | Reflects creator/owner |

### ⚠️ Gaps in Minimal Profile Implementation {#auth-gaps}

| Feature | Current | Required | Priority |
|---------|---------|----------|----------|
| **ACL property retrieval** | Partially (static) | ✅ Readable via PROPFIND | **P1** |
| **need-privileges error** | Minimal (basic 403) | ✅ XML element in 403 body | **P1** |
| **ACE principal types** | Partial (user/group) | ✅ All 4 types (href, all, auth, unauth) | **P1** |
| **ACE marker visibility** | Incomplete | ✅ protected/inherited read-only | **P1** |
| **Principal resource endpoints** | Not exposed | Optional for minimal | **P2** |
| **Principal discovery** | Via Casbin | Optional for minimal | **P2** |
| **ACL-restrictions property** | Missing | Not required for minimal | **P3** |
| **Advanced ACE types** | Not supported | Not required for minimal | **P3** |

### RFC 3744 §6 - ACL Evaluation {#auth-evaluation}

**Current implementation:**
- ✅ Casbin evaluates ACLs based on static policies
- ✅ Deny-before-grant ordering not relevant (grant-only model)
- ✅ User → group expansion via principal resolution
- ⚠️ No inherited ACL support (not required for minimal)
- ⚠️ No protected ACE enforcement (needed for minimal)

### RFC 3744 §7 - Access Control and Existing Methods

**Required precondition enforcement:**
- ✅ OPTIONS: Advertise "access-control" capability (when implemented)
- ✅ DELETE: Check DAV:unbind privilege
- ✅ PUT/COPY: Check DAV:bind privilege on parent, DAV:write-content on target
- ✅ MOVE: Check source unbind + destination bind
- ⚠️ ACL method preconditions: Not applicable (no ACL method)
- ⚠️ LOCK: Not implemented (Class 2 not supported)

### RFC 3744 §8.1.1 - ACL Precondition Errors

**For minimal profile, MUST support (read-only):**
- `DAV:need-privileges` - Required on all 403 errors (§7.1.1)
- `DAV:acl-read-supported` - For PROPFIND DAV:acl (optional)

**Not required for minimal:**
- `DAV:no-ace-conflict` (write-only)
- `DAV:no-protected-ace-conflict` (write-only)
- `DAV:no-inherited-ace-conflict` (write-only)
- `DAV:introduce-new-principal` (write-only)

### RFC 3744 §5 - Access Control Properties

**Must support in minimal profile:**
1. ✅ DAV:owner (§5.1) - Read-only, identifies resource owner
2. ✅ DAV:group (§5.2) - Read-only, group identifier (optional)
3. ✅ DAV:supported-privilege-set (§5.3) - Static privilege tree
4. ✅ DAV:current-user-privilege-set (§5.4) - User's privileges
5. ⚠️ DAV:acl (§5.5) - **CRITICAL: Must be readable**
6. ❌ DAV:acl-restrictions (§5.6) - Not required (write-only concern)
7. ❌ DAV:inherited-acl-set (§5.7) - Not required (no inheritance)
8. ❌ DAV:principal-collection-set (§5.8) - Optional for discovery

### Why Minimal Profile for Shuriken? {#auth-why-minimal}

1. **CalDAV/CardDAV don't strictly require full RFC 3744**
   - RFC 4791 (CalDAV) and RFC 6352 (CardDAV) only require RFC 3744 "support"
   - Most clients work with simpler permission models
   - Full ACL support is significant complexity

2. **Shuriken already enforces access control via Casbin**
   - Authorization is working well for server-side enforcement
   - Adding ACL modification would require managing Casbin policies via HTTP API

3. **Clients can still work effectively**
   - They can read permissions for UI feedback (DAV:acl, current-user-privilege-set)
   - Server enforces actual access control (Casbin backend)
   - No one can modify ACLs through CalDAV/CardDAV (acceptable limitation)

4. **Can be extended later**
   - Minimal profile is good foundation
   - ACL method can be added in future phases when needed

### Recommendations for Minimal RFC 3744 Profile (Priority Order) {#auth-recommendations}

1. **P1 (Critical - Must Do)**: 
   - Implement `DAV:acl` property readable in PROPFIND (return current ACLs as XML)
   - Add `DAV:need-privileges` XML element to all 403 Forbidden responses
   - Support all 4 ACE principal types: `DAV:href`, `DAV:all`, `DAV:authenticated`, `DAV:unauthenticated`
   - Mark `protected` and `inherited` ACE markers as read-only

2. **P2 (Should Do)**:
   - Return `DAV:acl` property in PROPFIND responses
   - Advertise "access-control" in DAV header (after P1 complete)
   - Add precondition error XML to authorization failures

3. **P3 (Nice to Have)**:
   - Implement principal-collection-set for discovery
   - Support group-member-set for group membership
   - Add ACL-restrictions property (optional)

4. **Do NOT Implement (Beyond Minimal)**:
   - ACL method
   - Deny ACEs
   - Complex precondition checking (no-ace-conflict, etc.)
   - ACL REPORT methods
   - Principal property modification

### Minimal Profile Completion Estimate

- **Effort**: ~16-24 hours
- **Payoff**: RFC 3744 compliance for ACL discovery; clients can show permissions
- **Future**: +20-40 hours to add ACL method (write support)

---

## 5. Sync Collection (RFC 6578) - ~85% Compliant {#sync-compliance}

### RFC 6578 Core MUST Requirements {#sync-must-requirements}

**Servers supporting sync-collection REPORT MUST:**
1. ✅ Support sync-collection REPORT method
2. ✅ Implement sync-token generation and tracking
3. ✅ Support baseline sync requests (start=0)
4. ✅ Support delta sync requests with existing token
5. ✅ Return deleted resources via tombstones (DAV:response with status 404)
6. ⚠️ Implement sync-token validation and retention policy
7. ✅ Return `DAV:sync-token` in response

### ✅ Correctly Implemented {#sync-correct}

| Feature | Status | Notes | RFC Ref |
|---------|--------|-------|---------|
| sync-collection REPORT | ✅ | Supported, basic implementation | §3 |
| Sync token generation | ✅ | Monotonic, per-collection | §3.7 |
| Baseline sync | ✅ | Query all resources with initial token | §4.2 |
| Delta sync | ✅ | Return changes since token | §4.2 |
| Deleted resource tracking | ✅ | Tombstones with 404 status | §3.4 |
| sync-token in response | ✅ | Returned in REPORT response | §3.7 |
| nresults limit | ✅ | Can limit result count | §4.6 |

### ⚠️ Partially Implemented {#sync-partial}

| Feature | Gap | RFC Ref | Impact |
|---------|-----|---------|--------|
| sync-token validation | No validation of old tokens or retention window | §3.7, §4.1 | Clients can use stale tokens |
| sync-token retention | No minimum retention policy documented | §3.7 (min 1 week recommended) | Sync failures possible |
| Baseline token | No documentation of baseline value | §3.7, §4.2 | Clients may not bootstrap correctly |
| Conflict detection | No `DAV:valid-sync-token` precondition | §4.1 | Clients can't detect invalid tokens |
| Multi-status per resource | Implemented but not optimized | §4.3 | May be slow on large result sets |

### Recommendations {#sync-recommendations}

1. **P1**: Implement sync-token retention policy (minimum 1 week)
2. **P1**: Add `DAV:valid-sync-token` precondition error handling
3. **P2**: Document sync-token format and baseline value
4. **P2**: Add tests for sync-token validation and expiration
5. **P3**: Optimize multistatus generation for large result sets

---

## 6. Database Schema & Storage (RFC 4791/6352/5545/6350) - ~95% Compliant {#database-compliance}

### ✅ Correctly Implemented {#database-correct}

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

### ⚠️ Minor Issues {#database-issues}

| Issue | Recommendation |
|-------|-----------------|
| UID constraint is app-level only | Add database-level unique index for atomicity |
| Sync token retention policy undocumented | Document ≥1 week minimum (RFC 6578) |
| Purge strategy not visible | Ensure soft-deleted records cleaned after retention window |

### Recommendations {#database-recommendations}

**✅ Recommended Database Constraint**

```sql
CREATE UNIQUE INDEX uq_dav_instance_collection_uid
ON dav_instance(collection_id, logical_uid)
WHERE deleted_at IS NULL AND logical_uid IS NOT NULL;
```

**Benefit**: Atomic UID uniqueness enforcement under concurrent load.

---

## 7. RFC Parsing & Validation - ~65-70% Compliant {#parsing-compliance}

### ✅ Correctly Implemented {#parsing-correct}

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

### ⚠️ Partially Implemented {#parsing-partial}

| Feature | Gap | Impact |
|---------|-----|--------|
| Required properties | Not enforced | Malformed data accepted (PRODID, UID, DTSTAMP missing) |
| Component cardinality | Not validated | Multiple PRODID/VERSION allowed | 
| Encoding support | BASE64, QUOTED-PRINTABLE missing | Binary properties unusable |
| Structured values | N, ADR components not validated | Malformed data accepted |
| RRULE validation | UNTIL/COUNT mutual exclusivity not checked | Invalid recurrence rules accepted |
| Timezone references | TZID accepted without VTIMEZONE validation | Silent data corruption possible |

### 🔴 Not Implemented {#parsing-not-implemented}

| Feature | Impact |
|---------|--------|
| RFC 6868 parameter unescaping | Parameter values may be incorrect |
| GEO coordinate bounds (-90/+90, -180/+180) | Invalid coordinates accepted |
| EMAIL/TEL format validation | Malformed addresses accepted |
| Timezone database validation | No IANA zone validation |
| LINE-LENGTH validation before folding | May fail on edge cases |

### Recommendations {#parsing-recommendations}

1. **Immediate**: Add post-parse schema validator for required properties
2. **Immediate**: Enforce component cardinality constraints
3. **Short-term**: Add BASE64/QUOTED-PRINTABLE support
4. **Short-term**: Validate TZID references against VTIMEZONE blocks
5. **Medium-term**: RFC 6868 parameter unescaping
6. **Medium-term**: GEO bounds, EMAIL/TEL format validation

---

## 8. Testing Infrastructure - ~75% Coverage {#testing-infrastructure}

### ✅ Well-Covered {#testing-covered}

| Area | Coverage | Tests |
|------|----------|-------|
| HTTP methods | 9/10 | OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE |
| Error conditions | Strong | 409, 412, 404, 403, 400, 500 |
| Authorization | Very strong | 12+ role/permission tests |
| REPORT variants | ✅ Strong | calendar-query, calendar-multiget, addressbook-query, addressbook-multiget, sync-collection |
| UID uniqueness | ✅ | Conflict detection tested |
| ETags | ✅ | Conditional requests, validation |
| **Overall** | **153/153 passing** | All integration and unit tests pass |

### ⚠️ Gaps in Test Coverage {#testing-gaps}

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

### Recommendations {#testing-recommendations}

1. Add text-match query tests (filter evaluation, property matching)
2. Add concurrent modification tests (race conditions, sync-token correctness)
3. Add timezone handling in time-range queries
4. Test expand-property REPORT (if implementing ACL discovery)
5. Add FN/EMAIL text-match tests for CardDAV

---

## 9. Architectural Impact Analysis {#architectural-analysis}

### Overview: Strengths of Current Architecture {#architectural-strengths}

**Shuriken's architectural decisions are fundamentally sound for RFC compliance.** The design creates robust foundations that enable RFC requirements without compromising flexibility.

**Key Architectural Strengths:**

1. **UUID-Based Internal Storage**: Stable, immutable resource identifiers independent of client-visible paths
2. **Entity/Instance Separation**: Enables content sharing across collections with per-collection metadata
3. **Component Tree Structure**: Perfect for RFC-compliant partial retrieval and filtering
4. **Glob-Path ACL Model**: Efficient collection-level permissions with inheritance
5. **Clean Layer Separation**: HTTP handlers → Services → DB/Casbin enables testability

**Critical Insight**: All compliance gaps are **protocol-layer** issues (missing XML properties, error responses) rather than architectural problems. No redesign needed.

### UUID-Based Internal Storage vs RFC Path Requirements {#uuid-architecture}

**Shuriken Design Decision**: All authorization paths use UUIDs internally (e.g., `/cal/<principal-uuid>/<collection-uuid>/**`)

**RFC Compliance Impact**:

#### ✅ ADVANTAGES:

1. **Slug Independence**: Authorization policies don't break when collections are renamed
2. **Query Stability**: Can recompute slugs without rebuilding ACLs
3. **Sharing Semantics**: Entity/instance separation means same content in multiple collections has same authorization context
4. **Performance**: Direct UUID lookups faster than slug traversal

#### ⚠️ CHALLENGES:

1. **Client-Visible Paths Are Slugs**: RFC clients see `/calendars/alice/work/event-123.ics` (slugs)
2. **Error Responses Must Translate**: When authorization fails, error must reference client-visible path, not UUID path
3. **Casbin Paths Must Stay Hidden**: Clients cannot see internal UUID-based Casbin paths

**Example Mapping Required**:
```
Client Request: GET /calendars/alice/work/event-123.ics
Internal Resolution: 
  - alice → <uuid-alice>
  - work → <uuid-work>
  - event-123 → <uuid-event>
Casbin Check: can_read(<user>, /cal/<uuid-alice>/cal/<uuid-work>/)
Response (if denied):
  403 with <D:href>/calendars/alice/work/event-123.ics</D:href>  
  NOT: <D:href>/cal/<uuid-alice>/cal/<uuid-work>/<uuid-event></D:href>
```

**Compliance Note**: Shuriken's architecture supports this correctly - just need to ensure error responses use original path_location, not canonical_location

**RFC Alignment**: RFC 4918 §5.2 states resources have stable identity - UUID-based storage satisfies this. RFC 6578 sync tokens don't require stable URIs - opaque paths acceptable.

### Glob-Path ACL Model vs Individual Resource ACLs {#glob-acl-architecture}

**Shuriken Design**: ACLs are at collection level (glob patterns), items inherit by containment

**RFC Requirement** (RFC 3744 §5): Each resource can have its own DAV:acl property

**Compliance Gap**:
- ✅ Can return DAV:acl property on collections
- ❌ Cannot return DAV:acl property on individual items (they don't have own ACEs)
- ❌ DAV:inherited-acl-set property not applicable (not using inherited ACEs)

**RFC Semantics**:
```xml
<!-- What RFC 3744 expects for an item: -->
<D:acl xmlns:D="DAV:">
  <D:ace>
    <D:principal><D:href>...</D:href></D:principal>
    <D:grant><D:privilege><D:read/></D:privilege></D:grant>
    <D:inherited>  <!-- Indicates inherited from collection -->
  </D:ace>
</D:acl>
```

**Shuriken Implementation**:
```xml
<!-- Should return empty or collection's ACL -->
<!-- But no <D:inherited> marker to indicate this is inherited -->
<D:acl xmlns:D="DAV:">
  <!-- Items have no direct ACEs -->
  <!-- Access determined by collection's glob patterns via Casbin -->
</D:acl>
```

**Architectural Workaround**: 
- ✅ Return collection's ACL on item GET (marking as inherited)
- ✅ Prevents client confusion about why item access works

**RFC Compliance**: Glob-pattern model is philosophically compatible with RFC 3744 §6 ACL evaluation - just needs proper XML serialization layer.

### Component Tree Structure: Query Performance vs Retrieval Completeness {#component-tree-architecture}

**Shuriken Storage Model**:
```
dav_entity (canonical content)
  ↓
dav_component (tree structure)
  ├ VCALENDAR
  ├ VEVENT (1)
  ├ VALARM (1a)
  ├ VEVENT (2, RECURRENCE-ID)
  └ VTIMEZONE
```

**Advantages for RFC Compliance**:
- ✅ Perfect for partial retrieval (can traverse and selectively serialize)
- ✅ Enables time-range queries on components (not just properties)
- ✅ Stores all nesting context for proper RFC reconstruction

**Challenges**:
- ⚠️ Serialization from tree must preserve RFC syntax exactly
- ⚠️ Parameter ordering must match original (not guaranteed)
- ⚠️ Text escaping must follow RFC 5545 line folding

**Specific Issue**: RFC 4791 §7.8.1 Example shows:

```icalendar
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Example Corp.//CalDAV Client//EN
BEGIN:VTIMEZONE
LAST-MODIFIED:20040110T032845Z
...
```

**Requirement**: When clients request specific properties, the serialized output **must** include PRODID, VERSION at top level even if not explicitly requested (RFC 5545 §3.6 "iCalendar object" requires these)

**Current Gap**: May strip these if not explicitly requested in partial retrieval

**RFC Impact**: RFC 4791 §9.9 - calendar-data filtering can work on component tree. RFC 4791 §7.6 & §9.6 - partial retrieval semantics require selective serialization.

**Recommended Implementation**:
```rust
// Serialize only specified components
fn serialize_with_filter(
    root: &Component, 
    include_paths: &[&str]  // ["VEVENT", "VEVENT/VALARM"]
) -> String { ... }
```

### Entity/Instance Separation: Sharing Implications {#entity-instance-architecture}

**Shuriken Model**: One entity can exist in multiple collections as different instances

```
dav_entity (ID: uuid-event-1)
  ├ dav_instance in /alice/calendar/ (slug: event-1, etag: abc123)
  ├ dav_instance in /bob/calendar/ (slug: imported-event, etag: xyz789)
  └ dav_instance in /shared-cal/ (slug: team-event, etag: def456)
```

**RFC Compliance Implications**:

#### ✅ CORRECT BEHAVIOR:

1. **UID Uniqueness**: Each collection enforces UID uniqueness for its instances ✅
2. **ETag Independence**: Each instance has own ETag (correct for If-Match) ✅
3. **Sync Tokens**: Each collection has own sync-token ✅

#### ⚠️ POTENTIAL ISSUES:

1. **PRODID Preservation**: If shared entity is stored once, PRODID might not reflect original client
   - RFC 5545 §3.6: PRODID "specifies the product identifier for the product that created the iCalendar object"
   - Shared entity created by alice, imported by bob - which PRODID should be in GET response?
   - **Current Implementation**: Probably returns original PRODID (from alice), which is correct

2. **DTSTAMP Handling**: RFC 4791 §5.3.2.1 states "iCalendar VALUE MUST NOT have DTSTAMP" in stored form
   - **Current**: Stores DTSTAMP but strips on retrieval? (Need to verify)

3. **Modified Content**: If shared, what if alice modifies the event?
   - All instances in other collections see the change (by design)
   - **RFC Compliance**: This is correct - same event, just in different collections

**RFC Alignment**: 
- RFC 4791 §5.3.2: Resources are immutable once created (entity level) ✅
- RFC 4791 §5.3.2: Each collection has independent ETag/sync tracking (instance level) ✅
- RFC 6578 §3.7: Sync tokens are per-collection (instance-level) ✅
- RFC 4918 §5.2: Collections have independent member lists (instances) ✅

**Status**: Design is excellent, no changes needed. Just verify UID uniqueness per collection (not global).

### Application Structure (HTTP Handlers → Services → DB/Casbin) {#application-structure}

**Current Implementation:**
- `src/app/api/`: HTTP request/response handling
- `src/component/`: Business logic (auth, db queries, RFC validation)
- `src/component/db/`: Database queries (query composition pattern)
- `src/component/auth/`: Casbin authorization enforcement

**RFC Compliance Impact**:

✅ **Strengths:**
- Clean separation enables RFC compliance checking per module
- RFC handlers can be validated independently
- DB layer pure (testable RFC properties)
- Auth layer abstracted (can be mocked)

⚠️ **Gaps at API Layer:**
- Missing: `supported-report-set` property generator
- Missing: `supported-calendar-component-set` property generator
- Missing: Precondition error XML response bodies
- Missing: RFC 3744 `DAV:acl` property serializer
- Missing: `DAV:need-privileges` error element generator

✅ **Recommended**: Add new modules:
```
src/component/rfc/
  ├── properties/        // Live property generators
  │   ├── discovery.rs   // supported-report-set, supported-components
  │   ├── acl.rs         // DAV:acl from Casbin policies
  │   └── privilege.rs   // current-user-privilege-set
  └── errors/            // RFC precondition/postcondition errors
      ├── caldav.rs      // supported-calendar-component, etc.
      ├── carddav.rs     // supported-address-data, etc.
      └── acl.rs         // need-privileges element
```

These are **generators**, not validation logic. They convert Shuriken's internal state (Casbin policies, supported features) into RFC-compliant XML.

### Protocol-Layer Gaps (Not Architectural) {#protocol-gaps}

#### Missing from ALL Collections/Resources:

| Property | RFC | Gap | Impact |
|----------|-----|-----|--------|
| `DAV:supported-report-set` | 4791 §2, 6352 §3 | Not on collections or items | **CRITICAL** - Clients can't discover which REPORT methods work |
| `CALDAV:supported-calendar-component-set` | 4791 §5.2.3 | Not on calendar collections | **HIGH** - Clients don't know if VEVENT/VTODO supported |
| `CALDAV:supported-calendar-data` | 4791 §5.2.4 | Not on calendar collections | **HIGH** - Clients can't know media-type version support |
| `CALDAV:max-resource-size` | 4791 §5.2.5 | Not on calendar collections | **MEDIUM** - Clients might send oversized resources |
| `CALDAV:min-date-time` | 4791 §5.2.6 | Not on calendar collections | **MEDIUM** - Clients don't know query bounds |
| `CALDAV:max-date-time` | 4791 §5.2.7 | Not on calendar collections | **MEDIUM** - Clients don't know query bounds |
| `CALDAV:max-instances` | 4791 §5.2.8 | Not on calendar collections | **MEDIUM** - Unlimited expansion could DOS |
| `CALDAV:supported-collation-set` | 4791 §7.5.1 | Not on calendar collections | **MEDIUM** - Clients don't know collations |
| `CARDDAV:supported-address-data` | 6352 §6.2.2 | Not on addressbook collections | **HIGH** - vCard v3 vs v4 support unknown |
| `CARDDAV:supported-collation-set` | 6352 §8.3.1 | Not on addressbook collections | **MEDIUM** - Case-folding support unknown |

**Impact Example**:
```xml
<!-- Client with no discovery support: -->
PROPFIND /calendars/alice/work/ HTTP/1.1

<!-- Expected response includes: -->
<C:supported-calendar-component-set>
  <C:comp name="VEVENT"/>
  <C:comp name="VTODO"/>
  <C:comp name="VJOURNAL"/>
</C:supported-calendar-component-set>

<!-- Current: Returns empty or omitted -->
```

#### Options Method Capability Advertising

**RFC 4791 §5.1 Example**:
```http
OPTIONS /calendars/alice/work/ HTTP/1.1

HTTP/1.1 200 OK
DAV: 1, 3, calendar-access, addressbook  ← Should list capabilities
Allow: OPTIONS,GET,HEAD,POST,PUT,DELETE,PROPFIND,PROPPATCH,MKCOL,COPY,MOVE,REPORT
```

**Current Issue**: DAV header claims `2` (LOCK/UNLOCK) but not implemented

#### Error Response Completeness

**Missing XML Elements in Error Responses:**

**For PUT/COPY/MOVE (RFC 4791 §5.3.2.1)**:

```xml
<!-- Missing from 409/403 responses: -->
<D:error>
  <C:valid-calendar-data/>  <!-- Invalid iCalendar syntax -->
  <C:no-uid-conflict/>      <!-- UID already exists -->
  <C:supported-calendar-component/>  <!-- Wrong component type -->
  <C:supported-calendar-data/>  <!-- Unsupported media type -->
</D:error>
```

**For PROPFIND DAV:acl (RFC 3744 §8.1.1)**:

```xml
<!-- Missing from 403 responses: -->
<D:error>
  <D:need-privileges>
    <D:resource>
      <D:href>/calendars/alice/work/</D:href>
      <D:privilege><D:read-acl/></D:privilege>
    </D:resource>
  </D:need-privileges>
</D:error>
```

#### ACL Evaluation: Missing Precondition Error Semantics

**RFC 3744 §7.1.1 - Error Handling:**

RFC 3744 states: "When principal does not have the required privilege, the server MUST return a 403 (Forbidden) response. The response MUST include a DAV:error element that contains a DAV:need-privileges element, which in turn contains one or more DAV:resource and DAV:privilege elements."

**Current Implementation in Shuriken**:
```rust
// From src/app/api/dav/method/get_head/helpers.rs
async fn check_read_authorization(...) -> Result<(), AppError> {
    // Returns 403 if unauthorized
    // But does NOT include need-privileges XML in response body
}
```

**Example - What's Missing**:
```http
HTTP/1.1 403 Forbidden
Content-Type: application/xml; charset="utf-8"

<?xml version="1.0" encoding="utf-8"?>
<D:error xmlns:D="DAV:">
  <D:need-privileges>
    <D:resource>
      <D:href>/calendars/alice/calendar/event-1.ics</D:href>
      <D:privilege>
        <D:read/>
      </D:privilege>
    </D:resource>
  </D:need-privileges>
</D:error>
```

**Current State**: Returns `403 Forbidden` with empty or generic body

**RFC Impact**: HIGH - Clients cannot understand why they're denied access  
**Architectural Note**: Authorization is UUID-based internally, but clients see slug paths - responses must map back correctly

---

## 10. Risk Assessment {#risk-assessment}

### Architectural Gaps: NONE {#risk-architectural}

Shuriken's architecture (UUID storage, entity/instance separation, component tree) is **sound for RFC compliance**.

**All design decisions are RFC-compatible:**
- ✅ UUID-based internal storage with slug-path resolution
- ✅ Glob-path ACL enforcement via Casbin
- ✅ Component tree structure for nested components
- ✅ Entity/instance separation for sharing
- ✅ Application structure (handlers → services → DB)

**No redesign or refactoring needed.**

### Protocol Gaps: MODERATE {#risk-protocol}

**List of actual gaps**:
1. ✅ Property discovery (fixable, ~15 hours total)
2. ✅ Error XML elements (fixable, ~6 hours)
3. ✅ Filter validation (fixable, ~8 hours)
4. ✅ Partial retrieval (fixable, ~12 hours)

**Total effort to 85% compliance**: ~40 hours

**These gaps do NOT require architectural changes**, just protocol-layer implementations.

### Path Forward {#risk-path-forward}

**Immediate (This Week)**
- [ ] Fix DAV header (10 min)
- [x] Add supported-report-set (4h) - **COMPLETE** (2026-01-29)
- [ ] Add need-privileges error (6h)
- [ ] Add supported-calendar-component-set (2h)

**Result**: 70% → 75% compliance (spec violations fixed)

**Short Term (Next 2 Weeks)**
- [ ] Filter validation (8h)
- [ ] Selective serialization (12h)
- [ ] Collation validation (3h)
- [ ] supported-address-data property (1h)
- [ ] DAV:acl property retrieval (8h)

**Result**: 75% → 85% compliance (discovery and query robustness)

**Medium Term (Phase 7)**
- [ ] ACL method (20h)
- [ ] Free-busy-query (16h)
- [ ] Scheduling (40h+)

**Result**: 85% → 95%+ compliance (full feature parity)

---

## 11. Missing RFC Requirements - Deep Dive {#missing-requirements}

### RFC 4791 (CalDAV) - Missed MUST/SHOULD Requirements {#missing-caldav}

| Requirement | RFC Section | Severity | Impact | Solution |
|-------------|-------------|----------|--------|----------|
| MUST advertise `DAV:supported-report-set` | 4791 / RFC 3253 | **IMPLEMENTED** | ✅ Clients can discover available REPORT methods | ✅ Property generator implemented in discovery.rs |
| MUST advertise `CALDAV:supported-calendar-component-set` | 5.2.3 | **MUST** | Clients can't know which component types supported | Return XML listing VEVENT, VTODO, VJOURNAL |
| MUST advertise `CALDAV:supported-calendar-data` | 5.2.4 | **MUST** | Clients can't know media type support | Return `<D:calendar-data><D:comp name="VCALENDAR"/></D:calendar-data>` |
| MUST advertise `CALDAV:max-resource-size` | 5.2.5 | **SHOULD** | Clients don't know size limits | Return max entity size in bytes |
| MUST return precondition error XML | 1.3, §9.1.1 | **MUST** | Clients can't distinguish error reasons | Return `<CALDAV:supported-calendar-component>`, `<CALDAV:valid-calendar-data>`, etc. in 409/403 |
| MUST validate sync-token baseline | RFC 6578 §4.1 | **SHOULD** | Stale tokens could cause incorrect sync | Check if token older than retention window, return DAV:valid-sync-token precondition |
| SHOULD support iCalendar recurrence expansion limits | 9.6.7 | **SHOULD** | Large recurring events could cause DOS | Implement `limit-freebusy-set` precondition, enforce max-instances |
| SHOULD support calendar-data property filtering | 9.6 | **SHOULD** | Bandwidth waste with full calendar-data | Implement selective serialization from component tree |

### RFC 6352 (CardDAV) - Missed Requirements {#missing-carddav}

| Requirement | RFC Section | Severity | Impact | Solution |
|-------------|-------------|----------|--------|----------|
| MUST advertise `DAV:supported-report-set` | 3 / RFC 3253 | **IMPLEMENTED** | ✅ Clients can discover available REPORT methods | ✅ Property includes addressbook-query, addressbook-multiget, sync-collection |
| MUST advertise `CARDDAV:supported-address-data` | 6.3.1 | **MUST** | Clients can't know vCard version support | Return `<D:address-data><D:version>4.0</D:version></D:address-data>` |
| MUST return address-data error XML | 10.3.1 | **MUST** | Clients can't distinguish error types | Return `<C:supported-address-data>`, `<C:no-uid-conflict>`, etc. in 403/409 |
| MUST validate single VCARD per resource | 5.1 | **SHOULD** | Multi-VCARD accepted, breaks RFC | Add parser validation, reject on PUT |
| MUST support FN/EMAIL text-match queries | 10.3 | **SHOULD** | Contact search limited | Integrate collation into filter evaluation |
| SHOULD support Content-Type negotiation | 5.1.1 | **SHOULD** | Can't select vCard version | Implement Accept header parsing, return v3/v4 |

### RFC 3744 (ACL) - Minimal Profile MUST Requirements {#missing-acl}

| Requirement | RFC Section | Severity | Impact | Solution |
|-------------|-------------|----------|--------|----------|
| MUST return `DAV:acl` property | 5.5 | **MUST** | Clients can't read ACLs | Implement `DAV:acl` PROPFIND response |
| MUST return `DAV:current-user-privilege-set` | 5.4 | **MUST** | Clients can't determine UI state | Already implemented; verify in PROPFIND |
| MUST return `DAV:supported-privilege-set` | 5.3 | **MUST** | Clients can't discover privilege model | Return static privilege tree in PROPFIND |
| MUST return `DAV:need-privileges` on 403 | 7.1.1 | **MUST** | Clients can't distinguish authorization failures | Add XML element to 403 responses |
| MUST support `DAV:all` principal | 5.5.1 | **MUST** | Can't share with everyone | Replace 'public' with standard `<D:all/>` |
| MUST support `DAV:authenticated` principal | 5.5.1 | **MUST** | Can't share with auth users only | Add as distinct from `<D:all/>` |
| MUST support `DAV:unauthenticated` principal | 5.5.1 | **MUST** | Can't share with anonymous users | Add as principal type |
| MUST return owner property | 5.1 | **MUST** | ACL ownership unclear | Ensure returned in PROPFIND |

### RFC 4918 (WebDAV) - Compliance Class Violation {#missing-webdav}

**Problem**: Current DAV header advertises Compliance Class 2:
```
DAV: 1, 2, 3, calendar-access, addressbook-access
```

**RFC 4918 §18.1 Requirements for Class 2:**
- MUST support LOCK method
- MUST support UNLOCK method  
- MUST support lock-related If headers
- MUST support activelock XML

**Current Status:**
- ❌ LOCK not implemented
- ❌ UNLOCK not implemented
- ❌ Lock-related headers not implemented
- ❌ activelock XML not generated

**Solution**: Remove `2` from DAV header. CalDAV/CardDAV do not require Class 2.

### RFC 5545 (iCalendar) - Parsing Validation Gaps {#missing-icalendar}

| Missing Validation | RFC Section | Impact | Priority |
|-------------------|-------------|--------|----------|
| Required property enforcement | 3.6 | PRODID, VERSION must exist | Medium |
| Component cardinality | 3.6.1 | PRODID: ≤1, METHOD: ≤1, etc. | Medium |
| DTSTART/DTEND/DURATION constraints | 3.6.1 | DTEND XOR DURATION, mutual exclusivity | Low |
| RRULE UNTIL/COUNT mutual exclusivity | 3.8.4.3 | Can't have both | Low |
| Timezone TZID reference validation | 3.8.4.1 | TZID must reference VTIMEZONE | Low |
| BASE64/QUOTED-PRINTABLE encoding | 3.1.3 | Attachment encoding | Low |

### RFC 6350 (vCard) - Parsing Validation Gaps {#missing-vcard}

| Missing Validation | RFC Section | Impact | Priority |
|-------------------|-------------|--------|----------|
| Single VCARD per resource | 6.1 | Enforce in parser | Medium |
| Required FN property | 6.2.1 | Must be present | Low |
| GEO coordinate bounds | 6.4.2 | lat: -90 to 90, lon: -180 to 180 | Low |
| TEL type values | 6.4.1 | voice, cell, fax, etc. | Low |
| EMAIL format validation | 6.4.1 | RFC 5321/5322 | Low |

---

## 12. Protocol Layer vs Storage Layer - Analysis {#protocol-vs-storage}

### What's **Strong** (Storage Layer - No Changes Needed) {#storage-strong}

| Layer | Implementation | Status | RFC Impact |
|-------|----------------|--------|-----------|
| Storage | UUID-based entity/instance separation | ✅ Excellent | Enables all CalDAV/CardDAV features |
| Storage | Component tree structure | ✅ Excellent | Supports partial retrieval, filtering |
| Storage | Soft-delete & tombstones | ✅ Excellent | RFC 6578 sync correctness |
| Storage | Monotonic sync tokens | ✅ Excellent | Incremental sync works perfectly |
| Storage | Property type preservation | ✅ Excellent | No data loss on round-trip |
| Storage | Timezone caching & IANA mapping | ✅ Excellent | Timezone handling correct |
| Storage | Casbin policy storage | ✅ Good | ACL enforcement foundation sound |

### What's **Broken** (Protocol Layer - Needs Implementation) {#storage-broken}

| Layer | Missing | Status | RFC Impact |
|-------|---------|--------|-----------|
| Protocol | Live property generators | ❌ Missing | Properties not discoverable |
| Protocol | Precondition error XML | ❌ Missing | Clients can't distinguish errors |
| Protocol | `DAV:acl` serializer | ❌ Missing | ACLs not readable |
| Protocol | `DAV:need-privileges` builder | ❌ Missing | 403 errors lack detail |
| Protocol | Selective serialization | ⚠️ Partial | calendar-data filtering not used |
| Protocol | LOCK/UNLOCK methods | ❌ Missing | (Remove from DAV header instead) |

### No **Design Issues** (Architecture Is Sound) {#storage-no-issues}

✅ All design decisions (UUID storage, glob paths, component trees, entity/instance) are RFC-compliant and well-suited for the task.

---

## 13. Critical Action Items {#critical-action-items}

### 🔴 Must Fix (Blocking) {#action-must-fix}

1. ✅ **Remove LOCK/UNLOCK from DAV header** - COMPLETE (2026-01-29)
   - RFC 4918 §18.1: Cannot advertise Class 2 without LOCK/UNLOCK
   - **Status**: DAV header correctly advertises "1, 3, calendar-access, addressbook" without Class 2
   - **Location**: [options.rs](../crates/shuriken-app/src/app/api/dav/method/options.rs)
   - **Test**: [options.rs:247-283](../crates/shuriken-test/tests/integration/options.rs#L247-L283)

2. ✅ **Implement `supported-report-set` property** (CalDAV + CardDAV) - **COMPLETE** (2026-01-29)
   - Status: Implemented for calendar and addressbook collections
   - Location: [discovery.rs](../crates/shuriken-rfc/src/rfc/dav/core/property/discovery.rs#L16-L76)
   - Integration: [propfind helpers.rs](../crates/shuriken-app/src/app/api/dav/method/propfind/helpers.rs#L108-L113)
   - Tests: [propfind.rs](../crates/shuriken-test/tests/integration/propfind.rs#L768-L882)

3. ✅ **Return XML error bodies for PUT failures** (CalDAV + CardDAV) - **COMPLETE** (2026-01-29)
   - Status: PUT requests now return RFC-compliant XML error bodies
   - CalDAV: Returns `valid-calendar-data` and `no-uid-conflict` preconditions (RFC 4791 §5.3.2)
   - CardDAV: Returns `valid-address-data` and `no-uid-conflict` preconditions (RFC 6352 §5.3.3)
   - Location: [caldav/put/mod.rs](../crates/shuriken-app/src/app/api/caldav/method/put/mod.rs), [carddav/put/mod.rs](../crates/shuriken-app/src/app/api/carddav/method/put/mod.rs)
   - Tests: [uid_validation.rs](../crates/shuriken-test/tests/integration/uid_validation.rs), [put.rs](../crates/shuriken-test/tests/integration/put.rs)

4. **Implement `DAV:acl` property retrieval** (RFC 3744 minimal)
   - Make readable via PROPFIND
   - Return current ACL as XML with ACE elements
   - Mark inherited/protected ACEs as read-only

5. **Add `DAV:need-privileges` error element** (RFC 3744 minimal)
   - Include in 403 Forbidden responses
   - Specify which privilege was denied on which resource

### ⚠️ Should Fix (Important) {#action-should-fix}

1. Add `supported-calendar-component-set` property
2. Integrate `i;unicode-casemap` collation into filter evaluation
3. Implement RFC 4791 §9 precondition error XML responses
4. Add database-level UID uniqueness constraint
5. Implement text-match filtering on all properties
6. Add sync-token validation and retention window checking

### 🔧 Nice to Have (Future) {#action-nice-to-have}

1. Implement free-busy-query REPORT (RFC 4791)
2. Add content negotiation (Accept header) for GET
3. Implement CalDAV Scheduling (RFC 6638) - Phase 7+
4. Add expand-property REPORT for principal discovery
5. Implement ACL method for ACL modification (beyond minimal profile)

---

## 14. Implementation Priority Matrix {#priority-matrix}

| Priority | Item | Effort | Impact | Phase |
|----------|------|--------|--------|-------|
| **P1** | Remove/implement LOCK/UNLOCK | 1h | Critical | Now |
| ✅ | `supported-report-set` property | 4h | High | ✅ Complete |
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

## 15. Implementation Roadmap {#implementation-roadmap}

### Phase 0: Critical Fixes (1 Day) - Reach 72% Compliance {#roadmap-phase0}

| Item | Effort | Impact | Risk | Status |
|------|--------|--------|------|--------|
| Remove Class 2 from DAV header | 30m | Eliminates spec violation | None | ✅ **Complete** (2026-01-29) |
| Add `supported-report-set` property | 2h | Enables report discovery | Low | ✅ **Complete** (2026-01-29) |
| - Calendar collections (CALDAV) | | calendar-query, calendar-multiget, sync-collection | | ✅ **Complete** |
| - Addressbook collections (CARDDAV) | | addressbook-query, addressbook-multiget, sync-collection | | ✅ **Complete** |
| Fix Compliance Class advertising | 30m | Honest about capabilities | None | ✅ **Complete** (2026-01-29) |

**Total**: 3 hours → **72% compliance** (partial: property discovery done)

### Phase 1: Discovery & Errors (1 Week) - Reach 80% Compliance {#roadmap-phase1}

| Item | Effort | Impact | Dependencies | Status |
|------|--------|--------|---------------|--------|
| Add `supported-calendar-component-set` property | 3h | Clients know component support | Phase 0 | ✅ **Complete** (2026-01-29) |
| Add `supported-calendar-data` property | 2h | Clients know media types | Phase 0 | ✅ **Complete** (2026-01-29) |
| Add `supported-collation-set` property | 2h | Text-match collations | Phase 0 | ✅ **Complete** (2026-01-29) |
| Add `CALDAV:` precondition error XML | 4h | Clients understand errors | Phase 0 | ⏳ Pending |
| Add `CARDDAV:` precondition error XML | 3h | CardDAV error handling | Phase 0 | ⏳ Pending |
| Add `DAV:acl` property serializer | 6h | ACLs readable | Phase 0 | ⏳ Pending |
| Add `DAV:need-privileges` error element | 3h | 403 errors detailed | Phase 0 | ⏳ Pending |
| Return `DAV:supported-privilege-set` | 2h | Privilege discovery | Phase 0 | ⏳ Pending |

**Total**: 25 hours → **80% compliance** (partial: discovery properties complete)

### Phase 2: Query Improvements (2 Weeks) - Reach 85% Compliance {#roadmap-phase2}

| Item | Effort | Impact | Dependencies |
|------|--------|--------|---------------|
| Implement text-match collation integration | 8h | RFC 4790 compliance | Phase 1 |
| Add sync-token retention validation | 3h | Sync correctness | Phase 1 |
| Implement selective calendar-data serialization | 6h | Bandwidth efficiency | Phase 1 |
| Add component validation (cardinality, required) | 6h | Data integrity | Phase 1 |

**Total**: 23 hours → **85% compliance**

### Phase 3: Advanced Features (Future) - Reach 90%+ {#roadmap-phase3}

| Item | Effort | Impact | Phase |
|------|--------|--------|-------|
| free-busy-query REPORT | 16h | Scheduling workflows | Phase 7 |
| ACL method implementation | 20h | Full RFC 3744 support | Phase 7+ |
| CalDAV Scheduling (RFC 6638) | 40h+ | ORGANIZER/ATTENDEE | Phase 8+ |

---

## 16. Detailed Implementation Guide {#implementation-guide}

### P0 Actions (This Sprint) {#implementation-p0}

#### Fix DAV Header

**File**: [src/app/api/dav/method/options.rs](src/app/api/dav/method/options.rs)

```rust
// Current
"DAV" => "1, 2, 3, calendar-access, addressbook"

// Change to
"DAV" => "1, 3, calendar-access, addressbook"
```

**Rationale**: LOCK/UNLOCK not implemented, remove from advertised compliance

---

#### Implement supported-report-set Property

**Location**: [src/component/rfc/dav/core/property.rs](src/component/rfc/dav/core/property.rs)

**Implementation Approach**:
1. Add `supported-report-set` as computed live property
2. Return based on collection type:
   - **Calendar collections**: `calendar-query`, `calendar-multiget`, `sync-collection`
   - **Addressbook collections**: `addressbook-query`, `addressbook-multiget`, `sync-collection`
3. Return in PROPFIND responses

```xml
<D:supported-report-set xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CR="urn:ietf:params:xml:ns:carddav">
  <!-- For calendar collections -->
  <D:supported-report>
    <D:report><C:calendar-query/></D:report>
  </D:supported-report>
  <D:supported-report>
    <D:report><C:calendar-multiget/></D:report>
  </D:supported-report>
  <!-- Similar for CardDAV -->
</D:supported-report-set>
```

**Effort**: 4 hours
**Testing**: Unit test for property generation, integration test for PROPFIND response

---

#### Add need-privileges Error Element

**Location**: [src/app/api/dav/method/](src/app/api/dav/method/)

**Current Pattern**:
```rust
return Err(AppError::Forbidden);
```

**Enhance to**:
```rust
return Err(AppError::ForbiddenWithPrivileges {
    resources: vec![
        (href: resource_href, privilege: "read".into()),
    ],
});
```

**Response Generation**:
```rust
<D:error>
  <D:need-privileges>
    <D:resource>
      <D:href>/calendars/alice/work/</D:href>
      <D:privilege><D:read/></D:privilege>
    </D:resource>
  </D:need-privileges>
</D:error>
```

**Effort**: 6 hours
**Scope**: All methods that check authorization (PUT, DELETE, PROPFIND, REPORT, etc.)

---

#### Add supported-calendar-component-set Property

**Location**: [src/component/rfc/dav/core/property.rs](src/component/rfc/dav/core/property.rs)

**Implementation**:
```xml
<C:supported-calendar-component-set xmlns:C="urn:ietf:params:xml:ns:caldav">
  <C:comp name="VEVENT"/>
  <C:comp name="VTODO"/>
  <C:comp name="VJOURNAL"/>
</C:supported-calendar-component-set>
```

**Effort**: 2 hours

---

### P1 Actions (Next Sprint) {#implementation-p1}

#### Filter Capability Validation

**Architecture**:
1. Build filter capability registry at startup
   ```rust
   pub struct FilterCapabilities {
       comp_filters: HashMap<&'static str, Vec<&'static str>>,  // VCALENDAR → [VEVENT, VTODO]
       prop_filters: HashMap<&'static str, bool>,               // SUMMARY → true
       param_filters: HashMap<&'static str, bool>,              // TZID → true
   }
   ```

2. Add validation before query execution
   ```rust
   pub fn validate_filter(
       filter: &CalendarFilter,
       capabilities: &FilterCapabilities,
   ) -> Result<(), FilterValidationError>;
   ```

3. Return `supported-filter` error response:
   ```xml
   <D:error>
     <C:supported-filter>
       <C:prop-filter name="X-CUSTOM-PROP"/>
     </C:supported-filter>
   </D:error>
   ```

**Effort**: 8 hours

---

#### Selective iCalendar Serialization

**Current Pattern**:
```rust
serialize_ical_tree(tree) → full iCalendar → post-hoc filter
```

**New Pattern**:
```rust
fn serialize_with_selector(
    tree: &ComponentTree,
    selector: &CalendarDataRequest,
) -> Result<String> {
    // Traverse tree, only serialize requested components/properties
    // Respects RFC 5545 line folding, escaping
}
```

**Algorithm**:
1. Start at VCALENDAR
2. Include VERSION, PRODID (required by RFC 5545)
3. For each requested component type:
   - Traverse and serialize matching components
   - For each component, only include requested properties
4. Always include VTIMEZONE if referenced by TZID
5. Output with RFC 5545 compliance (line folding, escaping)

**Effort**: 12 hours (complex tree traversal + RFC output generation)

---

## 17. Specific RFC Requirements Matrix {#requirements-matrix}

### RFC 4791 Requirements Matrix {#requirements-caldav}

| Req Type | Feature | Status | Phase |
|----------|---------|--------|-------|
| MUST | Advertise CalDAV capability | ✅ Done | 0 |
| MUST | Support iCalendar | ✅ Done | 0 |
| MUST | Support WebDAV | ✅ Done | 0 |
| MUST | Support ACL | ✅ Done | 0 |
| MUST | Support MKCALENDAR | ✅ Done | 0 |
| MUST | Support ETags | ✅ Done | 0 |
| MUST | Advertise `supported-report-set` | ✅ Phase 0 | ✅ Complete |
| MUST | Advertise `supported-calendar-component-set` | ⚠️ Phase 1 | 1 |
| MUST | Advertise `supported-calendar-data` | ⚠️ Phase 1 | 1 |
| MUST | Return precondition errors | ⚠️ Phase 1 | 1 |
| SHOULD | Support calendar-data filtering | ⚠️ Phase 2 | 2 |
| SHOULD | Support text-match | ⚠️ Phase 1 | 1 |

### RFC 3744 Minimal Profile Requirements {#requirements-acl}

| Req Type | Feature | Status | Phase |
|----------|---------|--------|-------|
| MUST | Return `DAV:acl` property | ⚠️ Phase 1 | 1 |
| MUST | Return `DAV:current-user-privilege-set` | ✅ Done | 0 |
| MUST | Return `DAV:supported-privilege-set` | ⚠️ Phase 1 | 1 |
| MUST | Return `DAV:need-privileges` on 403 | ⚠️ Phase 1 | 1 |
| MUST NOT | Implement ACL method | ✅ Done | 0 |
| MUST NOT | Support deny ACEs | ✅ Done | 0 |

---

## 18. References {#references}

- RFC 4791 - CalDAV (Calendar Access Protocol) - §1-9, 14 detailed review
- RFC 6352 - CardDAV (vCard Extensions) - §3, 5-10 detailed review
- RFC 4918 - WebDAV (Web Distributed Authoring and Versioning) - §9, 18 detailed review
- RFC 3744 - WebDAV Access Control Protocol - §2-6, 8 detailed review
- RFC 5545 - iCalendar Format - §3.6, 3.8 detailed review
- RFC 6350 - vCard Format 4.0 - §6 detailed review
- RFC 5689 - Extended MKCOL for WebDAV
- RFC 6578 - Sync Collection (Incremental Sync) - §3, 4 detailed review
- RFC 4790 - LDAP Collation (i;unicode-casemap)
- RFC 7232 - HTTP Conditional Requests
- RFC 7231 - HTTP Semantics
- RFC 6868 - vCard Format - Parameter Value Encoding

---

**Document Version**: 3.0 (Comprehensive Merged Review)  
**Last Updated**: 2026-01-29  
**Status**: ✅ Complete with architectural assessment and deep analysis  
**Architectural Verdict**: ✅ No redesign needed - Protocol layer fixes only  
**Path to 85%**: ~40 hours of additive implementation

---

## Conclusion

**Shuriken's architectural decisions are fundamentally sound for RFC compliance.** The UUID-based storage, entity/instance separation, and component tree structure create a robust foundation.

The gaps are **purely at the protocol layer**: clients cannot discover capabilities because properties aren't returned, clients cannot understand why operations fail because error responses lack required XML elements, clients cannot optimize queries because filter capabilities aren't advertised.

**None of these require architectural redesign.** With focused implementation of ~40 hours of protocol-layer code, Shuriken can achieve 85%+ RFC compliance across CalDAV, CardDAV, WebDAV, and ACL.

The path forward is clear and manageable.
