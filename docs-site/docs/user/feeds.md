---
sidebar_position: 6
---

# Feeds — publishing a calendar publicly

"Feeds" let you publish one or more of your own calendars as a
**public, read-only URL** that anyone with the link can subscribe to
from any calendar app — no shuriken-ts account required on their end.
This is different from [sharing](./sharing) with another user on your
server, which requires them to actually have an account here.

From **Feeds**, create a new feed:

1. Give it a name and (optionally) an expiry date.
2. Pick which of your calendars to include.
3. For each calendar, choose how much detail to expose:
   - **Full details** — everything.
   - **Title only** — event titles, no other details.
   - **Busy only** — free/busy blocks with no titles at all.

The feed page shows a copyable URL, lets you **regenerate the token**
(instantly invalidating the old link if you need to revoke access —
e.g. if you shared it too broadly), toggle it on/off, and adjust
per-calendar visibility.

If your server administrator has enabled the embedding feature, you can
also turn on an **embed widget** for a calendar in the feed and get a
copy-paste snippet to put a read-only calendar view on another website.

You can also create/attach a feed directly from a calendar's own edit
page.
