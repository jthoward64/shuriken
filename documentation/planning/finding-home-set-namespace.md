# Finding: calendar/addressbook home-set & the non-addressable namespace level

**Status:** RESOLVED — fix implemented (see "Resolution" below). Surfaced by the
`caldav-server-tester` external suite (see
[external-test-suites.md](./external-test-suites.md) and `external-test-suite/`).

## Symptom

`caldav-server-tester` crashes before emitting any report:

```
ERROR:root:Server checker found something unexpected for create-calendar.
  Expected: {'support': 'full'}, observed: {'support': 'unsupported'}
caldav.lib.error.NotFoundError: NotFoundError at '404 Not Found'
RuntimeError: Server does not support calendar creation and no existing
  test calendar was found. Specify a calendar to use with --caldav-calendar.
```

The tool (via the `python-caldav` client) tries to create a scratch calendar
with `MKCALENDAR <calendar-home-set>/<name>/` and gets a 404.

## Evidence (live server, basic auth as `test@example.com`)

| Request | Result |
|---|---|
| PROPFIND `calendar-home-set` on `/dav/principals/test/` | href = `/dav/principals/test/` (the **principal root**) |
| PROPFIND `addressbook-home-set` on `/dav/principals/test/` | href = `/dav/principals/test/` (same) |
| PROPFIND Depth:1 on `/dav/principals/test/` | lists calendars/addressbook/inbox/outbox as members, hrefs like `/dav/principals/test/cal/<uuid>/` |
| PROPFIND on `/dav/principals/test/cal/` | **404** |
| MKCALENDAR `/dav/principals/test/curltest1/` (= home-set + new name) | **404** |
| MKCALENDAR `/dav/principals/test/cal/curltest2/` (with `cal/` segment) | **201** |

So calendars live two path segments below the advertised home-set, the
intermediate `cal/` segment is **not** an addressable collection, and creation
only works if the client already knows to insert the `cal/` namespace segment.

## Code

- **Home-set hrefs** — [src/http/dav/methods/propfind.ts](../../src/http/dav/methods/propfind.ts) ~L789:
  both `calendar-home-set` and `addressbook-home-set` are set to `principalHref`
  (`${origin}/dav/principals/${principalSeg}/`), with no namespace segment.
- **Namespace level rejected** — [src/http/dav/router.ts](../../src/http/dav/router.ts) ~L362-374:
  `parseDavPath` requires segment-2 to be a known namespace (`cal|card|inbox|outbox|col`)
  AND requires more than the namespace segment; a path that *stops* at
  `/dav/principals/:slug/:ns` is rejected as "Invalid DAV path" → 404. Hence
  `/dav/principals/test/cal/` is unreachable.
- **Depth:1 member hrefs** — propfind.ts ~L850-877 + `collectionHref` ~L448-453:
  members are emitted at `/dav/principals/<slug>/<ns>/<collectionId>/`, i.e. two
  segments below the principal.
- Note the codebase already builds namespace-qualified URLs elsewhere
  (`schedule-default-calendar-URL` → `.../cal/<id>/`), so the `cal/` level is a
  real conceptual container — it just isn't addressable or advertised as the home.
- Existing tests assert only that the home-set property is *present*, never its
  href value (propfind.integration.test.ts ~L355-396), which let this slip.

## RFC analysis

**1. The home-set value itself is permitted.** RFC 4791 §6.2.1 says
calendar-home-set may be *"either calendar collections or ordinary collections
that have child **or descendant** calendar collections."* So pointing it at an
ancestor of the calendars (the principal root) is, on its own, legal.

**2. The non-addressable intermediate URI is a violation.** RFC 4918 §5.2 (a
MUST):

> For all WebDAV-compliant resources A and B, identified by URLs "U" and "V"…
> such that "V" is equal to "U/SEGMENT", A MUST be a collection that contains a
> mapping from "SEGMENT" to B.

`/dav/principals/test/cal/<uuid>/` (B) is a real WebDAV resource, so
`/dav/principals/test/cal/` (A) **MUST** be a collection. It returns 404 →
**violation**.

**3. Depth:1 returns non-internal members.** RFC 4918 §3 defines an internal
member URL as the collection's URL plus *a single* path segment; §5.2 ties
Depth:1 to "the collection and directly contained resources." A Depth:1
PROPFIND on `/dav/principals/test/` returns resources two segments deep
(`/dav/principals/test/cal/<uuid>/`), which are not its internal members.

**4. Net interop effect.** Because the home-set is not the direct parent of the
calendars *and* the true parent (`cal/`) is unaddressable, the near-universal
client convention — create a calendar via `MKCALENDAR <home>/<name>/` — cannot
work. `python-caldav`, and therefore `caldav-server-tester`, hit this. (RFC 6352
§7.1.1 defines `addressbook-home-set` analogously; same situation for CardDAV.)

## Conclusion

The `calendar-home-set = principal root` value is *defensible* in isolation, but
combined with the **non-addressable `cal/`/`card/` namespace level** it produces
a genuine RFC 4918 §5.2 conformance bug and breaks standard client
calendar/addressbook creation. This is an **incomplete implementation of the
namespace model**, not merely a property-value choice.

## Recommended fix (for discussion — not yet applied)

Make the per-type namespace level a real, addressable collection and point the
home-sets at it:

1. `parseDavPath` should resolve `/dav/principals/:slug/cal/` (and `card/`,
   `inbox/`, `outbox/`) to a collection resource:
   - PROPFIND Depth:0 → 200, `resourcetype` = `DAV:collection` (a CalDAV
     calendar *home*, not a calendar itself).
   - PROPFIND Depth:1 → the type's collections as proper internal members
     (`/dav/principals/:slug/cal/<id>/`).
2. `calendar-home-set` → `/dav/principals/:slug/cal/`;
   `addressbook-home-set` → `/dav/principals/:slug/card/`.
3. `MKCALENDAR /dav/principals/:slug/cal/<name>/` already returns 201, so it then
   matches the `<home>/<name>` client convention with no extra work.
4. Add tests asserting the home-set **href values** and that the namespace level
   is an addressable collection whose Depth:1 children are the typed collections.

This mirrors how mainstream CalDAV/CardDAV servers expose separate calendar and
addressbook home collections, and satisfies RFC 4918 §5.2.

### Alternative (rejected)

Keep home-set = principal root and place calendars directly under the principal
(`/dav/principals/:slug/<id>/`, no namespace segment). This satisfies §5.2 too,
but collapses the calendar/addressbook/inbox/outbox separation the routing is
built around and conflicts with existing namespaced hrefs (e.g.
`schedule-default-calendar-URL`). More churn, less aligned with the current
design — not recommended.

## Resolution (implemented)

The recommended fix was applied:

1. **Addressable home collection.** New `collectionHome` kind in
   [path.ts](../../src/domain/types/path.ts); `parseDavPath`
   ([router.ts](../../src/http/dav/router.ts)) now resolves
   `/dav/principals/:slug/:ns` to it instead of 404. The router dispatches
   OPTIONS/PROPFIND to it and 405s everything else.
2. **PROPFIND on the home** ([propfind.ts](../../src/http/dav/methods/propfind.ts)):
   Depth:0 returns an ordinary `DAV:collection` (displayname "Calendars"/"Address
   Books"/…); Depth:1 lists the principal's typed collections of that namespace as
   proper internal members.
3. **Home-sets repointed** to `…/cal/` and `…/card/` (principal PROPFIND).
   `MKCALENDAR <home>/<name>/` (already 201) now matches the client convention.
4. **principal-property-search** ([principal-property-search.ts](../../src/http/dav/methods/report/principal-property-search.ts))
   now returns `calendar-home-set`/`addressbook-home-set` for matched principals —
   without this the python-caldav client KeyErrors during principal discovery.
5. Tests added in
   [propfind.integration.test.ts](../../src/http/dav/methods/propfind.integration.test.ts)
   asserting the home-set href values, the namespace-level PROPFIND (Depth 0/1),
   and the 405 on mutating methods.

After the fix, `caldav-server-tester` runs to completion and emits a full
compatibility report (no `--caldav-calendar` workaround needed).

### Remaining (separate) compatibility findings surfaced by the report

These are recorded in `external-test-suite/caldav-server-tester/baseline.txt` and
are **not** addressed here — they are distinct from the home-set issue:

- `create-calendar.set-displayname: unsupported` — `displayname` in the
  MKCALENDAR/extended-MKCOL body (or a follow-up PROPPATCH) isn't applied.
- `search.text.case-sensitive / search.text.category / search.time-range.alarm:
  unsupported` — calendar-query text + alarm time-range filters.
- ~~`save.duplicate-uid.cross-calendar: ungraceful (PutError)`~~ — RESOLVED.
  Root cause was UUID-shaped calendar slugs being unaddressable, not duplicate-UID
  handling; see [finding-uuid-shaped-slug.md](./finding-uuid-shaped-slug.md).
- ~~`principal-search.list-all: unsupported`~~ — RESOLVED; criteria-less
  principal-property-search now enumerates all principals. See
  [finding-uuid-shaped-slug.md](./finding-uuid-shaped-slug.md).

### Secondary, not yet changed

The principal's own Depth:1 PROPFIND still flattens all collections at two-deep
hrefs (`/dav/principals/:slug/cal/<id>/`), which are not its internal members per
RFC 4918 §3. Clients use the (now-correct) home-set, so this is cosmetic, but
could be tightened later to list the namespace homes as the principal's members.
