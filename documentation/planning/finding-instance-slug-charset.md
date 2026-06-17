# Finding: instance slug charset rejects `@` (breaks UID-named resources)

**Status:** RESOLVED — fixed & verified. Surfaced by the `python-caldav`
external suite (see `external-test-suite/`). Fixing it flipped **14** of the 25
shuriken failures to passing (25 → 11 failed; 31 → 45 passed).

## Symptom

python-caldav (like Apple Calendar, Thunderbird, DAVx5, …) names a calendar
object resource after its UID. UIDs are very commonly `local@domain`, so the
resource name becomes e.g. `20010712T182145Z-123401@example.com.ics`. Every such
`PUT` fails:

```
caldav.lib.error.AuthorizationError: AuthorizationError at
  '…/cal/pythoncaldav-test/20010712T182145Z-123401%40example.com.ics',
  reason Forbidden
```

## Reproduction (confirmed)

```
PUT …/cal/primary/plain-123.ics                  → 201 Created
PUT …/cal/primary/plain-123%40example.com.ics     → 403 Forbidden
```

Identical body; the only difference is the `@` (`%40`) in the resource name.

## Root cause

[src/domain/types/path.ts](../../src/domain/types/path.ts) `SLUG_RE`:

```
/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,126}[A-Za-z0-9_-]$|^[A-Za-z0-9_-]$/
```

Allowed: letters, digits, `_`, `-`, `.`. **`@` is not allowed**, so an instance
segment containing `@` fails `isValidSlug`, and the PUT edge rejects the
new-resource name (403). The comment on `SLUG_RE` notes it was deliberately made
"tighter than RFC 3986 unreserved so we don't have to think about URL-encoding"
— but that tightness rejects the single most common real-world resource-naming
pattern in CalDAV/CardDAV.

## Impact

High. Real clients routinely `PUT` to `…/<uid>.ics` / `…/<uid>.vcf` where the UID
contains `@`. Against shuriken those stores fail, so a large fraction of the
python-caldav functional suite fails, and real clients (iOS, Thunderbird, DAVx5,
Evolution) would be unable to save many objects.

## Recommended fix (for discussion — not applied)

Widen the instance-slug charset to accept the characters real clients use in
object names — at minimum `@`, and consider the RFC 3986 *unreserved* + `sub-delims`
that appear in practice (`@`, `~`, `+`, `=`, `,`, `!`, `$`, `&`, `(`, `)`). Keep
the path-traversal guards (no leading/trailing `.`, no `/`). Two scoping options:

1. Relax only the **instance** slug (collection/principal/user/group slugs can
   stay tight) — minimal blast radius, since the breakage is object names.
2. Relax the shared `SLUG_RE` for all segments.

Whichever path, add a regression test that `PUT`/`GET`/`DELETE` of a
`uid@domain.ics` resource round-trips (and that traversal-shaped names are still
rejected). After the fix, re-run `external-test-suite` python-caldav and refresh
its baseline — the ~15 `@`-related failures should flip to PASSED.

## Resolution (implemented)

- `isValidInstanceSlug` added in [path.ts](../../src/domain/types/path.ts):
  accepts the RFC 3986 `pchar` set minus `/` (unreserved + sub-delims + `:`/`@`),
  1–128 chars, rejecting `.`/`..`. [put.ts](../../src/http/dav/methods/put.ts)
  uses it for new instances; collection/principal/user/group slugs keep the
  tight `isValidSlug`.
- New [encode-segment.ts](../../src/http/dav/encode-segment.ts) `encodeSegment`
  percent-encodes the instance segment wherever it is emitted —
  `instanceHref` (propfind.ts) and the instance href in
  [proppatch.ts](../../src/http/dav/methods/proppatch.ts). XML escaping is
  automatic (fast-xml-builder), and instances are referenced by UUID in
  depth:1 / REPORT responses, so those sites need no change.
- Tests: `@` round-trip (PUT/GET/DELETE), encoded `%40` in the depth:0 href,
  disallowed-char rejection ([put.integration.test.ts](../../src/http/dav/methods/put.integration.test.ts)),
  and validator units ([path.unit.test.ts](../../src/domain/types/path.unit.test.ts)).
  All 550 DAV tests pass.

Verified: `PUT …/plain-123%40example.com.ics` → 201; python-caldav re-run
dropped from 25 → 11 failures.

## Newly-exposed follow-on: UUID-vs-slug href identity

Unblocking creation surfaced a deeper interop mismatch (now ~5 of the remaining
11 python-caldav failures: `testCreateEvent`, `testLoadEvent`, `testLookupEvent`,
`testCreateOverwriteDeleteEvent`, `testSync`). The client creates an object (or
calendar) at the **slug** URL it chose and then asserts the URL the server
reports for that resource equals the one it used. shuriken instead reports
collection/instance members by their stable **UUID** href — the deliberate
policy in CLAUDE.md ("depth:1 member instances … UUIDs are used"). So:

```
client PUT  …/cal/pythoncaldav-test/<uid>@example.com.ics
server REPORT returns …/cal/<calendar-uuid>/<instance-uuid>
python-caldav: AssertionError / KeyError (url mismatch)
```

**Resolved** (decision: satisfy the client first, keep UUIDs only where they
don't hurt). Member-enumeration responses — depth:1 PROPFIND members and the
`calendar-query` / `addressbook-query` / `sync-collection` REPORTs — now emit
each resource's **stored slug** (percent-encoded), so the href matches the URL
the client created the resource at. Link-reference properties clients merely
follow (home-sets, `owner`, `current-user-principal`, inbox/outbox, etc.) keep
UUID hrefs. Both forms still resolve on input, so nothing breaks. Updated policy
is documented in CLAUDE.md ("Response `<href>` construction").

This flipped 5 more python-caldav tests (`testCreateEvent`,
`testCreateOverwriteDeleteEvent`, `testLoadEvent`, `testLookupEvent`,
`testSync`): the suite went 11 → **6** failures (50 passed). The remaining 6 are
calendar-query filter gaps (see below).

## Other python-caldav failures (separate causes, recorded in the baseline)

The remaining failures cluster around VTODO/task handling
(`testCreateTaskListAndTodo`, `testTodos`, `testTodoCompletion`,
`testTodoRecurring*`), VJOURNAL (`testCreateJournalListAndJournalEntry`), and
some search/free-busy cases (`testSearchWithoutCompType`,
`testDateSearchAndFreeBusy`, `testRecurringDateSearch`). Some of these may share
the `@` cause (their fixtures also use `uid@domain` names); the rest are distinct
and worth triaging separately once the slug charset is widened. All are captured
in `external-test-suite/python-caldav/baseline.txt`.
