---
sidebar_position: 11
---

# Environment variable reference

The authoritative source is `src/config.ts` (inline doc comments per
key) and `helm/shuriken/values.yaml` (same keys, Helm-native names).
Summary by category:

**Server**: `PORT` (3000), `HOST` (`::`)

**Metrics**: `METRICS_ENABLED` (true), `METRICS_PORT` (9464)

**Database**: `DATABASE_URL` (required, no default)

**Auth**: `AUTO_LOGIN`, `TRUSTED_PROXIES` (`*`), `BASIC_AUTH_ENABLED`
(true), `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_SLUG`,
`AUTH_SETTINGS_URL`, `AUTH_SETTINGS_LABEL`, `OIDC_ENABLED` (false),
`OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`,
`OIDC_REDIRECT_URI`, `OIDC_SCOPES` (`openid profile email`),
`OIDC_AUTO_PROVISION` (true), `SESSION_TTL_DAYS` (7),
`OIDC_GROUPS_CLAIM`, `OIDC_ROLE_MAP`

**Logging**: `LOG_LEVEL`

**External calendar**: `EXTERNAL_CALENDAR_SCHEDULER_TICK_S` (60),
`EXTERNAL_CALENDAR_FETCH_CONCURRENCY` (4),
`EXTERNAL_CALENDAR_CLAIM_CAP` (100)

**Birthdays**: `BIRTHDAY_SCHEDULER_TICK_S` (600),
`BIRTHDAY_CONCURRENCY` (4)

**Trash**: `TRASH_RETENTION_DAYS` (30, `0` disables trash)

**Mail / iMIP**: `MAIL_ENABLED` (false), `SMTP_FROM_ADDRESS`,
`SMTP_FROM_NAME`, `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USERNAME`,
`SMTP_PASSWORD`, `SMTP_SECURITY` (`starttls`), `EMAIL_CREDS_KEY`,
`LMTP_ENABLED` (false), `LMTP_PORT` (2400), `LMTP_HOST` (`127.0.0.1`),
`SMTP_PROFILES_JSON`

**Embedding**: `EMBED_PANES_ENABLED` (false),
`EMBED_CALENDAR_WIDGET_ENABLED` (false)

**Security headers**: `SECURITY_HEADERS_ENABLED` (true), `CSP_ENABLED`
(true), `CSP_FRAME_ANCESTORS`, `X_CONTENT_TYPE_OPTIONS_ENABLED` (true),
`REFERRER_POLICY_ENABLED` (true), `HSTS_ENABLED` (true),
`PERMISSIONS_POLICY_ENABLED` (true)

**Misc**: `NODE_ENV` (`production`)
