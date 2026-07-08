---
sidebar_position: 1
slug: /
---

# shuriken-ts

shuriken-ts is a self-hosted **CalDAV/CardDAV server** with an HTMX/Preact
web management UI, public iCal feeds, bulk import/export, and RFC 6638
scheduling, running on [Deno](https://deno.com).

This site has two guides:

- **[Administrator Guide](./admin/architecture)** — deployment,
  configuration, authentication modes, user/group management, and ongoing
  operations. Start here if you're standing up or running a server.
- **[User Guide](./user/signing-in)** — calendars, contacts, tasks,
  sharing, and connecting external apps. Start here if you're using a
  server someone else set up.

Both the web UI and any CalDAV/CardDAV client (Apple Calendar/Contacts,
Thunderbird, DAVx⁵, Outlook, etc.) operate on the same underlying data —
anything you do in one is immediately visible in the other.
