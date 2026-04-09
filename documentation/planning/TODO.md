# Implementation Completeness Audit

Evaluated against: RFC 4918, RFC 3744, RFC 5689, RFC 6578, RFC 4791, RFC 6638, RFC 7809, RFC 6352, RFC 6764, RFC 5545, RFC 6350.

Items marked **BUG** are confirmed defects in existing code. Items marked **MISSING** are unimplemented features. Items are roughly ordered by importance for client compatibility.

Once an item is complete, it should be deleted from this list (not checked or marked done)

---

## RFC 4918 — WebDAV Core

### MISSING: COPY does not transfer dead properties or ACL entries

[copy.ts:165-193](src/http/dav/methods/copy.ts#L165-L193), [copy.ts:253-315](src/http/dav/methods/copy.ts#L253-L315) — When copying an instance or collection, `clientProperties` (dead properties) are not passed to the new row. RFC 4918 §9.8.2 says a COPY SHOULD preserve all live and dead properties. In addition, ACL entries (from `dav_acl`) on the source collection are not copied to the destination — the destination starts with only the owner's protected `DAV:all` ACE.

### MISSING: `DAV:getcontentlength` not returned for instances

RFC 4918 §15.4 — Instance PROPFIND responses omit `DAV:getcontentlength`. Clients may need this to know data sizes before downloading. Should reflect the serialized body length.

### MISSING: `DAV:allprop` + `DAV:include` not supported

RFC 4918 §9.1 — Clients may combine `<allprop/>` with an `<include>` element to request additional properties not returned by allprop by default (e.g., `CALDAV:calendar-data`). The `parsePropfindBody` function does not parse `<include>`.

### MISSING: PROPFIND on `/dav/` root and `/dav/principals/` returns 404

[propfind.ts:238-258](src/http/dav/methods/propfind.ts#L238-L258) — `root` and `principalCollection` path kinds are 404'd. Clients that start discovery at `/dav/` (via `.well-known` redirect) need to PROPFIND the root to find `CALDAV:calendar-home-set` or follow `DAV:current-user-principal`.

### MISSING: COPY does not preserve dead properties

RFC 4918 §9.8.2 — When COPYing a resource, dead properties (clientProperties) should be copied to the destination. Currently only the component tree and instance metadata are copied; `clientProperties` is not transferred.

### MISSING: GET/HEAD does not handle conditional request headers

RFC 7232 §3 — The GET handler never inspects `If-None-Match` or `If-Modified-Since`. A client that already has the resource can send `If-None-Match: "etag"` to receive a 304 Not Modified instead of re-downloading the full body. Many CalDAV clients rely on this to avoid redundant transfers during sync. The current implementation always returns 200 with the full body.

### MISSING: GET response does not set `Content-Length`

[get.ts:130-134](src/http/dav/methods/get.ts#L130-L134) — The GET response omits the `Content-Length` header. While not strictly required for chunked transfer, many CalDAV clients and proxies expect it.

---

## RFC 3744 — WebDAV ACL

### MISSING: ACL-related properties not returned in PROPFIND

RFC 3744 §5 — The following properties should be discoverable via PROPFIND but are not returned:

- `DAV:acl` (§5.5) — the actual ACE list for the resource
- `DAV:owner` (§5.1) — the principal that owns the resource

Many clients (especially Apple Calendar) require these to fully administer access control.

### MISSING: `DAV:group-member-set` / `DAV:group-membership` not returned

RFC 3744 §4.3, §4.4 — Group principals should return `DAV:group-member-set` (their members), and user principals should return `DAV:group-membership` (groups they belong to). Neither is exposed through PROPFIND.


### MISSING: `DAV:principal-match` REPORT not implemented

RFC 3744 §9.3 — Clients use this REPORT to find all resources in a collection that are associated with the current user principal. Not dispatched in [report.ts](src/http/dav/methods/report.ts).

### MISSING: `DAV:principal-property-search` REPORT not implemented

RFC 3744 §9.4 — Clients use this to search principals by property values (e.g., search by display name or email). Not dispatched in [report.ts](src/http/dav/methods/report.ts).

### MISSING: `DAV:alternate-URI-set` not returned for principals

RFC 3744 §4.1 — Principals should expose an `alternate-URI-set` property listing other URLs that resolve to the same principal (e.g., email addresses as `mailto:` URIs). Omitting this makes address resolution for scheduling harder.

---

## RFC 4791 — CalDAV

### MISSING: `CALDAV:calendar-timezone` not returned in PROPFIND

RFC 4791 §5.2.2 — Calendar collections have a `timezoneTzid` field in the database schema but this is never exposed as `CALDAV:calendar-timezone` in PROPFIND responses. Clients use this to know the default timezone for the collection and for floating-time event interpretation.

### MISSING: `CALDAV:max-resource-size`, date/instance limit properties not returned

RFC 4791 §5.2.5–5.2.9 — The database schema stores `maxResourceSize`, `minDateTime`, `maxDateTime`, `maxInstances`, `maxAttendeesPerInstance`, but none are returned in PROPFIND and none are enforced during PUT. Clients that query for these will get 404 propstat; servers that should reject oversized/out-of-range data silently accept it.

### MISSING: `CALDAV:supported-collation-set` not returned for calendar collections

RFC 4791 §5.2.10 — Clients need to know which collations are supported for `<text-match>` filters. The server supports `i;ascii-casemap` and `i;unicode-casemap` but does not advertise them.

### MISSING: UID uniqueness not enforced within a calendar collection

RFC 4791 §5.3.2 — "A calendar object resource MUST NOT specify an iCalendar UID property value that already exists in a calendar collection." The PUT handler does not check for duplicate UIDs (with the exception of the same resource being updated). Two separate PUT requests with the same UID will create two separate resources.

### MISSING: `CALDAV:supported-calendar-component` not enforced on PUT

RFC 4791 §5.2.3 — When a calendar collection only supports e.g. VEVENT (as declared in `supported-calendar-component-set`), a PUT of a VTODO resource should be rejected with 403 `CALDAV:supported-calendar-component`. The PUT handler does not read `supportedComponents` from the collection row and accepts any component type unconditionally.

### MISSING: CalDAV PUT does not validate calendar object resource semantics

RFC 4791 §4.1 and §5.3.2 — Two semantic validation rules are not enforced at PUT time, both of which should fail with `CALDAV:valid-calendar-object-resource` (403):

1. **Empty VCALENDAR**: A VCALENDAR with no child components (no VEVENT, VTODO, etc.) should be rejected. Currently stored and served as-is.
2. **Mixed UIDs**: All components within a single calendar object resource MUST share the same UID (recurrence exceptions are identified by RECURRENCE-ID on a component with the same UID). Two VEVENTs with different UIDs in one PUT body are silently accepted.

### MISSING: `CALDAV:calendar-timezone` not settable via PROPPATCH

RFC 4791 §5.2.2 — `CALDAV:calendar-timezone` is a writable property that clients may set to indicate the default timezone for a calendar collection. The database stores `timezoneTzid` on `dav_collection` but `COLLECTION_LIVE_PROPS` in [proppatch.ts:58-71](src/http/dav/methods/proppatch.ts#L58-L71) does not include this property, so it falls through to dead-property handling (stored as raw XML, not as `timezoneTzid`). This means the timezone is never read back during event interpretation.

### MISSING: `CALDAV:free-busy-query` REPORT not implemented

RFC 4791 §7.10 — Allows clients to query free/busy time over a calendar collection without fetching individual events. Not dispatched in [report.ts](src/http/dav/methods/report.ts).


### INCOMPLETE: VTODO time-range filter does not follow RFC 4791 §9.9 rules

[filter-cal.ts:294-327](src/http/dav/methods/report/filter-cal.ts#L294-L327) — `evalComponentTimeRange` uses DTSTART and DTEND/DUE, which approximately works for VEVENT. For VTODO the spec defines different matching rules depending on which combination of DTSTART, DUE, DURATION, and COMPLETED are present. Specifically:
- A VTODO with neither DTSTART nor DUE always matches any time range.
- A VTODO with COMPLETED must match when COMPLETED falls within the range.
- The rule table in RFC 4791 §9.9 has ~8 distinct cases for VTODO.


### INCOMPLETE: VFREEBUSY time-range filter not specifically handled

RFC 4791 §9.9 — VFREEBUSY components should be matched on their DTSTART/DTEND pair directly. The current implementation falls through to the general case, which may work, but is not verified against the spec's exact wording.

---

## RFC 6638 — CalDAV Scheduling

Scheduling infrastructure exists at the schema level (`dav_schedule_message`, inbox/outbox collection types) but is almost entirely unimplemented at the HTTP layer.

### MISSING: Provisioning creates no scheduling inbox or outbox collections

[service.live.ts:36-50](src/services/provisioning/service.live.ts#L36-L50) — `provisionUser` creates only a primary calendar and primary addressbook. RFC 6638 §2.2 requires every CalDAV principal to have a scheduling inbox and outbox collection. Without them, scheduling-aware clients (Apple Calendar, Thunderbird) cannot function. The `dav_collection` schema supports `collectionType: "inbox"` and `"outbox"`, but no provisioning code creates them.

### MISSING: POST to scheduling outbox not supported

RFC 6638 §3.3 — Clients send `POST` to the scheduling outbox to trigger free-busy queries and to send iTIP messages. `POST` is not in the `Allow` header and has no handler in the router.

### MISSING: Scheduling auto-delivery not implemented

RFC 6638 §3.4 — When a resource containing `ORGANIZER`/`ATTENDEE` is PUT to a calendar, the server must process iTIP scheduling messages (deliver `REQUEST` to attendee inboxes, etc.). The PUT handler does not trigger any scheduling logic.

### MISSING: `CALDAV:schedule-inbox-url` / `CALDAV:schedule-outbox-url` not in PROPFIND

RFC 6638 §2.2 — Principal PROPFIND should include these properties pointing to the inbox and outbox collection URLs. Clients cannot find the scheduling endpoints without them.

### MISSING: `CALDAV:calendar-free-busy-set` property not implemented

RFC 6638 §2.1 — Each principal's calendar home should identify which calendars contribute to free-busy via this property. Not stored or returned.

---

## RFC 6352 — CardDAV

### MISSING: `CARDDAV:max-resource-size` not returned in PROPFIND

RFC 6352 §6.2.3 — Addressbook collections should advertise the maximum vCard size accepted by the server. Not returned in PROPFIND.

### MISSING: `CARDDAV:supported-collation-set` not returned for addressbook collections

RFC 6352 §6.2.3 — Clients need to know which collations are supported for `<text-match>` filters. The server supports `i;ascii-casemap` and `i;unicode-casemap` but does not advertise them.

### MISSING: UID uniqueness not enforced within an addressbook collection

RFC 6352 §5.1 — "The server MUST ensure that the 'UID' content line value is unique within the address book collection." The PUT handler does not check for duplicate UIDs.

---

## RFC 6578 — Collection Synchronization

### BUG: MOVE does not create a tombstone in the source collection

[move.ts:145-150](src/http/dav/methods/move.ts#L145-L150), [repository.live.ts:208-243](src/services/instance/repository.live.ts#L208-L243) — When an instance is MOVEd, `instanceRepo.relocate` issues an UPDATE that changes `collectionId` and `slug` but does NOT set `deleted_at`. The DB trigger `sync_token_before_instance_change` fires on the UPDATE, but:

1. It increments the **destination** collection's synctoken (using `NEW.collection_id`) and sets `sync_revision`.
2. The source collection's synctoken is **never incremented**.
3. The tombstone creation branch (`NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL`) is never triggered since `deleted_at` is not changed.

Result: clients that had previously synced the source collection will never be told the resource was removed. A subsequent `sync-collection` REPORT on the source collection will not include a 404 entry for the moved resource, violating RFC 6578 §6.1. Fix: before calling `relocate`, soft-delete the instance in the source collection (which creates the tombstone and increments the source synctoken), then insert a new instance at the destination.

### MISSING: `<DAV:sync-level>` element not validated in sync-collection REPORT

RFC 6578 §6.4 — Clients must include `<sync-level>1</sync-level>` in the request body; the server must reject requests with unsupported levels. The handler reads `sync-token` but ignores `sync-level` entirely.

---

## RFC 7809 — Timezones by Reference

This RFC is referenced in the index but has no implementation beyond the timezone cache (`cal_timezone` table used during PUT).

### MISSING: `CALDAV:timezone-service-set` property not implemented

RFC 7809 §4 — Servers that support timezones by reference advertise their timezone service URL via this property. Not stored or returned.

### MISSING: `CALDAV:calendar-timezone-id` property not implemented

RFC 7809 §4.1 — Alternative to `CALDAV:calendar-timezone` using a TZID string reference rather than a full VTIMEZONE component. Not stored or returned.

### MISSING: Timezone-by-reference strip/inject not implemented

RFC 7809 §4.3 — When a client indicates it supports timezones by reference (via `CalDAV-Timezones: T` header), the server should strip VTIMEZONE components from responses and inject TZID-only references. Not implemented.

---

## RFC 6764 — Service Discovery

### MISSING: `.well-known` PROPFIND returns 404 instead of redirecting

RFC 6764 §5 — Clients use PROPFIND on `/.well-known/caldav` and `/.well-known/carddav` to bootstrap service discovery. The server should respond with a 301/302 redirect to the principal URL (or serve the principal properties directly). Currently `parseDavPath` maps these paths to `{kind: "wellknown"}`, which the PROPFIND handler returns 404 for. Additionally, even if a redirect to `/dav/` were implemented, PROPFIND on `/dav/` also returns 404 (see root PROPFIND issue above). Both layers of the discovery chain need to work.

---

## Summary by Priority

| Priority | Item |
|----------|------|
| P1 | `DAV:acl` / `DAV:owner` not in PROPFIND |
| P1 | `CALDAV:schedule-inbox-url` / `CALDAV:schedule-outbox-url` not in PROPFIND |
| P1 | `CALDAV:calendar-timezone` not in PROPFIND (and not settable via PROPPATCH) |
| P1 | `CALDAV:supported-calendar-component` not enforced on PUT |
| P2 | UID uniqueness enforcement (calendar and addressbook) |
| P2 | CalDAV PUT semantic validation (`valid-calendar-object-resource`) — empty VCALENDAR, mixed UIDs |
| P2 | VTODO time-range filter completeness |
| P2 | `DAV:group-member-set` / `DAV:group-membership` not in PROPFIND |
| P2 | `CALDAV:free-busy-query` REPORT missing |
| P2 | `DAV:principal-match` / `DAV:principal-property-search` REPORTs missing |
| P2 | Collection constraints not enforced during PUT |
| P2 | Root PROPFIND returns 404 |
| P3 | COPY does not transfer dead properties or ACL entries |
| P1 | MOVE does not create tombstone in source collection — RFC 6578 delta sync broken for source |
| P3 | `sync-level` not validated in sync-collection |
| P3 | `CALDAV:max-resource-size` and limit properties not returned |
| P3 | Collation set properties not returned |
| P3 | `DAV:getcontentlength` not returned for instances |
| P3 | GET/HEAD does not handle conditional request headers (`If-None-Match`, `If-Modified-Since`) |
| P3 | GET does not set `Content-Length` |
| P3 | `allprop` + `include` not supported |
| P4 | RFC 7809 (timezones by reference) — full implementation |
| P2 | Provisioning creates no scheduling inbox/outbox collections |
| P4 | CalDAV scheduling (RFC 6638) — POST to outbox, auto-delivery |
