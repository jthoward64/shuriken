---
sidebar_position: 4
---

# Authentication modes

Three mechanisms exist, evaluated in this priority order on every
request by the composite auth layer (`src/auth/layers/composite.ts`):

1. **`AUTO_LOGIN` (single-user mode)** — short-circuits everything else.
2. **Session cookie** — set after a successful OIDC login; DAV clients
   never send this, so it's a no-op for them.
3. **HTTP Basic auth** — for DAV clients and any browser fallback.

OIDC is a separate layer that *establishes* a session (step 2) rather
than being consulted directly in the composite chain.

## Single-user mode (`AUTO_LOGIN`)

Set `AUTO_LOGIN=<email>` and every request — DAV and web UI alike — is
authenticated as that user with no credential checks whatsoever. Best
for personal, single-tenant, or development deployments. On boot,
`autoLoginStartup` (`src/startup.ts`) idempotently provisions the user
if they don't exist yet (deriving name/slug from the email's local
part) and grants them `DAV:all` on the Users/Groups virtual resources so
the web UI's admin functions work. If the configured email isn't found
but other users exist, the layer falls back to the first user in the
database rather than locking everyone out — it only fails if there are
no users at all.

## Basic auth (`BASIC_AUTH_ENABLED`, default `true`)

Standard `Authorization: Basic` credentials validated against the
`auth_user` table. Two credential kinds:

- **`local`** — the account's own password; username must equal the
  stored `auth_id`.
- **`app_password`** — a per-device secret (see
  [App passwords](./user-management#app-passwords)); username may be
  either the app password's own generated username or the owning
  principal's slug, so OIDC-only users (who have no local password) can
  still connect DAV clients.

**First-boot admin**: set `ADMIN_EMAIL` (and optionally `ADMIN_SLUG`).
If `ADMIN_PASSWORD` is unset, a random 32-hex-character password is
generated and **printed to stdout exactly once** on first boot:

```
*** shuriken-ts: default admin credentials ***
  Email:    admin@example.com
  Password: <random hex>
  Save this password — it will not be shown again.
```

This admin is created with role `super_admin` (see
[Roles](./user-management#roles)) and is idempotent — re-running startup
with the user already present does nothing destructive.

## OIDC (web UI single sign-on)

Enable with `OIDC_ENABLED=true` plus `OIDC_ISSUER`, `OIDC_CLIENT_ID`,
and (for confidential clients) `OIDC_CLIENT_SECRET`. The browser runs an
authorization-code + PKCE flow; on success the server issues an opaque,
DB-backed session cookie (lifetime `SESSION_TTL_DAYS`, default 7).
Identities are keyed by `<issuer>|<sub>`, linked to an existing local
user by verified email, or auto-provisioned on first login if
`OIDC_AUTO_PROVISION=true` (default) — set it `false` to require an
admin to pre-create accounts (see [User management](./user-management))
before SSO login is allowed.

**DAV clients never use OIDC.** SSO users generate an
[app password](./user-management#app-passwords) (UI → Profile → App
passwords) to connect CalDAV/CardDAV clients over Basic auth.

`oidcStartup` only performs a config sanity check at boot (warns if
`OIDC_ISSUER`/`OIDC_CLIENT_ID` are missing while OIDC is enabled) — it
does not write to the database.

### Role sync from IdP groups

Set both `OIDC_GROUPS_CLAIM` (the ID-token claim name holding an array
of group/role strings, e.g. `"groups"`) and `OIDC_ROLE_MAP` (a JSON
object mapping those values to app roles, e.g.
`{"shuriken-admins":"super_admin","staff":"admin"}`). When both are set,
the user's role is **re-applied from the IdP on every login**: the
highest-privilege matching role wins, and a user who matches no mapped
group is reset to the default role (`normal`) — the IdP is treated as
authoritative. Leave both unset to manage roles manually in the web UI
instead. The same login flow also reconciles **group membership**:
internal groups can each declare a list of `oidcGroups` names, and
membership is added/removed to match the token's claims — but only when
the claim is present at all (an absent claim leaves existing
auto-assigned memberships untouched, since "claim missing" isn't the
same as "member of nothing").

## Trusted proxies

`TRUSTED_PROXIES` (default `"*"`, meaning trust everything) is **not
itself an authentication mechanism** — it's an IP allowlist (exact
IPs, IPv4/IPv6 CIDRs, or a comma-separated mix, or `"*"`) that gates:

Whether `X-Forwarded-Proto`/`X-Forwarded-Host` are honored (used to mark
session cookies `Secure` and to derive the OIDC redirect URI when
`OIDC_REDIRECT_URI` is unset).

**Behind a TLS-terminating ingress, `TRUSTED_PROXIES` must include the
ingress's source IP(s)** (or stay `"*"` if the app isn't otherwise
network-reachable) — otherwise `X-Forwarded-Proto=https` is never
honored, session cookies won't be marked `Secure`, and any
auto-derived OIDC redirect URI will incorrectly resolve to
`http://<internal-host>`. Alternatively, pin `OIDC_REDIRECT_URI`
explicitly.
