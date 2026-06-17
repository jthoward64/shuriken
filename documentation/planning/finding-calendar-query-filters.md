# Finding: calendar-query / addressbook-query filter gaps

Surfaced by `caldav-server-tester` (`search.*` deviations) and the python-caldav
external suite (`testSearchEvent`, `testSearchTodos`). Three real bugs found and
fixed; the rest characterized for follow-up.

## Fixed

### B1 — `text-match` silently dropped when it has no attributes

[filter-cal.ts](../../src/http/dav/methods/report/filter-cal.ts) `parseTextMatch`
(and the CardDAV twin in
[filter-card.ts](../../src/http/dav/methods/report/filter-card.ts)) only handled
a `<C:text-match>` parsed as an *object*. fast-xml-parser collapses a text-only
element with no attributes — `<C:text-match>foo</C:text-match>`, the form
python-caldav/iOS/Thunderbird actually send — to a bare **string**, so the
text-match was discarded and the prop-filter degraded to a mere
property-*existence* check (matching every record with that property). The
existing tests only used attribute-bearing text-matches, so it slipped through.
Fixed to accept the bare string/number form.

### B2 — `propValueText` returns `""` for multi-valued properties

For a `TEXT_LIST` value (CATEGORIES, RESOURCES, vCard NICKNAME, …) the value is
a `string[]`, so the old code fell through every branch and returned `""` — every
`category=…` text-match failed. Now rendered as the comma-joined iCalendar form
(also DATE_LIST/DATE_TIME_LIST) so `contains` matches any member.

### B3 — `i;octet` collation (mandatory, case-sensitive) was unsupported

RFC 4791 §7.5.1 / RFC 6352 §8.6.2 make `i;octet` (exact, case-sensitive)
mandatory, but we only ever folded case, so `category=finance` matched
`FINANCE`. Added `i;octet` to the parser, evaluator (no case fold), and the
advertised `supported-collation-set`; the CardDAV `card_index` pre-filter falls
back to a full scan for `i;octet` since the index is case-folded.

**Result:** flipped `testSearchEvent` and `testSearchTodos`. python-caldav went
11 → 6 → **4** failures over the filter work. Regression tests added in
[filter-cal.unit.test.ts](../../src/http/dav/methods/report/filter-cal.unit.test.ts)
(bare/TEXT_LIST/i;octet) and
[report-calendar.integration.test.ts](../../src/http/dav/__tests__/report-calendar.integration.test.ts)
(bare text-match end-to-end).

## Fixed (second pass — time-range / expand / VALARM)

### B4 — VTODO with no DTSTART (DUE-only or no time properties) was excluded

The cal_index time-range pre-filter
([cal-index/repository.live.ts](../../src/services/cal-index/repository.live.ts)
`findByTimeRange`) required `dtstart_utc < end`, which is NULL (false) for a
VTODO with only DUE, or with no DTSTART/DUE/DURATION at all (RFC 4791 §9.9 — the
latter matches *every* range). Such todos never reached the in-memory §9.9
evaluation. Now the pre-filter also admits `dtstart_utc IS NULL` rows; VEVENTs
always carry DTSTART so event queries are unaffected. (`testTodoDatesearch`:
matched 3/5 → **5/5**.)

### B5 — recurrence expansion dropped `VALUE=DATE`

`buildExpandedInstance`
([calendar-data.ts](../../src/http/dav/methods/report/calendar-data.ts)) always
emitted expanded DTSTART/DTEND/RECURRENCE-ID as DATE-TIME, so an all-day yearly
event (`DTSTART;VALUE=DATE`) expanded to `DTSTART:20081102T000000Z`. Now an
all-day master expands to DATE occurrences carrying the `VALUE=DATE` parameter
(`DTSTART;VALUE=DATE:20081102`), and RECURRENCE-ID matches the DTSTART value type
(RFC 5545). (`testRecurringDateSearch`.)

### B6 — VALARM time-range filter (RFC 4791 §9.10)

`evalComponentTimeRange`
([filter-cal.ts](../../src/http/dav/methods/report/filter-cal.ts)) had no VALARM
case, so a nested `VALARM` comp-filter fell through to the VEVENT branch and
(having no DTSTART) matched everything. Added `valarmTriggerInstants`: it
computes the alarm time from TRIGGER — a relative DURATION anchored to the parent
component's DTSTART (or DTEND for `RELATED=END`), or an absolute DATE-TIME — plus
DURATION+REPEAT repeats, and matches when any trigger falls in the range. The
parent component is now threaded through `evalCompFilter`/`evalComponentTimeRange`
since a VALARM trigger is relative to its enclosing VEVENT/VTODO. (`testAlarm`.)

### B7 — open-ended `<time-range>` over a recurrence threw "Out-of-bounds date"

The RRULE branch of `evalComponentTimeRange` bounded a missing `start`/`end`
with `Number.MAX_SAFE_INTEGER` milliseconds, which is past Temporal's maximum
instant (~year 275760) → `RangeError: Out-of-bounds date` → 500. Latent, but
exposed once the B4 fix let recurring VTODOs through an open-ended search.
Replaced with practical bounds (year 1..9999); also avoids expanding a no-UNTIL
recurrence to year 275760. (Was the final blocker for `testTodoDatesearch`.)

Tests added in
[report-calendar.integration.test.ts](../../src/http/dav/__tests__/report-calendar.integration.test.ts)
for all of them (VTODO §9.9, VALARM §9.10, DATE expand, open-ended recurrence).
All 1094 in-repo tests pass.

**Result:** `testAlarm`, `testRecurringDateSearch`, and `testTodoDatesearch` all
pass. python-caldav is now **55 passed / 1 failed / 2 skipped**.

## Remaining

- **`testPrincipals`** — **not a server bug**: python-caldav's pytest config
  escalates its own `DeprecationWarning: principals() is deprecated` to a
  failure. Nothing to fix here.

caldav-server-tester's `search.text.case-sensitive` should now pass (B3);
`search.text.category` should now pass (B1+B2); `search.time-range.alarm` remains
unsupported (VALARM, above). Re-run `./run.sh caldav-server-tester
--update-baseline` to refresh that snapshot when convenient.
