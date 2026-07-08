---
sidebar_position: 10
---

# Your profile & connecting external apps

Visit **Profile** for:

- **Account details** — display name and email (and username, if you're
  an admin editing another account).
- **DAV client setup** — three copyable URLs for connecting external
  calendar/contacts apps:
  - **Principal URL**
  - **CalDAV URL**
  - **CardDAV URL**

  Most modern clients (Apple Calendar/Contacts, Thunderbird, DAVx⁵,
  Outlook) can also auto-discover the server if you just give them your
  server's base address — no need to type the exact paths.

- **Password** — if your account uses a local password (not SSO), you
  can change it here. If your server uses single sign-on, this section
  won't appear — a link to your organization's account settings may be
  shown instead.

## Connecting a CalDAV/CardDAV app

1. Go to **Profile → App passwords** and create a new one — give it a
   label like "iPhone" or "Thunderbird" so you remember what it's for.
2. You'll be shown a **generated username** and a **password** — copy
   both immediately; the password is shown only once and can't be
   recovered later (only revoked and replaced with a new one).
3. In your calendar/contacts app, enter the server address (or the
   specific CalDAV/CardDAV URL from your profile page), then use the
   **generated username** (not your email) together with the app
   password when it asks for credentials.
4. You can create as many app passwords as you like (one per device is
   a good habit) and revoke any of them individually later without
   affecting the others or your main login.

This keeps your real login (especially your SSO credentials, which
CalDAV/CardDAV apps can't use directly) separate from anything stored
on your devices.

## Email credentials (optional)

If you want meeting invitations to be sent from your own email account
rather than the server's default, **Profile → Email credentials** lets
you configure your own outbound SMTP settings. This is optional — if
you skip it, invites still go out using the server's configured
fallback.
