---
sidebar_position: 8
---

# Feature flags: embedding & security headers

- **`EMBED_PANES_ENABLED`** (default `false`) — chrome-less
  `/ui/embed/{calendar,contacts,tasks}` panes for iframing into another
  internal tool; still requires normal session/Basic auth.
- **`EMBED_CALENDAR_WIDGET_ENABLED`** (default `false`) — the public,
  unauthenticated `/embed/<token>` read-only calendar widget built on
  share links. Also requires the per-calendar `embed_enabled` toggle in
  that calendar's Feed settings.
- **Security response headers** — `SECURITY_HEADERS_ENABLED` is a
  master kill switch (default `true`) for a bundle of hardening
  headers: `CSP_ENABLED` (with `CSP_FRAME_ANCESTORS` listing extra
  origins permitted to frame `/ui/embed/*` — all other routes deny
  framing outright; the public `/embed/*` widget is never restricted by
  this list, since a share-link token already grants the data),
  `X_CONTENT_TYPE_OPTIONS_ENABLED`, `REFERRER_POLICY_ENABLED`,
  `HSTS_ENABLED` (only emitted when the resolved scheme is HTTPS),
  `PERMISSIONS_POLICY_ENABLED`. Disable the master switch only if a
  reverse proxy already sets these headers itself.
