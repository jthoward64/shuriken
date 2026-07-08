---
sidebar_position: 1
---

# Signing in

shuriken-ts is a calendar and contacts server you access two ways:

- **The web UI** — a browser-based app for calendars, contacts, tasks,
  sharing, and account settings. Works progressively even with
  JavaScript disabled; interactive bits are enhanced with HTMX.
- **A CalDAV/CardDAV client** — Apple Calendar/Contacts, Thunderbird,
  DAVx⁵ on Android, Outlook, or any standards-compliant client, synced
  directly against your calendars and address books.

Both surfaces operate on the same underlying data — anything you do in
the web UI is immediately visible to your DAV clients and vice versa.

## Logging in to the web UI

- If your server uses **single sign-on (OIDC)**, click **Sign in** and
  you'll be redirected to your organization's login page. There's no
  separate shuriken-ts password to remember.
- If your server uses **Basic auth** only (no SSO), your browser will
  prompt for a username and password directly.
- Either way, once you're in, visit [Profile](./profile) to find your
  account details and connection info for external apps.
