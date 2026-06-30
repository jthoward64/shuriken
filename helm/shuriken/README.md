# shuriken Helm chart

Production deployment of [shuriken](https://github.com/jthoward64/shuriken) —
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

- **Deployment** — single container running the image's `task docker:start`
  entrypoint, which runs migrations and then starts the server. Checksum
  annotations roll pods when config-map / secret content changes. Set
  `migrations.enabled=false` to start the server only (`task start`), e.g. when
  migrating out-of-band or running multiple replicas.
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
| `config.auth.autoLogin` / `basicAuthEnabled` | Single-user and Basic-auth (DAV + app passwords) selection |
| `config.auth.oidcEnabled` / `oidcIssuer` / `oidcClientId` / `oidcClientSecret` | OIDC single sign-on for the web UI (client secret → Secret) |
| `config.auth.trustedProxies` | Trusted ingress IPs for `X-Forwarded-*` / SMTP headers (not an auth method; see note below) |
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
   (e.g. `DATABASE_URL`, `ADMIN_PASSWORD`, `OIDC_CLIENT_SECRET`, `EMAIL_CREDS_KEY`).
3. **Mix**: keep `existingSecret.name` set but also pass `extraEnv` for
   one-off overrides.

## Probes

Liveness / readiness / startup all hit `/.well-known/caldav` (HEAD-safe,
no auth required). Tune timing in values if your DB cold-start is slow.

## Auth & upgrading from proxy auth

Proxy auth (`PROXY_HEADER` / `X-Remote-User` / `PROXY_AUTO_PROVISION`) has been
**removed**. The web UI now uses OIDC; DAV clients use Basic auth with either a
local password or a per-device **app password** (UI → Profile → App passwords).

If you previously ran proxy auth behind an authenticating proxy (Authelia,
Authentik, Keycloak gatekeeper, oauth2-proxy):

1. Drop `config.auth.proxyHeader` / `proxyRoleHeader` / `proxyAutoProvision`
   from your values (they no longer exist; with the new `values.schema.json`
   they'll be rejected at install time).
2. Point shuriken straight at your IdP: set `config.auth.oidcEnabled=true`,
   `oidcIssuer`, `oidcClientId`, and `oidcClientSecret`, and register
   `https://<your-host>/ui/auth/callback` as a redirect URI at the provider.
3. Behind a TLS-terminating ingress, set `config.auth.trustedProxies` to the
   ingress source IPs (or `"*"` if the listener isn't otherwise reachable) so
   `X-Forwarded-Proto=https` is honoured — otherwise session cookies won't be
   `Secure` and the auto-derived redirect URI will be `http://<internal-host>`.
   Alternatively pin `config.auth.oidcRedirectUri` explicitly.
4. Users keep their accounts: existing users are re-linked by verified email on
   first OIDC login (`oidcAutoProvision=true`, the default, also creates unknown
   users). Each user then generates app passwords for their DAV clients.

No data migration is required beyond running the bundled schema migration
(`migrations.enabled`, default on), which adds the `session` / `oidc_login`
tables and app-password columns.
