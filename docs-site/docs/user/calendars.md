---
sidebar_position: 2
---

# Calendars

## Creating a calendar

From the calendar page, open **Add calendar → Create new**. You'll need
a URL-safe **slug** (lowercase letters, numbers, hyphens — this becomes
part of the calendar's DAV address, so avoid changing it later if
you've already connected external clients) and can give it a friendlier
display name, description, timezone, and color.

## Viewing multiple calendars

The sidebar lists every calendar you own or that's been shared with
you, each with a checkbox — check any combination to overlay them on
the month view, color-coded per calendar. One calendar is always
**active** (shown in bold) — that's the target for **New event**,
**Import**, and **Export**; click a calendar's name to make it active
(this also turns its visibility on if it was off).

Individually shared events (see [Sharing](./sharing)) that don't belong
to a whole shared calendar show up in a read-only **Shared events**
entry at the bottom of the list.

## Calendar color

Set a color per calendar (via the color picker on its edit page). This
color is stored using the same mechanism Apple's own apps use, so a
color you set here stays in sync if you also edit it from Apple
Calendar/iOS, and vice versa. If you've never set one, shuriken-ts
picks a stable, distinct default color for you so every calendar is
still visually distinguishable.

## Recurring events

When creating or editing an event, choose a recurrence frequency
(**Daily / Weekly / Monthly / Yearly**), an interval (e.g. every 2
weeks), and an end condition — either a fixed number of occurrences
(**Count**) or a specific end date (**Until**). If you set both, Count
takes priority. The calendar view expands all occurrences automatically
when JavaScript is available; the no-JS fallback list shows each
recurring series once with a plain-language label like "Repeats
weekly."

## Meeting invites (attendees)

The event form has an **Attendees** field (one email address per line)
and an optional organizer override. When you save (or cancel) an event
that has non-local attendees, shuriken-ts automatically sends them an
email invitation — you don't need to do anything else. See
[Meeting scheduling](./scheduling) for how invite responses come back.

## Import / export

- **Export** streams your whole calendar as one `.ics` file — useful
  for backups or moving to another server.
- **Import** accepts an `.ics` file upload and asks how to handle
  events that already exist (matched by UID): **Skip** duplicates,
  **Replace** (merge/overwrite) them, or fail on **Conflict**.

## The Birthdays calendar

If your address book has contacts with birthdays set, shuriken-ts
automatically maintains a special **Birthdays** calendar for you — one
recurring yearly event per contact, kept in sync whenever you add,
edit, or remove a birthday. Its edit page shows only a **Refresh now**
button (no manual edit/delete) since it's fully auto-managed.
Birthdays entered without a year (a common convention for privacy) show
without an age.
