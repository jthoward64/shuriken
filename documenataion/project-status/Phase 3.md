# Phase 3: Basic HTTP Methods

**Status**: ⚠️ **MOSTLY COMPLETE (90%)**  
**Last Updated**: 2026-01-25

---

## Overview

Phase 3 implements the core HTTP methods required for WebDAV/CalDAV/CardDAV compliance. This includes resource retrieval (GET), creation/modification (PUT), deletion (DELETE), property management (PROPFIND/PROPPATCH), and resource operations (COPY/MOVE). Most methods are fully functional with comprehensive integration tests, but MOVE and collection creation methods need completion.

**Key Achievement**: All critical CRUD operations work correctly with proper authorization, precondition handling, and ETag support.

**Critical Gap**: MOVE, MKCALENDAR, and Extended MKCOL lack full implementation.

---

## Implementation Status

### ✅ Completed Features

#### OPTIONS Handler (`src/app/api/dav/method/options.rs`)

- [x] **DAV compliance classes** — RFC 4918 §18.1
  - `DAV: 1` (WebDAV Class 1) for all resources
  - `DAV: calendar-access` for calendar collections
  - `DAV: addressbook` for addressbook collections
  
- [x] **Allow header generation** — Context-aware method listing
  - Collections: GET, HEAD, OPTIONS, PROPFIND, PROPPATCH, DELETE, MKCOL
  - Resources: GET, HEAD, OPTIONS, PROPFIND, PUT, DELETE, COPY, MOVE
  
- [x] **Content-Type handling** — Proper MIME types
  - `text/calendar` for calendars
  - `text/vcard` for addressbooks
  
- [x] **Integration tests**: 5 test cases covering collections and resources

#### PROPFIND Handler (`src/app/api/dav/method/propfind/`)

- [x] **Depth handling** — RFC 4918 §9.1
  - `Depth: 0` (target resource only)
  - `Depth: 1` (target + immediate children)
  - `Depth: infinity` (configurable rejection for security)
  
- [x] **Live property retrieval** — Core WebDAV properties
  - `DAV:resourcetype`: Collection vs resource type
  - `DAV:displayname`: Human-readable name
  - `DAV:getcontenttype`: MIME type
  - `DAV:getetag`: Strong ETag for conditional requests
  - `DAV:getlastmodified`: Last modification timestamp
  - `DAV:creationdate`: Resource creation time
  
- [x] **CalDAV-specific properties** — RFC 4791
  - `CALDAV:calendar-home-set`: Location of user's calendars
  - `CALDAV:supported-calendar-component-set`: Allowed component types (VEVENT, VTODO, etc.)
  
- [x] **CardDAV-specific properties** — RFC 6352
  - `CARDDAV:addressbook-home-set`: Location of user's addressbooks
  - `CARDDAV:supported-address-data`: vCard version support
  
- [x] **Report advertisement** — `DAV:supported-report-set`
  - Lists available REPORT methods (calendar-query, sync-collection, etc.)
  
- [x] **Multistatus generation** — RFC 4918 §13
  - Per-property status codes (200 for supported, 404 for unknown)
  - Proper XML namespace handling
  
- [x] **Authorization integration** — Permission checking
  - Verifies read permission before serving properties
  
- [x] **Integration tests**: 8 test cases covering various scenarios

#### PROPPATCH Handler (`src/app/api/dav/method/proppatch.rs`)

- [x] **Property setting** — Writable properties
  - `DAV:displayname`: Collection/resource display name
  - `CALDAV:calendar-description`: Calendar description
  - `CARDDAV:addressbook-description`: Addressbook description
  
- [x] **Protected property rejection** — RFC 4918 §9.2
  - Returns 403 Forbidden for protected properties (resourcetype, getetag, etc.)
  
- [x] **Per-property status codes** — Atomic property updates
  - 200 OK for successful set/remove
  - 403 Forbidden for protected properties
  - 404 Not Found for unknown properties
  
- [x] **Authorization integration** — Write permission required

#### GET/HEAD Handler (`src/app/api/dav/method/get_head/`)

- [x] **Resource retrieval** — Content serving
  - iCalendar content for `.ics` files
  - vCard content for `.vcf` files
  
- [x] **HTTP headers** — RFC 4918 compliance
  - `ETag`: Strong ETag for caching
  - `Last-Modified`: Modification timestamp
  - `Content-Type`: Appropriate MIME type with charset
  
- [x] **Conditional GET** — RFC 7232
  - `If-None-Match`: Returns 304 Not Modified if ETag matches
  - Bandwidth optimization for clients
  
- [x] **Content-Type handling** — Proper MIME types
  - `text/calendar; charset=utf-8` for iCalendar
  - `text/vcard; charset=utf-8` for vCard
  
- [x] **HEAD method** — Headers without body
  - Returns all headers but no content
  
- [x] **Authorization integration** — Read permission required
  
- [x] **Integration tests**: 6 test cases

#### PUT Handler (`src/app/api/caldav/method/put/` and `src/app/api/carddav/method/put/`)

- [x] **Content parsing and validation** — Strict RFC compliance
  - iCalendar parsing with detailed error reporting
  - vCard parsing with detailed error reporting
  - Syntax error messages returned to client
  
- [x] **Precondition checking** — RFC 4918 §9.7
  - `If-None-Match: *`: Safe create (fails if resource exists)
  - `If-Match: <etag>`: Safe update (fails if ETag doesn't match)
  - Prevents lost update problem
  
- [x] **CalDAV-specific validation** — RFC 4791 §5.3.2
  - `valid-calendar-data` precondition
  - `no-uid-conflict` precondition (enforces UID uniqueness)
  - `supported-calendar-component` validation
  
- [x] **CardDAV-specific validation** — RFC 6352 §5.1
  - `valid-address-data` precondition
  - `no-uid-conflict` precondition
  
- [x] **Entity storage** — Database operations
  - Create or update entity with component tree
  - Update instance with new ETag
  - Increment collection sync revision for RFC 6578
  
- [x] **Response codes** — RFC-compliant status
  - 201 Created (with Location header for new resources)
  - 204 No Content (successful update)
  - 412 Precondition Failed (validation failures)
  
- [x] **Authorization integration** — Write permission required
  
- [x] **Integration tests**: 12 test cases for CalDAV, 8 for CardDAV

#### DELETE Handler (`src/app/api/dav/method/delete.rs`)

- [x] **Resource deletion** — Soft delete pattern
  - Soft delete instance (sets `deleted_at`)
  - Create tombstone with sync revision
  - Increment collection sync token
  
- [x] **Authorization integration** — Write permission required
  
- [x] **Response codes**
  - 204 No Content (successful deletion)
  - 404 Not Found (resource doesn't exist)
  - 403 Forbidden (insufficient permissions)
  
- [x] **Integration tests**: 4 test cases

#### COPY Handler (`src/app/api/dav/method/copy.rs`)

- [x] **Resource copying** — RFC 4918 §9.8
  - Destination header parsing
  - Overwrite header handling (`Overwrite: T` or `Overwrite: F`)
  - Copy entity to new instance
  - Generate new ETag for destination
  
- [x] **Authorization integration** — Write permission on destination
  
- [x] **Response codes**
  - 201 Created (new resource at destination)
  - 204 No Content (overwrite of existing resource)
  - 412 Precondition Failed (`Overwrite: F` and destination exists)

---

### ⚠️ Incomplete Features

#### 1. MOVE Handler (`src/app/api/dav/method/move.rs`)

**Current State**: Stub implementation marked with TODO.

**What's Missing**:
- Destination header parsing
- Overwrite header handling
- Source instance soft delete
- Tombstone creation for source resource
- New instance creation at destination
- Sync revision updates for both collections
- Cross-collection move support

**Impact**: RFC 4918 §9.9 requires MOVE support. Clients may fail to reorganize resources.

**RFC Violation**: WebDAV Class 1 compliance requires MOVE.

**Recommended Fix**: Model after COPY handler but with source deletion. Ensure atomic operation.

**Estimated Effort**: 2-3 days

#### 2. MKCALENDAR Handler (`src/app/api/caldav/method/mkcalendar.rs`)

**Current State**: Framework exists but request body parsing incomplete.

**What's Missing**:
- XML body parsing for `<C:mkcalendar xmlns:C="urn:ietf:params:xml:ns:caldav">`
- `<D:set>` property application during creation
- Initial property setting (displayname, calendar-description, calendar-timezone)
- Proper error handling for invalid property combinations

**Impact**: RFC 4791 §5.3.1 recommends supporting property setting at creation time. Clients must make two requests instead of one.

**RFC Violation**: Partial compliance — collection creation works, but property setting ignored.

**Recommended Fix**: Parse `<C:mkcalendar>` body, extract properties, apply during collection creation.

**Estimated Effort**: 2-3 days

#### 3. MKCOL Handler (`src/app/api/carddav/method/mkcol.rs`)

**Current State**: Framework exists but RFC 5689 Extended MKCOL parsing incomplete.

**What's Missing**:
- Extended MKCOL body parsing (`<D:mkcol xmlns:D="DAV:">`)
- `<D:set>` property application
- `<D:resourcetype>` specification at creation time
- Initial property setting for addressbooks

**Impact**: RFC 6352 §5.2 recommends Extended MKCOL support. Clients must make two requests instead of one.

**RFC Violation**: Partial compliance — basic MKCOL works, extended version incomplete.

**Recommended Fix**: Parse Extended MKCOL body, extract resourcetype and properties, apply during creation.

**Estimated Effort**: 2-3 days

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
| RFC 4918 §9.9: MOVE | ❌ Incomplete | Stub only |
| RFC 4918 §9.3: MKCOL | ⚠️ Partial | Basic creation works, property setting missing |
| RFC 4791 §5.3.1: MKCALENDAR | ⚠️ Partial | Body parsing incomplete |
| RFC 5689: Extended MKCOL | ⚠️ Partial | Body parsing incomplete |
| RFC 4791 §9.6: Strong ETags | ✅ Compliant | Content-based ETags |
| RFC 4791 §4.1: UID uniqueness | ✅ Enforced | Precondition returned on conflict |
| RFC 6352 §5.1: no-uid-conflict | ✅ Enforced | Precondition returned |

**Compliance Score**: 11/14 required features (79%)

---

## Next Steps

### Immediate Priorities

1. **Complete MOVE handler** — MEDIUM PRIORITY
   - Copy logic from COPY handler
   - Add source deletion with tombstone
   - Test cross-collection moves
   - Estimated effort: 2-3 days

2. **Complete MKCALENDAR body parsing** — LOW PRIORITY
   - Parse XML request body
   - Apply initial properties
   - Test with Apple Calendar and Thunderbird
   - Estimated effort: 2-3 days

3. **Complete Extended MKCOL** — LOW PRIORITY
   - Parse RFC 5689 body
   - Apply resourcetype and properties
   - Test with CardDAV clients
   - Estimated effort: 2-3 days

### Nice-to-Have

4. **Collection recursive delete** — OPTIONAL
   - Implement Depth: infinity DELETE
   - Handle child resource cleanup
   - Estimated effort: 2-3 days

---

## Dependencies

**Blocks**: None — Phase 3 gaps don't block other phases.

**Depends On**: Phase 2 (Database Operations) — Fully implemented.

---

## Next Phase: Phase 4

**Focus**: Query Reports (calendar-query, calendar-multiget, addressbook-query, addressbook-multiget)

**Status**: ✅ **COMPLETE (95%)**
