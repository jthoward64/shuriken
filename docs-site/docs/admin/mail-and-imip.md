---
sidebar_position: 7
---

# Outbound mail (SMTP) and inbound iMIP (LMTP)

## Outbound mail (SMTP)

Outbound mail powers scheduling invitations (RFC 6638 iTIP) and any
other user-notification email. `MAIL_ENABLED` (default `false`) is the
master switch — while off, every send is a no-op (previews in the UI
still work).

Credential resolution, in priority order, per send:

1. **Per-user credentials** stored in the DB, encrypted at rest with
   `EMAIL_CREDS_KEY` — required if you want users to save their own
   SMTP creds (`/ui/profile/email-credentials`).
2. **Server-wide regex-scoped profiles** — `SMTP_PROFILES_JSON`, a JSON
   array like:
   ```json
   [{"pattern":"^.*@example\\.com$","host":"smtp.example.com","port":587,
     "username":"relay@example.com","password":"…","security":"starttls"}]
   ```
   The first entry whose `pattern` matches the sending user's email
   wins; malformed entries are silently dropped rather than crashing
   boot. Useful when you host mail for your users and want messages to
   go out *as* them with zero per-user setup.
3. **Default fallback** — `SMTP_HOST`/`SMTP_PORT`/`SMTP_USERNAME`/
   `SMTP_PASSWORD`/`SMTP_SECURITY` (`none`|`starttls`|`tls`) and
   `SMTP_FROM_ADDRESS`/`SMTP_FROM_NAME`; mail goes out as the default
   sender with `Reply-To: <user's email>` so replies still land with
   the right person.

## Inbound iMIP (LMTP)

Handles replies from external, non-local invitees. `LMTP_ENABLED=true`
starts a raw TCP listener on `LMTP_HOST:LMTP_PORT` (defaults
`127.0.0.1:2400`; containers typically bind `0.0.0.0`) speaking LMTP
(RFC 2033). It expects to sit behind a front-end MTA (Postfix's `lmtp:`
transport, Dovecot, etc.) that forwards inbound iTIP mail — it does no
spam/relay filtering itself. Disabled by default, since inbound iMIP
isn't useful without a configured upstream MTA. In Kubernetes, expose it
via the chart's `service.lmtp.enabled` (default port 2400).
