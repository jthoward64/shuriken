---
sidebar_position: 9
---

# Background jobs & sync tuning

| Feature | Env vars | Defaults |
|---|---|---|
| External calendar subscriptions (`src/services/external-calendar/`) | `EXTERNAL_CALENDAR_SCHEDULER_TICK_S`, `EXTERNAL_CALENDAR_FETCH_CONCURRENCY`, `EXTERNAL_CALENDAR_CLAIM_CAP` | `60`, `4`, `100` |
| Birthdays reconciliation (`src/services/birthday/`) | `BIRTHDAY_SCHEDULER_TICK_S`, `BIRTHDAY_CONCURRENCY` | `600`, `4` |
| Trash purge sweep | (fixed daily interval, not configurable) | governed by `TRASH_RETENTION_DAYS` |
| Bulk import/export jobs (`src/services/bulk-job/`) | none | DB-tracked, survive restarts |

- The external-calendar scheduler tick bounds how quickly a *newly due*
  subscription gets picked up; the actual per-URL sync cadence is set
  per subscription (the "sync frequency" field in the Subscriptions
  UI). `EXTERNAL_CALENDAR_CLAIM_CAP` is a soft DoS guard on
  subscriptions-per-URL — lower it on public multi-tenant deployments.
- The birthday scheduler is a cheap, idempotent full reconcile; it
  mainly exists to catch edits that write-side hooks might miss —
  regeneration also happens immediately on any contact write and via
  the "Refresh now" button on the Birthdays calendar.
