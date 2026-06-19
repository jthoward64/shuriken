# Finding: scheduling coverage (auto-schedule, inbox delivery, free-busy)

**Status:** RESOLVED — three scheduling bugs fixed & verified live against
`caldav-server-tester` with a second user configured.

## Context

RFC 6638 scheduling is inherently multi-user, so `caldav-server-tester` only
exercises it when given a second account (`--config-section` ×2, see
[external-test-suites.md](./external-test-suites.md)). Wiring that second user
into the harness moved four checks from "not tested (only one user)" to actually
running — and surfaced three real bugs.

## B1 — auto-placement silently disabled (auto-schedule + inbox delivery)

`scheduling.auto-schedule` failed and `scheduling.mailbox.inbox-delivery` was at
risk: an incoming iTIP REQUEST landed in the attendee's inbox but was **not**
auto-placed into their calendar (RFC 6638 §3.4.2).

Root cause: provisioning created the scheduling inbox but never set its
`scheduleDefaultCalendarId`, so `SchedulingRepository.findDefaultCalendar`
returned `none` for **every** user and the auto-placement copy in
`deliverToInbox` (wrapped in `Effect.ignore`) silently no-op'd.

Fix: provisioning now points the inbox's schedule-default-calendar at the
primary calendar at creation time. Added an optional `scheduleDefaultCalendarId`
to `NewCollection`
([repository.ts](../../src/services/collection/repository.ts)) set on insert;
[provisioning/service.live.ts](../../src/services/provisioning/service.live.ts)
passes the freshly-created primary calendar's id when creating the inbox.

**Result:** `scheduling.auto-schedule` and `scheduling.mailbox.inbox-delivery`
→ `full`.

## B2 — outbox free-busy POST required legacy headers

The outbox POST handler required `Originator` and `Recipient` HTTP headers and
returned **400** without them. Those headers are from the pre-standard
`caldav-sched` draft (Apple Calendar Server); RFC 6638 derives the originator
from the iCalendar `ORGANIZER` (the authenticated principal) and the recipients
from the VFREEBUSY `ATTENDEE` properties — which is what `processOutboxPost`
already reads. Conformant clients (python-caldav) never send the legacy headers.

Fix: removed the header requirement
([post.ts](../../src/http/dav/methods/post.ts)).

## B3 — outbox free-busy response was raw iCalendar, not schedule-response

The POST returned `text/calendar` with one aggregated VFREEBUSY. RFC 6638
§6.2.2 / §10.2 require a `CALDAV:schedule-response` (XML) with one
`CALDAV:response` per recipient — each carrying `CALDAV:recipient` (href),
`CALDAV:request-status`, and `CALDAV:calendar-data`. python-caldav parsed the
non-XML body and died with `'NoneType' object has no attribute 'tag'`.

Fix: `processOutboxPost` now returns per-recipient results
(`OutboxFreeBusyResult[]` — [service.ts](../../src/services/scheduling/service.ts));
the edge renders them into a schedule-response, mapping a resolvable recipient to
request-status `2.0;Success` + its free-busy and an unresolvable one to
`3.7;Invalid Calendar User`
([post.ts](../../src/http/dav/methods/post.ts)). Tests:
[scheduling-outbox.integration.test.ts](../../src/http/dav/__tests__/scheduling-outbox.integration.test.ts).

**Result:** `scheduling.freebusy-query` → `full`.

## Remaining: schedule-tag.stable-partstat (unknown)

`scheduling.schedule-tag.stable-partstat` is now reachable (auto-schedule works)
but reports `unknown`: the attendee's auto-placed copy carries no `Schedule-Tag`,
so the tester can't verify that a PARTSTAT-only update leaves the tag unchanged
(RFC 6638 §3.2.10). Implementing Schedule-Tag on auto-placed attendee copies
(and its stability semantics) is a separate feature; baselined as `unknown` (a
"couldn't test", not a failure) for now.

## Harness notes

- The second account is created on demand via the admin UI API
  (`POST /ui/api/users/create`) and passed to the tool through a two-section
  caldav config file (`caldav_url`/`caldav_username`/`caldav_password`, JSON so
  no pyyaml dep). The tester's env-var override reads any `CALDAV_*` var, so the
  harness env vars deliberately use `PRIMARY_*`/`SECOND_*` names instead.
- Server `depends_on: database: condition: service_healthy` — the entrypoint
  runs migrations immediately and previously raced a not-yet-ready Postgres on a
  fresh DB.
