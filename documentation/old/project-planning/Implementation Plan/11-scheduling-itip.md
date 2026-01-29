# 11. Scheduling (iTIP)

## 11.1 RFC 6638 Overview

CalDAV Scheduling automates iTIP (RFC 5546) message delivery.

**Collections**:
- `schedule-inbox`: Receives incoming scheduling messages
- `schedule-outbox`: Target for busy-time requests (POST)

**Scheduling Object Resources**: Calendar resources where server performs scheduling.

## 11.2 Organizer Operations

When organizer creates/modifies/deletes scheduling object:

1. Server detects ATTENDEE changes
2. Generates iTIP REQUEST/CANCEL messages
3. Delivers to attendee inboxes (internal) or outbound (iMIP)
4. Updates SCHEDULE-STATUS on ATTENDEE properties

## 11.3 Attendee Operations

When attendee modifies participation:

1. Server detects PARTSTAT change
2. Generates iTIP REPLY message
3. Delivers to organizer inbox
4. Organizer's resource updated with reply

## 11.4 Schedule-Related Properties

| Property | Purpose |
|----------|---------|
| `CALDAV:schedule-inbox-URL` | Principal's inbox collection |
| `CALDAV:schedule-outbox-URL` | Principal's outbox collection |
| `CALDAV:calendar-user-address-set` | Principal's calendar addresses |
| `CALDAV:schedule-default-calendar-URL` | Default calendar for new events |

## 11.5 SCHEDULE-AGENT Parameter

Controls who handles scheduling:
- `SERVER`: Server handles (default)
- `CLIENT`: Client handles
- `NONE`: No scheduling

---
