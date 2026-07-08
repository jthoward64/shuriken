---
sidebar_position: 2
---

# Deployment

## Docker Compose (quickest path)

A working example lives at
[`docker/docker-compose.example.yaml`](https://github.com/jthoward64/shuriken/blob/main/docker/docker-compose.example.yaml):

```yaml file=<rootDir>/docker/docker-compose.example.yaml
```

Copy it, pick an [auth mode](./authentication), set the relevant env vars,
and `docker compose -f docker/docker-compose.example.yaml up -d`.

The image (`docker/Dockerfile`) is a multi-stage build ending in
`denoland/deno:distroless` (no shell). Its default `CMD` runs the
`docker:start` task, which is `migrations:run` followed by `start` —
migrations apply automatically on every container start and are
idempotent.

To build from source instead of pulling the published image, uncomment
the `build:` block in the compose file (context `..`, dockerfile
`docker/Dockerfile`).

## Kubernetes / Helm

The chart at `helm/shuriken/` is production-oriented. Quick start:

```sh
helm install shuriken ./helm/shuriken \
  --create-namespace --namespace shuriken \
  --set config.database.url='postgresql://shuriken:secret@db:5432/shuriken' \
  --set config.auth.adminEmail='admin@example.com' \
  --set config.auth.adminPassword='changeme'
```

What it renders:

- **Deployment** — single container, default entrypoint `task
  docker:start` (migrations + server). `migrations.enabled=true` by
  default; with `replicaCount > 1`, several pods may race to migrate on
  rollout — set `migrations.enabled=false` and run migrations
  out-of-band (or keep 1 replica) if that matters for a given schema
  change.
- **ConfigMap + Secret** — every `config.*` value becomes an env var.
  Non-sensitive values render into a ConfigMap; sensitive ones
  (`database.url`, `auth.adminPassword`, `auth.oidcClientSecret`,
  `mail.defaultPassword`, `mail.credsKey`, `mail.profilesJson`) render
  into a Secret named `<release>-shuriken-secret`. Set
  `existingSecret.name` to source these from an externally-managed
  Secret instead (keys expected as `DATABASE_URL`, `ADMIN_PASSWORD`,
  `OIDC_CLIENT_SECRET`, `EMAIL_CREDS_KEY`, etc.).
- **Service** — `ClusterIP`, port 80 → targetPort 3000. An optional
  `service.lmtp` block (disabled by default) exposes port 2400 for
  inbound iMIP.
- **ServiceMonitor** (Prometheus Operator) — disabled by default;
  requires the CRD plus `config.metrics.enabled`; scrapes `/metrics`
  every 30s.
- **Ingress** or **Gateway API HTTPRoute** — mutually exclusive, both
  disabled by default. The default Ingress rewrite keeps
  `/.well-known/{cal,card}dav` redirects working.
- **HPA / PodDisruptionBudget / NetworkPolicy** — all optional, disabled
  by default. The NetworkPolicy template is deny-by-default with
  scoped egress to Postgres (5432) and configurable CIDRs for
  SMTP/external-calendar traffic.
- **Hardening** — non-root pod (`runAsUser: 1000`, the image's `deno`
  user), read-only root filesystem, dropped capabilities, RuntimeDefault
  seccomp. Because the rootfs is read-only, a `tmp` `emptyDir` volume is
  mounted (Deno writes scratch files and the timezone-data polyfill
  loads zone data at startup).
- **Probes** — liveness/readiness/startup all hit `/healthz`, a public,
  dependency-free 200 handled before auth/metrics/tracing.
  **Do not** point probes at `/.well-known/{cal,card}dav` — those
  301-redirect into an authenticated path, and kubelet following the
  redirect will see a 401.
- **Resources** — default requests 100m CPU / 256Mi memory, limits
  1000m CPU / 1Gi memory. On large instances (80+ users) however,
  startup can spike memory use to 1.5+GB before settling to a more
  reasonable number. Keep this in mind when setting limits on instances
  that are expected to see a larger number of users.

Every key is documented inline in `helm/shuriken/values.yaml`; consult
it directly for the full list and current defaults. Postgres is **not**
bundled — point `config.database.url` at a managed instance, the
bitnami subchart, or an operator-managed cluster.

If you're upgrading from an older deployment that used proxy-header auth
(`PROXY_HEADER`/`X-Remote-User`/`PROXY_AUTO_PROVISION`/`PROXY_ROLE_HEADER`),
that mode has been removed — switch to [OIDC](./authentication#oidc-web-ui-single-sign-on);
see the migration notes in `helm/shuriken/README.md`.
