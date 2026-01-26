# 5. HTTP Methods & Request Handling

## 5.1 Method Routing

**Implementation Path**: `src/app/api/caldav/` and `src/app/api/carddav/`

| Method | Collection | Resource | Description |
|--------|------------|----------|-------------|
| OPTIONS | ✓ | ✓ | Capability discovery |
| PROPFIND | ✓ | ✓ | Retrieve properties |
| PROPPATCH | ✓ | ✓ | Modify properties |
| GET | - | ✓ | Retrieve resource content |
| PUT | - | ✓ | Create/update resource |
| DELETE | ✓ | ✓ | Remove resource/collection |
| MKCALENDAR | - | - | Create calendar collection |
| MKCOL | - | - | Create address book collection (extended) |
| REPORT | ✓ | ✓ | Execute queries |
| COPY | ✓ | ✓ | Copy resource |
| MOVE | ✓ | ✓ | Move resource |
| LOCK | ✓ | ✓ | Lock resource (optional) |
| UNLOCK | ✓ | ✓ | Unlock resource (optional) |

## 5.2 OPTIONS Response

```http
HTTP/1.1 200 OK
Allow: OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, MKCALENDAR, MKCOL
DAV: 1, 3, access-control, calendar-access, addressbook
```

Only advertise what you actually implement:
- Include `2` in the `DAV:` header only if you implement WebDAV locking (`LOCK`/`UNLOCK`).
- Include `calendar-auto-schedule` only if you implement CalDAV auto-scheduling (RFC 6638).

If you support Extended MKCOL (RFC 5689), include `extended-mkcol` in the `DAV:` header on applicable collections.

## 5.3 PROPFIND Handling

Request body specifies which properties to retrieve:

```xml
<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:displayname/>
    <D:resourcetype/>
    <D:getetag/>
    <C:calendar-data xmlns:C="urn:ietf:params:xml:ns:caldav"/>
  </D:prop>
</D:propfind>
```

**Discovery Properties Clients Commonly Request**:
- `DAV:current-user-principal` (principal discovery)
- `CALDAV:calendar-home-set` / `CARDDAV:addressbook-home-set` (home collections)
- `DAV:supported-report-set` (RFC 3253; clients use this to decide which REPORTs to issue; advertise it accurately per collection/resource type, including `calendar-query`/`calendar-multiget`/`free-busy-query` for calendars, `addressbook-query`/`addressbook-multiget` for address books, `sync-collection` where supported, and `expand-property` where required by CardDAV)
- `DAV:sync-token` (RFC 6578; if you support sync)
- `CS:getctag` (Apple ecosystem; some clients still use this)

**Depth Header**:
- `0`: Target resource only
- `1`: Target + immediate children
- `infinity`: Target + all descendants (servers MAY reject)

## 5.4 PUT Handling

### 5.4.1 Creating New Resources

Client SHOULD use `If-None-Match: *` to prevent overwriting.

**Preconditions** (RFC 4791 §5.3.2.1):
- `CALDAV:supported-calendar-data`: Valid media type
- `CALDAV:valid-calendar-data`: Syntactically valid iCalendar
- `CALDAV:valid-calendar-object-resource`: Semantically valid
- `CALDAV:supported-calendar-component`: Component type allowed
- `CALDAV:no-uid-conflict`: UID not already in use
- `CALDAV:max-resource-size`: Size within limit
- `CALDAV:min-date-time` / `CALDAV:max-date-time`: Dates within range
- `CALDAV:max-instances`: Recurrence count within limit
- `CALDAV:max-attendees-per-instance`: Attendee count within limit

### 5.4.2 Updating Existing Resources

Client SHOULD use `If-Match: "etag"` for optimistic locking.

**ETag Generation**:
- MUST be strong validator
- Changes when resource content changes
- Consider: hash of canonical serialization, or `{entity_id}-{revision}`

## 5.5 DELETE Handling

- Delete resource and create tombstone for sync
- If collection, recursively delete contents
- Update `synctoken` on parent collection

## 5.6 MKCALENDAR Handling (RFC 4791 §5.3.1)

```xml
<?xml version="1.0" encoding="utf-8"?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set>
    <D:prop>
      <D:displayname>Work Calendar</D:displayname>
      <C:calendar-description>My work events</C:calendar-description>
      <C:supported-calendar-component-set>
        <C:comp name="VEVENT"/>
      </C:supported-calendar-component-set>
    </D:prop>
  </D:set>
</C:mkcalendar>
```

## 5.7 PROPPATCH Handling

Use PROPPATCH to update **writable** collection properties such as `DAV:displayname` and descriptions. Reject writes to protected properties.

- Return `207 Multi-Status` with per-property `propstat` results.
- Treat PROPPATCH as subject to the same ACL checks as other write operations (`DAV:write-properties`).
- For properties you do not recognize or do not allow, return `403 Forbidden` for that property in the multistatus.

## 5.8 Extended MKCOL for Address Books (RFC 5689)

Clients commonly create address books using Extended MKCOL with a request body that sets properties at creation time.

- Accept `MKCOL` with a `DAV:set` body.
- Support setting `DAV:displayname` and `CARDDAV:addressbook-description` at creation time.
- Validate that the resulting collection has the correct `DAV:resourcetype` including `DAV:collection` and `CARDDAV:addressbook`.

## 5.9 COPY and MOVE Handling

Implement COPY/MOVE primarily for interoperability (some clients use MOVE for renames).

- Enforce destination constraints (e.g., CardDAV `addressbook-collection-location-ok`).
- Ensure sync state is updated: bump sync tokens on source/target collections and create tombstones as needed.
- Preserve optimistic concurrency where possible (If-Match on source; handle overwrites explicitly).

---
