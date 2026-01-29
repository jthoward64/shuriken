# Phase 7: Free-Busy & Scheduling

**Status**: ❌ **NOT STARTED (0%)**  
**Last Updated**: 2026-01-25

---

## Overview

Phase 7 implements free-busy queries and calendar scheduling features. Free-busy allows clients to query availability without accessing event details (privacy-preserving). Scheduling enables calendar invitations with ATTENDEE management, PARTSTAT updates, and iTIP message exchange (REQUEST/REPLY/CANCEL). This phase is essential for multi-user calendar coordination and meeting scheduling.

**Complexity**: HIGH — iTIP message processing is complex with many edge cases.

**Priority**: MEDIUM — Free-busy is commonly used; scheduling is required for meeting invitations.

---

## Implementation Status

### ❌ Not Implemented

#### 1. free-busy-query Report (RFC 4791 §7.10)

**Current State**: No implementation. XML parsing exists but no handler.

**What's Missing**:

##### Request Parsing
- [ ] Parse `<C:free-busy-query>` request body
- [ ] Extract time-range (`<C:time-range start="..." end="..."/>`)
- [ ] Extract target principal(s) (`<D:href>/principals/users/alice/</D:href>`)

##### Event Aggregation Logic
- [ ] Query events in time-range across all calendars for principal
- [ ] Filter event selection:
  - **Include**: VEVENT with `STATUS:CONFIRMED` or no STATUS
  - **Include**: VEVENT with `TRANSP:OPAQUE` or no TRANSP
  - **Exclude**: VEVENT with `STATUS:CANCELLED`
  - **Exclude**: VEVENT with `TRANSP:TRANSPARENT` (free time)
  - **Exclude**: VEVENT with ATTENDEE matching principal and `PARTSTAT:DECLINED`
- [ ] Extract busy periods: `(dtstart_utc, dtend_utc)` for each included event
- [ ] Handle recurring events (requires Phase 5)

##### Period Merging
- [ ] Merge overlapping busy periods
  - Example: 9:00-10:00 + 9:30-11:00 → 9:00-11:00
- [ ] Maintain separate BUSY-UNAVAILABLE periods
  - Events marked `BUSYTYPE:BUSY-UNAVAILABLE` (tentative, out-of-office)

##### VFREEBUSY Generation
- [ ] Build VFREEBUSY component
  ```ical
  BEGIN:VFREEBUSY
  UID:unique-id@domain.com
  DTSTAMP:20260125T120000Z
  DTSTART:20260201T000000Z
  DTEND:20260228T235959Z
  FREEBUSY;FBTYPE=BUSY:20260203T090000Z/20260203T100000Z,20260204T140000Z/20260204T150000Z
  FREEBUSY;FBTYPE=BUSY-UNAVAILABLE:20260210T080000Z/20260210T170000Z
  END:VFREEBUSY
  ```
- [ ] FREEBUSY property with period list
- [ ] FBTYPE parameter: BUSY, BUSY-UNAVAILABLE, BUSY-TENTATIVE

##### Authorization
- [ ] `read-free-busy` privilege (lower than `read`)
  - Must not leak event details (only busy times, no SUMMARY/DESCRIPTION)
  - Should be granted to all authenticated users by default
- [ ] Filter calendars based on ACLs
  - Only aggregate from calendars where principal has `read-free-busy` or `read`

**Recommended Implementation Path**:
1. Implement event aggregation query
2. Implement period merging algorithm
3. Build VFREEBUSY component
4. Add authorization checks
5. Add integration tests

**Estimated Effort**: 1 week

---

#### 2. Scheduling Collections (RFC 6638)

**Current State**: No scheduling collections exist in schema or handlers.

**What's Missing**:

##### Schema Changes
- [ ] Add `schedule-inbox` collection for each principal
  - Path: `/calendars/users/{username}/inbox/`
  - Receives incoming iTIP messages (REQUEST, REPLY, CANCEL)
- [ ] Add `schedule-outbox` collection for each principal
  - Path: `/calendars/users/{username}/outbox/`
  - POST here to send iTIP messages
- [ ] Add `dav_schedule_message` table
  - Stores iTIP messages in inbox/outbox
  - Columns: `id`, `collection_id`, `sender`, `recipient`, `method`, `ical_data`, `status`, `created_at`

##### Principal Properties
- [ ] `CALDAV:schedule-inbox-URL` property
  - Returns inbox collection URL for principal
- [ ] `CALDAV:schedule-outbox-URL` property
  - Returns outbox collection URL for principal
- [ ] `CALDAV:calendar-user-address-set` property
  - Lists all addresses for principal (email, mailto URIs)

##### inbox Collection Behavior
- [ ] Receive iTIP messages via POST
- [ ] Display messages in PROPFIND (Depth: 1)
- [ ] DELETE message after processing
- [ ] Return `schedule-response` status for each attendee

##### outbox Collection Behavior
- [ ] POST iTIP message to outbox
- [ ] Process REQUEST/REPLY/CANCEL methods
- [ ] Deliver to local users (inbox)
- [ ] Return delivery status in response

**Estimated Effort**: 1-2 weeks

---

#### 3. Scheduling Detection on PUT

**Current State**: PUT handler stores events but doesn't trigger scheduling logic.

**What's Missing**:

##### Organizer Change Detection
- [ ] Detect ATTENDEE additions
  - New ATTENDEE added to event → send REQUEST to new attendee
- [ ] Detect ATTENDEE removals
  - ATTENDEE removed from event → send CANCEL to removed attendee
- [ ] Detect ATTENDEE property changes
  - ROLE, PARTSTAT, RSVP changes → send REQUEST with updates

##### Attendee Change Detection
- [ ] Detect PARTSTAT updates
  - Attendee changes `PARTSTAT:NEEDS-ACTION` → `PARTSTAT:ACCEPTED`
  - Generate REPLY message to organizer
- [ ] Detect ATTENDEE property changes
  - DELEGATED-TO, DELEGATED-FROM updates

##### Cancellation Detection
- [ ] Detect `STATUS:CANCELLED`
  - Organizer cancels event → send CANCEL to all attendees

##### Automatic Message Generation
- [ ] Generate iTIP REQUEST message
  ```ical
  BEGIN:VCALENDAR
  METHOD:REQUEST
  PRODID:-//Shuriken//CalDAV Server//EN
  VERSION:2.0
  BEGIN:VEVENT
  UID:event-uid@domain.com
  SEQUENCE:1
  DTSTAMP:20260125T120000Z
  ORGANIZER:mailto:alice@example.com
  ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:bob@example.com
  DTSTART:20260201T100000Z
  DTEND:20260201T110000Z
  SUMMARY:Team Meeting
  END:VEVENT
  END:VCALENDAR
  ```
- [ ] Generate iTIP REPLY message
- [ ] Generate iTIP CANCEL message

**Estimated Effort**: 1-2 weeks

---

#### 4. Internal Scheduling Delivery

**Current State**: No message delivery mechanism.

**What's Missing**:

##### Local User Delivery
- [ ] Lookup recipient principal by `mailto:` URI
- [ ] Resolve to inbox collection
- [ ] POST iTIP message to recipient's inbox
- [ ] Create inbox resource with iTIP data

##### iTIP Message Wrapping
- [ ] Wrap event in VCALENDAR with METHOD property
- [ ] Set `Content-Type: text/calendar; method=REQUEST`
- [ ] Set appropriate headers (From, To, Subject for email)

##### Delivery Status Tracking
- [ ] Return `<C:schedule-response>` with per-recipient status
  ```xml
  <C:schedule-response xmlns:C="urn:ietf:params:xml:ns:caldav">
    <C:response>
      <C:recipient>
        <D:href>mailto:bob@example.com</D:href>
      </C:recipient>
      <C:request-status>2.0;Success</C:request-status>
    </C:response>
  </C:schedule-response>
  ```

**Estimated Effort**: 1 week

---

#### 5. iMIP Gateway (Future, Optional)

**Current State**: No email integration.

**What's Missing**:

##### Outbound Email for External Attendees
- [ ] Detect external attendees (not local principals)
- [ ] Generate iMIP email with iTIP attachment
- [ ] Send via SMTP
- [ ] Handle delivery failures

##### Inbound Email Parsing
- [ ] Receive emails with iTIP attachments
- [ ] Parse `text/calendar` MIME part
- [ ] Validate sender (DKIM/SPF)
- [ ] Route to recipient's inbox

##### Security
- [ ] DKIM signature verification
- [ ] SPF record checking
- [ ] Prevent spoofing (verify ORGANIZER matches sender)

**Note**: iMIP is complex and requires email infrastructure. Defer until core scheduling works.

**Estimated Effort**: 2-3 weeks (if needed)

---

## RFC Compliance

| RFC Requirement | Status | Impact |
|-----------------|--------|--------|
| RFC 4791 §7.10: free-busy-query | ❌ Missing | No free-busy support |
| RFC 6638 §2: Scheduling collections | ❌ Missing | No scheduling |
| RFC 6638 §3: Implicit scheduling | ❌ Missing | No iTIP generation |
| RFC 6638 §4: Scheduling inbox/outbox | ❌ Missing | No message delivery |
| RFC 5546: iTIP (METHOD property) | ❌ Missing | No scheduling messages |
| RFC 6047: iMIP (email iTIP) | ❌ Missing | No email scheduling |
| RFC 3744: read-free-busy privilege | ❌ Missing | No freebusy-specific ACL |

**Compliance Score**: 0/7 features (0%)

---

## Next Steps

### Immediate Priorities

1. **Implement free-busy-query** — HIGH PRIORITY
   - Required for meeting scheduling UX
   - Relatively isolated feature (no dependencies)
   - Estimated effort: 1 week

2. **Create scheduling collections schema** — MEDIUM PRIORITY
   - Add inbox/outbox collections
   - Add `dav_schedule_message` table
   - Estimated effort: 3-5 days

3. **Implement internal scheduling delivery** — MEDIUM PRIORITY
   - Local user message delivery
   - iTIP message generation
   - Estimated effort: 1-2 weeks

### Phase 5 Dependencies

4. **Add recurrence support to free-busy** — CRITICAL
   - Requires Phase 5 RRULE expansion
   - Aggregate recurring events correctly
   - Estimated effort: 2-3 days (after Phase 5)

### Future (Optional)

5. **Implement iMIP gateway** — LOW PRIORITY
   - Only needed for external attendee support
   - Requires SMTP infrastructure
   - Estimated effort: 2-3 weeks

---

## Use Cases

### Free-Busy Query
- **User Alice** wants to schedule a meeting with Bob
- Alice queries Bob's free-busy for next week
- Server returns busy periods without event details
- Alice picks a free slot and creates event with Bob as attendee

### Internal Scheduling
- **User Alice** creates event and invites Bob
- Server generates iTIP REQUEST message
- Message posted to Bob's inbox
- Bob accepts → Server generates iTIP REPLY to Alice
- Alice's calendar updates Bob's PARTSTAT to ACCEPTED

### External Scheduling (with iMIP)
- **User Alice** invites `external@example.com`
- Server sends iMIP email with iTIP attachment
- External user replies via email client
- Server parses iMIP reply and updates Alice's calendar

---

## Dependencies

**Blocks**: None — Scheduling is a standalone feature.

**Depends On**: 
- Phase 5 (Recurrence) — Required for recurring event free-busy
- Phase 2 (Database Operations) — Fully implemented

---

## Next Phase: Phase 8

**Focus**: Authorization Integration (ACL properties, privilege discovery, sharing)

**Status**: ⚠️ **PARTIAL (40%)**
