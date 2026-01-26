# Phase 3: Basic HTTP Methods

**Status**: ⚠️ **PARTIAL (~60%)**  
**Last Updated**: 2026-01-26

---

## Overview

Phase 3 implements the core HTTP methods required for WebDAV/CalDAV/CardDAV compliance. This includes resource retrieval (GET), creation/modification (PUT), deletion (DELETE), property management (PROPFIND/PROPPATCH), and resource operations (COPY/MOVE).

---

## Implementation Status

### ✅ Implemented (functional, missing authorization wiring)

#### OPTIONS Handler ([src/app/api/dav/method/options.rs](src/app/api/dav/method/options.rs))

- [x] DAV compliance classes (`DAV: 1`, `calendar-access`, `addressbook`)
- [x] Allow header generation (context-aware method listing)
- [x] Content-Type handling

#### PROPFIND Handler ([src/app/api/dav/method/propfind/](src/app/api/dav/method/propfind/))

- [x] Depth handling (0, 1, infinity)
- [x] Live property retrieval (resourcetype, displayname, getetag, etc.)
- [x] CalDAV/CardDAV specific properties (calendar-home-set, addressbook-home-set)
- [x] Report advertisement (supported-report-set)
- [x] Multistatus generation

#### PROPPATCH Handler ([src/app/api/dav/method/proppatch.rs](src/app/api/dav/method/proppatch.rs))

- [x] Property setting (displayname, calendar-description, addressbook-description)
- [x] Protected property rejection

#### GET/HEAD Handler ([src/app/api/dav/method/get_head/](src/app/api/dav/method/get_head/))

- [x] Component tree reconstruction (`get_entity_with_tree()` + serializers)
- [x] ETag and Last-Modified headers
- [x] Conditional GET (If-None-Match → 304)
- [x] Content-Type handling

#### PUT Handler ([src/app/api/caldav/method/put/](src/app/api/caldav/method/put/), [src/app/api/carddav/method/put/](src/app/api/carddav/method/put/))

- [x] Content parsing and validation
- [x] Precondition checking (If-Match, If-None-Match)
- [x] CalDAV validation (valid-calendar-data, no-uid-conflict)
- [x] CardDAV validation (valid-address-data, no-uid-conflict)
- [x] Entity/instance creation and update
- [x] Index population (`cal_index`, `cal_occurrence`, `card_index`)
- [x] Response codes (201 Created, 204 No Content, 412 Precondition Failed)

#### DELETE Handler ([src/app/api/dav/method/delete.rs](src/app/api/dav/method/delete.rs))

- [x] Soft delete pattern + tombstone creation
- [x] Response codes (204 No Content, 404 Not Found, 412 Precondition Failed)

### ⚠️ Partially Implemented / Stubbed

#### MOVE Handler ([src/app/api/dav/method/move.rs](src/app/api/dav/method/move.rs))

**Status**: Logic implemented (transaction, sync-token bump, tombstone) but missing authorization and test coverage.

#### COPY Handler ([src/app/api/dav/method/copy.rs](src/app/api/dav/method/copy.rs))

**Status**: Only header parsing + response stub. No DB copy, overwrite handling, or sync-token updates.

#### MKCALENDAR ([src/app/api/caldav/method/mkcalendar.rs](src/app/api/caldav/method/mkcalendar.rs))

**Status**: Parses body and creates collection but uses placeholder owner, lacks path parsing, authorization, and Location header.

#### MKCOL ([src/app/api/carddav/method/mkcol.rs](src/app/api/carddav/method/mkcol.rs))

**Status**: Same gaps as MKCALENDAR (placeholder owner, path parsing TODOs, authorization missing, no Location header).

### ❌ Critical Gaps

#### Authorization in Handlers — **CRITICAL**

**Status**: Authorization is not wired in any handler (explicit TODOs in multiple handlers).

**Impact**: Any request can access any resource. Security vulnerability.

---

## Integration Test Coverage

| Method | Status |
|--------|--------|
| OPTIONS | ✅ |
| PROPFIND | ✅ |
| GET/HEAD | ✅ |
| PUT | ✅ (ignored, DB required) |
| DELETE | ✅ (ignored, DB required) |
| COPY | ❌ |
| MOVE | ❌ |
| MKCALENDAR | ❌ |
| MKCOL | ❌ |

---

## RFC Compliance (Current State)

| Requirement | Status | Notes |
|-------------|--------|-------|
| RFC 4918 §9.1: PROPFIND | ✅ Implemented | Depth 0, 1, infinity |
| RFC 4918 §9.2: PROPPATCH | ✅ Implemented | Limited to displayname/description |
| RFC 4918 §9.4: GET | ✅ Implemented | Conditional GET supported |
| RFC 4918 §9.6: DELETE | ✅ Implemented | Tombstones + sync-token bump |
| RFC 4918 §9.7: PUT | ✅ Implemented | Preconditions + validations |
| RFC 4918 §9.8: COPY | ❌ Stub | No DB copy logic |
| RFC 4918 §9.9: MOVE | ⚠️ Partial | Missing auth + tests |
| RFC 4791 §5.3.1: MKCALENDAR | ⚠️ Partial | Placeholder owner + missing auth/Location |
| RFC 5689: Extended MKCOL | ⚠️ Partial | Placeholder owner + missing auth/Location |
| Authorization | ❌ NOT IMPLEMENTED | Critical gap |

---

## Effort Estimate

| Task | Effort |
|------|--------|
| Wire authorization into all handlers | 3-5 days |
| Complete COPY logic | 2-3 days |
| Complete MKCALENDAR + MKCOL path/auth/Location | 2-3 days |
| Add missing integration tests | 2-3 days |

**Total**: ~2 weeks to complete Phase 3

---

## Summary

Phase 3 is **not complete**. Core methods (OPTIONS, PROPFIND, PROPPATCH, GET/HEAD, PUT, DELETE) are functional but **authorization is missing**, and COPY/MKCALENDAR/MKCOL are still stubs. MOVE logic exists but also lacks authorization and tests.

---

## Next Phase: Phase 4

**Focus**: Query Reports (calendar-query, calendar-multiget, addressbook-query, addressbook-multiget)

**Status**: See Phase 4 status document
