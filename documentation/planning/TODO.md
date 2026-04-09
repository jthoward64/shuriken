# Implementation Completeness Audit

Evaluated against: RFC 4918, RFC 3744, RFC 5689, RFC 6578, RFC 4791, RFC 6638, RFC 7809, RFC 6352, RFC 6764, RFC 5545, RFC 6350.

Items marked **BUG** are confirmed defects in existing code. Items marked **MISSING** are unimplemented features. Items are roughly ordered by importance for client compatibility.

Once an item is complete, it should be deleted from this list (not checked or marked done)

---

## RFC 4918 — WebDAV Core

### MISSING: COPY does not transfer dead properties or ACL entries

[copy.ts:165-193](src/http/dav/methods/copy.ts#L165-L193), [copy.ts:253-315](src/http/dav/methods/copy.ts#L253-L315) — When copying an instance or collection, `clientProperties` (dead properties) are not passed to the new row and ACL entries are not copied. RFC 4918 §9.8.2 says a COPY SHOULD preserve all live and dead properties.

### MISSING: `DAV:getcontentlength` not returned for instances

RFC 4918 §15.4 — Instance PROPFIND responses omit `DAV:getcontentlength`. Clients may need this to know data sizes before downloading. Should reflect the serialized body length.

---

## RFC 3744 — WebDAV ACL

### MISSING: `DAV:principal-match` REPORT not implemented

RFC 3744 §9.3 — Clients use this REPORT to find all resources in a collection that are associated with the current user principal. Not dispatched in [report.ts](src/http/dav/methods/report.ts).

### MISSING: `DAV:principal-property-search` REPORT not implemented

RFC 3744 §9.4 — Clients use this to search principals by property values (e.g., search by display name or email). Not dispatched in [report.ts](src/http/dav/methods/report.ts).

### MISSING: `DAV:alternate-URI-set` not returned for principals

RFC 3744 §4.1 — Principals should expose an `alternate-URI-set` property listing other URLs that resolve to the same principal (e.g., email addresses as `mailto:` URIs). Omitting this makes address resolution for scheduling harder.

---

## RFC 4791 — CalDAV

### MISSING: `CALDAV:free-busy-query` REPORT not implemented

RFC 4791 §7.10 — Allows clients to query free/busy time over a calendar collection without fetching individual events. Not dispatched in [report.ts](src/http/dav/methods/report.ts).

### INCOMPLETE: VFREEBUSY time-range filter not specifically handled

RFC 4791 §9.9 — VFREEBUSY components should be matched on their DTSTART/DTEND pair directly. The current implementation falls through to the general case, which may work, but is not verified against the spec's exact wording.

---

## RFC 6638 — CalDAV Scheduling

Scheduling infrastructure exists at the schema level (`dav_schedule_message`, inbox/outbox collection types) but is almost entirely unimplemented at the HTTP layer.

### MISSING: POST to scheduling outbox not supported

RFC 6638 §3.3 — Clients send `POST` to the scheduling outbox to trigger free-busy queries and to send iTIP messages. `POST` is not in the `Allow` header and has no handler in the router.

### MISSING: Scheduling auto-delivery not implemented

RFC 6638 §3.4 — When a resource containing `ORGANIZER`/`ATTENDEE` is PUT to a calendar, the server must process iTIP scheduling messages (deliver `REQUEST` to attendee inboxes, etc.). The PUT handler does not trigger any scheduling logic.

### MISSING: `CALDAV:calendar-free-busy-set` property not implemented

RFC 6638 §2.1 — Each principal's calendar home should identify which calendars contribute to free-busy via this property. Not stored or returned.

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

## Summary by Priority

| Priority | Item |
|----------|------|
| P2 | `CALDAV:free-busy-query` REPORT missing |
| P2 | `DAV:principal-match` / `DAV:principal-property-search` REPORTs missing |
| P3 | COPY does not transfer dead properties or ACL entries |
| P3 | `DAV:getcontentlength` not returned for instances |
| P4 | RFC 7809 (timezones by reference) — full implementation |
| P4 | CalDAV scheduling (RFC 6638) — POST to outbox, auto-delivery |
