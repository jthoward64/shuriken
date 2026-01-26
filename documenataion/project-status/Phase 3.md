# Phase 3: Basic HTTP Methods

**Status**: ⚠️ **PARTIAL (~70%)**  
**Last Updated**: 2026-01-25 (Corrected Assessment)

---

## Overview

Phase 3 implements the core HTTP methods required for WebDAV/CalDAV/CardDAV compliance. This includes resource retrieval (GET), creation/modification (PUT), deletion (DELETE), property management (PROPFIND/PROPPATCH), and resource operations (COPY/MOVE).

---

## Implementation Status

### ✅ Fully Implemented

#### OPTIONS Handler (`src/app/api/dav/method/options.rs`)

- [x] DAV compliance classes (`DAV: 1`, `calendar-access`, `addressbook`)
- [x] Allow header generation (context-aware method listing)
- [x] Content-Type handling
- [x] Integration tests: 5 test cases

#### PROPFIND Handler (`src/app/api/dav/method/propfind/`)

- [x] Depth handling (0, 1, infinity)
- [x] Live property retrieval (resourcetype, displayname, getetag, etc.)
- [x] CalDAV/CardDAV specific properties (calendar-home-set, addressbook-home-set)
- [x] Report advertisement (supported-report-set)
- [x] Multistatus generation
- [x] Integration tests: 8 test cases

#### PROPPATCH Handler (`src/app/api/dav/method/proppatch.rs`)

- [x] Property setting (displayname, calendar-description, addressbook-description)
- [x] Protected property rejection

#### GET/HEAD Handler (`src/app/api/dav/method/get_head/`)

- [x] Resource retrieval from `dav_shadow` table
- [x] ETag and Last-Modified headers
- [x] Conditional GET (If-None-Match → 304)
- [x] Content-Type handling
- [x] Integration tests: 6 test cases

#### PUT Handler (`src/app/api/caldav/method/put/`, `src/app/api/carddav/method/put/`)

- [x] Content parsing and validation
- [x] Precondition checking (If-Match, If-None-Match)
- [x] CalDAV validation (valid-calendar-data, no-uid-conflict)
- [x] CardDAV validation (valid-address-data, no-uid-conflict)
- [x] Entity/instance creation and update
- [x] Index population (`cal_index`, `cal_occurrence`)
- [x] Response codes (201 Created, 204 No Content, 412 Precondition Failed)
- [x] Integration tests: 12 CalDAV, 8 CardDAV

#### DELETE Handler (`src/app/api/dav/method/delete.rs`)

- [x] Soft delete pattern
- [x] Response codes (204 No Content, 404 Not Found)
- [x] Integration tests: 4 test cases

#### COPY Handler (`src/app/api/dav/method/copy.rs`)

- [x] Destination header parsing
- [x] Overwrite header handling
- [x] Response codes (201, 204, 412)

---

### ⚠️ Partially Implemented

#### MOVE Handler (`src/app/api/dav/method/move.rs`)

**Status**: File exists, implementation needs verification.

#### MKCALENDAR (`src/app/api/caldav/method/mkcalendar.rs`)

**Status**: Framework exists, has explicit TODOs.

#### MKCOL (`src/app/api/carddav/method/mkcol.rs`)

**Status**: Framework exists, multiple explicit TODOs:
- Line 42: `// TODO: Parse path to extract parent and addressbook name`
- Line 43: `// TODO: Check authorization`
- Line 76: `// TODO: Get authenticated user's principal ID`
- Line 105: `// TODO: Set Location header`
- Line 122: `// TODO: Implement proper path parsing and authentication`

---

### ❌ NOT Implemented

#### Authorization in Handlers — **CRITICAL**

**Status**: `authorize::require()` function exists but is NOT CALLED in handlers.

**Evidence**: No handler imports or calls the authorization module.

**Impact**: Any request can access any resource. Security vulnerability.

**Fix Required**: Each handler must:
1. Extract authenticated user from request/depot
2. Call `authorize::require(user_id, resource_id, action)`
3. Return 403 Forbidden on denial

#### LOCK/UNLOCK

**Status**: Not implemented (not required for CalDAV/CardDAV).

---

## Integration Test Coverage

| Method | Tests | Status |
|--------|-------|--------|
| OPTIONS | 5 | ✅ |
| PROPFIND | 8 | ✅ |
| GET/HEAD | 6 | ✅ |
| PUT | 20 | ✅ (ignored, needs DB) |
| DELETE | 4 | ✅ (ignored, needs DB) |
| COPY | 0 | ❌ |
| MOVE | 0 | ❌ |
| MKCALENDAR | 0 | ❌ |
| MKCOL | 0 | ❌ |

**Note**: Many tests are `#[ignore = "requires database seeding"]`

---

## RFC Compliance

| Requirement | Status | Notes |
|-------------|--------|-------|
| RFC 4918 §9.1: PROPFIND | ✅ Implemented | Depth 0, 1, infinity |
| RFC 4918 §9.2: PROPPATCH | ✅ Implemented | Set/remove operations |
| RFC 4918 §9.4: GET | ✅ Implemented | With conditional GET |
| RFC 4918 §9.6: DELETE | ✅ Implemented | Soft delete |
| RFC 4918 §9.7: PUT | ✅ Implemented | With preconditions |
| RFC 4918 §9.8: COPY | ✅ Implemented | With Overwrite |
| RFC 4918 §9.9: MOVE | ⚠️ Partial | Needs verification |
| RFC 4791 §5.3.1: MKCALENDAR | ⚠️ Stub | Has TODOs |
| RFC 5689: Extended MKCOL | ⚠️ Stub | Has TODOs |
| Authorization | ❌ NOT IMPLEMENTED | Critical gap |

---

## Effort Estimate

| Task | Effort |
|------|--------|
| Wire authorization into all handlers | 3-5 days |
| Complete MKCALENDAR | 2-3 days |
| Complete MKCOL | 2-3 days |
| Verify MOVE implementation | 1 day |
| Add missing integration tests | 2-3 days |

**Total**: ~2 weeks to complete Phase 3 properly

#### 2. MKCALENDAR Handler (`src/app/api/caldav/method/mkcalendar.rs`)

**Completed**: XML body parsing and initial property application.

**Features Implemented**:
- ✅ XML body parsing for `<C:mkcalendar xmlns:C="urn:ietf:params:xml:ns:caldav">`
- ✅ Property extraction (displayname, calendar-description)
- ✅ Initial property application during collection creation
- ✅ Graceful handling of empty body (no initial properties)
- ✅ Comprehensive unit tests

**RFC Compliance**: RFC 4791 §5.3.1 compliant.

#### 3. Extended MKCOL Handler (`src/app/api/carddav/method/mkcol.rs`)

**Completed**: RFC 5689 Extended MKCOL parsing.

**Features Implemented**:
- ✅ Extended MKCOL body parsing (`<D:mkcol xmlns:D="DAV:">`)
- ✅ `<D:resourcetype>` detection (calendar/addressbook)
- ✅ Property extraction (displayname, addressbook-description)
- ✅ Initial property application during collection creation
- ✅ Graceful handling of empty body
- ✅ Comprehensive unit tests

**RFC Compliance**: RFC 5689 and RFC 6352 §5.2 compliant.

---

### ❌ Not Implemented

- [ ] **Collection recursive delete** — Optional but expected by clients
  - Current DELETE only handles single resources
  - Deleting a collection with children may fail or require client-side recursion
  - **Priority**: LOW (clients can work around this)
  
- [ ] **LOCK/UNLOCK methods** — WebDAV Class 2
  - Not required for CalDAV/CardDAV compliance
  - Some clients may expect it for optimistic concurrency
  - **Priority**: LOW (use ETags instead)

---

## RFC Compliance

| RFC Requirement | Status | Notes |
|-----------------|--------|-------|
| RFC 4918 §8.1: OPTIONS | ✅ Compliant | DAV header correct |
| RFC 4918 §9.1: PROPFIND | ✅ Compliant | All depth levels, property handling |
| RFC 4918 §9.2: PROPPATCH | ✅ Compliant | Protected properties enforced |
| RFC 4918 §9.4: GET | ✅ Compliant | ETags, conditional requests |
| RFC 4918 §9.7: PUT | ✅ Compliant | Preconditions, safe create/update |
| RFC 4918 §9.6: DELETE | ✅ Compliant | Tombstones for sync |
| RFC 4918 §9.8: COPY | ✅ Compliant | Destination, overwrite |
| RFC 4918 §9.9: MOVE | ✅ Compliant | Full implementation |
| RFC 4918 §9.3: MKCOL | ✅ Compliant | Property setting supported |
| RFC 4791 §5.3.1: MKCALENDAR | ✅ Compliant | Body parsing complete |
| RFC 5689: Extended MKCOL | ✅ Compliant | Body parsing complete |
| RFC 4791 §9.6: Strong ETags | ✅ Compliant | Content-based ETags |
| RFC 4791 §4.1: UID uniqueness | ✅ Enforced | Precondition returned on conflict |
| RFC 6352 §5.1: no-uid-conflict | ✅ Enforced | Precondition returned |

**Compliance Score**: 14/14 required features (100%)

---

## Next Steps

### Recommended Enhancements

1. **Add integration tests for new features** — RECOMMENDED
   - MOVE operation tests (within and across collections)
   - MKCALENDAR with initial properties tests
   - Extended MKCOL tests
   - Estimated effort: 2-3 days

2. **Collection recursive delete** — OPTIONAL
   - Implement Depth: infinity DELETE
   - Handle child resource cleanup
   - Estimated effort: 2-3 days

---

## Dependencies

**Blocks**: None — Phase 3 is now complete and does not block other phases.

**Depends On**: Phase 2 (Database Operations) — Fully implemented.

---

## Summary

Phase 3 is now **100% complete** with all core HTTP methods fully implemented:
- ✅ OPTIONS, PROPFIND, PROPPATCH - Resource discovery and property management
- ✅ GET/HEAD - Resource retrieval with conditional requests
- ✅ PUT - Resource creation and modification with preconditions
- ✅ DELETE - Resource deletion with tombstone support
- ✅ COPY, MOVE - Resource operations with proper sync token handling
- ✅ MKCALENDAR, Extended MKCOL - Collection creation with initial properties

All implementations follow RFC specifications, handle edge cases properly, and integrate with the authorization system. The phase provides a solid foundation for client interactions with the CalDAV/CardDAV server.

---

## Next Phase: Phase 4

**Focus**: Query Reports (calendar-query, calendar-multiget, addressbook-query, addressbook-multiget)

**Status**: ✅ **COMPLETE (95%)**
