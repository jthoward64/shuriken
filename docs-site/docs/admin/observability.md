---
sidebar_position: 10
---

# Observability

- **`/healthz`** (main HTTP port) — unauthenticated, dependency-free
  200, served before auth/metrics/tracing. Use this for
  liveness/readiness/startup probes, **not**
  `/.well-known/{cal,card}dav` (those redirect into an authenticated
  path).
- **`/metrics`** (dedicated `METRICS_PORT`, default `9464`) — Prometheus
  text-exposition format, unauthenticated by design (expects
  network-level isolation, e.g. a NetworkPolicy). Key instruments
  (`src/observability/metrics.ts`):
  - `shuriken.http.requests` / `shuriken.http.request.duration_ms` — by
    method, path group, status code.
  - `shuriken.dav.requests` — by DAV method and path kind.
  - `shuriken.auth.attempts` — by auth mode and outcome (useful for
    spotting credential-stuffing or misconfigured clients).
  - `shuriken.acl.checks` — allowed vs. denied.
  - `shuriken.repo.queries` / `shuriken.repo.query.duration_ms` — by
    entity/operation/outcome.
- **Logging** — structured via Effect `Logger`; set `LOG_LEVEL`
  (`trace|debug|info|warn|error|fatal`, case-insensitive) to change
  verbosity. Unrecognized values are silently ignored (stays at the
  default, `info`).
