# Finding: UUID-shaped slugs were unaddressable (broke calendar creation)

**Status:** RESOLVED — fixed & verified live against `caldav-server-tester`.
Surfaced while wiring the second user / scheduling coverage into the external
suite (see [external-test-suites.md](./external-test-suites.md)).

## Symptom

`caldav-server-tester`'s `save.duplicate-uid.cross-calendar` check reported
`ungraceful (PutError)`. Reproduced down to: any calendar whose **slug is
UUID-shaped** is created successfully and appears in the parent's Depth:1
listing, but is otherwise unaddressable —

```
MKCALENDAR /dav/principals/test/cal/2623f643-…-e78438a2b8f4/   → 201
PROPFIND   /dav/principals/test/cal/2623f643-…-e78438a2b8f4/   → 404
PUT        …/cal/2623f643-…/evt.ics                            → 405 Method Not Allowed
```

This is exactly the shape python-caldav's `make_calendar(name=…)` produces: with
no explicit `cal_id` it names the new calendar after a random `uuid4()`. So the
*first* save into such a calendar already 405'd; the duplicate-UID check was
merely the first place it surfaced. Real clients (Apple Calendar, Thunderbird,
DAVx5, …) that name calendars/objects with UUIDs hit the same wall.

## Root cause

[router.ts](../../src/http/dav/router.ts) `parseDavPath` resolved each path
segment as **either** a UUID **or** a slug: `isUuid(seg) ? findById(seg) :
findBySlug(seg)`. A UUID-shaped *slug* therefore only ever tried `findById`,
which fails (the segment is a slug, not the resource's internal id) and fell
through to "new-collection" / "new-instance" → 404 on read, 405 on PUT. This
contradicted the documented policy that **both** slug- and UUID-addressed paths
resolve for every resource (CLAUDE.md "DAV URL and href policy").

## Fix

In `parseDavPath`, when a UUID-shaped segment matches no resource *id*, fall
back to a slug lookup. Applied consistently to all three levels — principal
(`seg1`), collection (`seg3`), and instance (`seg4`). `findBySlug` is scoped to
the owning principal/collection, so the fallback can never cross ownership
boundaries. A segment that *is* a real id still resolves directly via `findById`
(no extra query).

Regression tests in
[router.unit.test.ts](../../src/http/dav/router.unit.test.ts) ("UUID-shaped slug
resolution"): a collection / instance / principal whose slug is UUID-shaped now
resolves to the existing resource, and a canonical id still wins.

**Result:** `save.duplicate-uid.cross-calendar` → `full`; calendar/object
creation works for clients that use UUID names.

## Related: principal-search.list-all

The same external run flagged `principal-search.list-all: unsupported`.
python-caldav's `search_principals()` with no name sends a
`DAV:principal-property-search` REPORT with **no `<property-search>`** element;
shuriken returned an empty multistatus. Now a criteria-less query is treated as
match-all and enumerates every principal
([principal-property-search.ts](../../src/http/dav/methods/report/principal-property-search.ts)).
A query that carries criteria for a property we can't search still returns no
matches. Tests:
[report-principal-search.integration.test.ts](../../src/http/dav/__tests__/report-principal-search.integration.test.ts).

**Result:** `principal-search.list-all` → `supported`.
