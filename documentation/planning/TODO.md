# Implementation Completeness Audit

Evaluated against: RFC 4918, RFC 3744, RFC 5689, RFC 6578, RFC 4791, RFC 6638, RFC 7809, RFC 6352, RFC 6764, RFC 5545, RFC 6350.

Items marked **BUG** are confirmed defects in existing code. Items marked **MISSING** are unimplemented features. Items are roughly ordered by importance for client compatibility.

Once an item is complete, it should be deleted from this list (not checked or marked done)

---

## RFC 4918 — WebDAV Core

### MISSING: `DAV:getcontentlength` not returned for instances

RFC 4918 §15.4 — Instance PROPFIND responses omit `DAV:getcontentlength`. Clients may need this to know data sizes before downloading. Should reflect the serialized body length.

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
| P3 | `DAV:getcontentlength` not returned for instances |
| P4 | RFC 7809 (timezones by reference) — full implementation |
| P4 | CalDAV scheduling (RFC 6638) — POST to outbox, auto-delivery |
