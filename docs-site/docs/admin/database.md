---
sidebar_position: 3
---

# Database operations

| Task | Command | Notes |
|---|---|---|
| Apply migrations | `deno task migrations:run` | `drizzle-kit migrate`; idempotent, safe to re-run. Runs automatically as part of `docker:start`. |
| Generate a migration | `deno task migrations:gen` | Dev-time only, after changing `src/db/drizzle/schema/`. |
| Reset the database | `deno task db:reset` | **Destructive.** Drops both the `public` schema *and* the `drizzle` migration-journal schema, then recreates `public`, then re-runs migrations. Dropping only `public` would leave drizzle's journal intact, tricking it into thinking migrations are already applied. Dev/test only. |
| Seed sample data | `deno task db:seed` | Populates a large, realistic dataset (users with basic-auth + one app password each, calendars/address books full of events/contacts, groups, sharing) via the real Effect service layer — a good smoke test. Assumes a fresh, already-migrated database. Scale knobs are env vars in `scripts/seed/config.ts` (e.g. `SEED_USERS`). |
| Browse the database | `deno task studio` | `drizzle-kit studio` — dev-only DB GUI. |

Connect with a single `DATABASE_URL` connection string:
`postgresql://user:pass@host:5432/db`.
