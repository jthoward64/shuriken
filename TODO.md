# TODO

## CalDAV floating-time / timezone RFC compliance — DONE

Agreed 2026-09-16, implemented the same day. Storage stance is unchanged:
`DTSTART`/`DTEND` stay **floating** (no `TZID`, no `Z`). What changed is how
floating values are *resolved* for queries, which is a spec requirement rather
than a stance. See the "Dates and Times" section of `CLAUDE.md` for the rules
that now apply to new code.

### What shipped

1. **`UNTIL` form.** `formatRruleUntil` no longer appends `Z`, so `UNTIL`
   matches a floating `DTSTART` (RFC 5545 section 3.3.10). Covered by tests for
   the date-only, timed, widened date-only, and malformed cases.
2. **`resolveFloating` helper** (`src/data/icalendar/resolve-floating.ts`).
   Branded `ResolutionZone`, validated against the runtime tz database with a
   cache of successful lookups only. Never throws: an unknown zone yields
   `None` (`parseZone`) or UTC (`resolutionZone`). Handles DST gaps via
   `PlainDateTime.toZonedDateTime`, and unwraps Mozilla/Oracle-style prefixed
   TZIDs (`/mozilla.org/.../Europe/Berlin`).
3. **Zone threaded through** `ir-helpers.ts`, `recurrence-check.ts`,
   `filter-cal.ts`, `calendar-data.ts`, `free-busy-query.ts`,
   `scheduling/service.live.ts`. It is a **required** parameter on every helper
   that turns a component into an `Instant`, so no call site can silently fall
   back to UTC. The only remaining `"UTC"` literals are legitimate (formatting
   an `Instant` for output, `DTSTAMP`, recognising `"UTC"` as a tzid).
4. **Zone resolved per request at the edge** (`calendar-zone.ts`), applying RFC
   4791 section 7.3 precedence: request `CALDAV:timezone` → RFC 7809
   `CALDAV:timezone-id` → collection `timezoneTzid` → UTC. A source naming an
   unknown zone is skipped rather than collapsing the chain to UTC. Wired into
   calendar-query, calendar-multiget, free-busy-query, scheduling free-busy and
   the UI/embed calendar feeds.
5. **Index staleness.** Solved by widening, not reindexing — see below.
6. **iMIP.** Outbound invitations anchor floating values to the organizing
   calendar's zone with a `TZID` plus the matching `VTIMEZONE`, falling back to
   UTC (`Z`, self-describing, no VTIMEZONE needed). All-day `DATE` values and
   values the organizer already pinned are left untouched.
7. **`CLAUDE.md`** updated: stale `Date` claim corrected, storage stance and
   resolution rules documented, component set and `/ui/dev/components` added.

### Bugs this fixed (not just "wrong zone")

Floating values were handled inconsistently per component type, because
`instantFromIrValue` returned `undefined` for them and each caller guessed:

- non-recurring **VEVENT** fell through to `return true` and matched *every*
  time-range query
- **VJOURNAL** returned `false` and could never match one
- **VTODO** fell through to its COMPLETED/CREATED rows
- **free-busy** skipped floating events entirely, so events created in the web
  UI never appeared in free-busy output at all

### Two deviations from the original plan, both deliberate

- **Index staleness needed no background job.** The plan assumed application
  code wrote `cal_index`. It does not: the `maintain_cal_index_on_instance_change`
  SQL trigger does, and it already stores floating `DTSTART` as NULL (which
  always passes the pre-filter) and DATE as UTC midnight. So floating rows were
  never stale. Only DATE rows could be wrongly excluded, by at most one UTC
  offset. Since the pre-filter only has to be a *superset*, `zonePaddedRange`
  widens the scanned window by the maximum possible offset when the zone is not
  UTC. That is correct immediately, with no reindex, no stale flag and no
  background job. It also covers the `coveredSpans` day/month bucket concern
  flagged earlier, since the buckets are derived from the widened window.
- **`calendar-zone.ts` lives in `src/data/icalendar/`, not `src/http/dav/`.**
  `scheduling/service.live.ts` needs it, and a service importing from the HTTP
  edge would invert the layering rule.

### Follow-ups

- ~~`effectiveDtend` gives an all-day event with no `DTEND`/`DURATION` a
  zero-length span.~~ **Done.** RFC 5545 section 3.6.1 and RFC 4791 section 9.9
  both give such a `VEVENT` a one-day duration. Measured before the fix: it
  failed to match a query for its own day, or for that afternoon, matching only
  a window opening strictly before its midnight - and `build-vevent.ts` omits
  `DTEND` whenever the form's end field is blank, so the web UI creates the
  shape routinely. The day is counted on the resolution zone's calendar, so a
  day carrying a DST change is still one day. `evalVjournalTimeRange` was doing
  the same thing with a fixed `{ hours: 24 }` and now matches. No index change
  was needed: a missing `DTEND` indexes as NULL, which the pre-filter already
  passes through to the exact in-memory check.

- ~~A floating timed `UNTIL` is not indexed.~~ **Done** — migration
  `20260917000000_index_floating_rrule_until`. While adding the branch, found
  that the existing extraction was also **session-timezone dependent**:
  `to_timestamp()` reads its input in the session zone and returns timestamptz,
  so the trailing `AT TIME ZONE 'UTC'` applied the offset a second time. Measured
  in PGlite, a `UNTIL=20260701T173000Z` stored as `2026-07-01T01:30Z` under
  `Asia/Shanghai` and `2026-07-02T01:30Z` under `America/New_York` — out by twice
  the offset, up to ~28h. East-of-UTC servers stored a bound *earlier* than the
  real one, so the clause `rrule_until_utc > start` silently dropped still-live
  recurring series from time-range queries. Casting to a naive `timestamp` first
  fixes it; verified stable across four session zones. The migration recomputes
  every existing row, not just the NULL ones.

- **Behaviour change to be aware of: PUT now rejects an inverted floating
  `DTEND` < `DTSTART`.** Rule 3 in `put.ts` previously skipped floating events
  only because the helper could not resolve them; it now compares them in UTC,
  which is zone-independent for two endpoints of one event. Previously-accepted
  malformed events are refused with `CALDAV:valid-calendar-object-resource`.
  Flagged rather than reverted, since the rule as documented always intended to
  cover them.

## Review follow-ups (2026-09-17)

Two defects found reviewing the floating-time work, both fixed.

- **Outgoing invitations violated RFC 5545 section 3.3.10.** iMIP anchoring
  rewrote a floating `DTSTART` to a `TZID` but left the `RRULE`'s `UNTIL`
  floating, so the invitation carried `DTSTART;TZID=Europe/Berlin` alongside
  `UNTIL=20261216T090000`. `anchorComponent` now runs the existing
  `normalizeRruleUntil` over the component's `RRULE` whenever it anchors that
  component's `DTSTART`. Already-UTC and date-only `UNTIL`s are untouched, and a
  UTC anchoring zone still produces a `Z`-suffixed pair. Five cases covered in
  `build-message.unit.test.ts`.

- **Floating recurring series were invisible to bounded time-range queries.**
  The trigger mapped a floating `DTSTART` to NULL. That is safe for the
  non-recurring clause, which tests `dtstart_utc IS NULL OR ...`, but
  `rruleBucketClause` computes week/month/year offsets *from* `dtstart_utc`:
  with NULL the arithmetic is NULL, the enclosing `OR` evaluates to NULL rather
  than true (confirmed in Postgres), and `WHERE ... AND NULL` returns no rows.
  Any floating `FREQ=WEEKLY`/`MONTHLY`/`YEARLY` series - which is every
  recurring event this server creates - was dropped. Migration
  `20260917010000_index_floating_dtstart` pins floating values to UTC at their
  wall time, exactly as DATE values are pinned, and backfills existing rows;
  `zonePaddedRange`'s existing +/-14h widening already makes that a correct
  superset. NULL now means "no DTSTART at all".
  `report-floating-time-range.integration.test.ts` covers it and was checked to
  fail without the migration.

  Every other DAV test in the repo wrote `DTSTART` with a trailing `Z`, so the
  one form this server never produces was the only form under test.

## UI component set

- `/ui/dev/components` gallery covers the whole shared set. Roughly 300 raw-class
  call sites across the existing pages are **not** migrated yet (deliberate, so
  nothing regresses): `btn` x99, `form-input` x78, `form-group` x79, `link` x33,
  `table-wrap` x12, `badge` x11, 22 hand-rolled checkboxes, 5 raw `<dialog>`s.
- `TagCombobox` is the default tag control; `TagPicker` is kept as the
  `<select>`-based alternative.
