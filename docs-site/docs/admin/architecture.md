---
sidebar_position: 1
---

# Architecture at a glance

- **Runtime**: Deno, single process, `Deno.serve` HTTP handler.
- **Database**: PostgreSQL >=18
- **Ports**:

  | Listener | Default | Purpose |
  |---|---|---|
  | Main HTTP | `PORT=3000`, `HOST=::` | DAV protocol, web UI, `/healthz`, `/.well-known/{cal,card}dav` |
  | Metrics | `METRICS_PORT=9464` | Prometheus `/metrics`, unauthenticated — **keep off any public ingress**, scrape in-cluster only |
  | iMIP LMTP (optional) | `LMTP_PORT=2400`, host `127.0.0.1` (or `0.0.0.0` in containers) | Inbound iTIP mail from a front-end MTA; opt-in via `LMTP_ENABLED=true` |

- **All configuration** is read through a single Effect `Config` layer
  (`src/config.ts`). Keys are declared camelCase in code and automatically
  mapped to `SCREAMING_SNAKE_CASE` environment variables (e.g.
  `databaseUrl` → `DATABASE_URL`). Local/dev runs load a `.env` file
  automatically (`deno task start`); containers set real env vars.
