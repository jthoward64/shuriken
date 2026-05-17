# shuriken Helm chart

Production deployment of [shuriken-ts](https://github.com/jthowardio/shuriken-ts) —
a CalDAV / CardDAV server with HTMX management UI, public iCal feeds, bulk
import/export, and RFC 6638 scheduling.

## Quick start

```sh
helm install shuriken ./helm/shuriken \
  --create-namespace --namespace shuriken \
  --set config.database.url='postgresql://shuriken:secret@db:5432/shuriken' \
  --set config.auth.adminEmail='admin@example.com' \
  --set config.auth.adminPassword='changeme'
```

## What's in the chart

- **Deployment** — single container running `bun .`, with checksum
  annotations so config-map / secret changes trigger rollouts.
- **Pre-install/pre-upgrade Job** — runs `bun run migrations:run` before
  any pod from the new revision starts. Disable via `migrations.enabled=false`.
- **Service** — ClusterIP by default; exposes HTTP and optionally the LMTP
  port for inbound iMIP.
- **ConfigMap + Secret** — every `config.*` value is rendered into env
  vars; sensitive values (DB URL, passwords, creds key, SMTP profiles
  JSON) land in the Secret. Use `existingSecret.name` to read from an
  externally-managed Secret instead.
- **Optional**: Ingress, HPA (CPU + memory), PDB, NetworkPolicy (deny by
  default + carefully-scoped egress for DB / SMTP / HTTPS).
- **Hardening**: non-root pod security context, read-only rootfs,
  dropped capabilities, RuntimeDefault seccomp profile, `/tmp` emptyDir.

## Values

Everything is documented inline in [values.yaml](./values.yaml). Highlights:

| Key | What it does |
| --- | --- |
| `config.database.url` | Postgres connection string (rendered into the Secret) |
| `config.auth.basicAuthEnabled` / `proxyHeader` / `proxyAutoProvision` | Auth strategy selection |
| `config.mail.enabled` + `mail.*` | Outbound SMTP + iMIP LMTP |
| `existingSecret.name` | Read env vars from an out-of-band Secret |
| `migrations.enabled` | Run schema migrations as a Helm hook Job |
| `ingress.enabled` / `ingress.hosts` | Expose via classic `networking.k8s.io/v1` Ingress |
| `httpRoute.enabled` / `httpRoute.parentRefs` | Expose via Gateway API `HTTPRoute` (mutually exclusive with `ingress.enabled`) |
| `autoscaling.enabled` | Horizontal Pod Autoscaler |
| `networkPolicy.enabled` | Lock down traffic with NetworkPolicy |
| `podSecurityContext` / `containerSecurityContext` | Pod / container hardening knobs |

Schema is validated by [values.schema.json](./values.schema.json) — bad
values fail at `helm template` / `helm install` time.

## Postgres

The chart does **not** bundle Postgres. Use a managed instance, the
[bitnami/postgresql](https://artifacthub.io/packages/helm/bitnami/postgresql)
subchart, or your own Postgres operator. Point `config.database.url` at
the resulting service.

Migrations are idempotent and safe to re-run; the chart-provided Job
runs them at every `helm upgrade`.

## Secrets

Three modes:

1. **Chart-managed** (default): put cleartext values under `config.*` and
   the chart writes them to a Secret. Easiest, but cleartext sits in your
   Helm release. Fine for `--dry-run` and dev; not great for prod.
2. **External Secret**: set `existingSecret.name` to a Secret you manage
   via External Secrets / Sealed Secrets / your CI. The chart will
   `envFrom` that Secret directly. Expected keys are SCREAMING_SNAKE_CASE
   (e.g. `DATABASE_URL`, `ADMIN_PASSWORD`, `EMAIL_CREDS_KEY`).
3. **Mix**: keep `existingSecret.name` set but also pass `extraEnv` for
   one-off overrides.

## Probes

Liveness / readiness / startup all hit `/.well-known/caldav` (HEAD-safe,
no auth required). Tune timing in values if your DB cold-start is slow.
