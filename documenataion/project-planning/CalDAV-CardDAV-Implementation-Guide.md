# CalDAV/CardDAV Implementation Guide for Shuriken

This document provides an exhaustive technical reference for implementing CalDAV (RFC 4791) and CardDAV (RFC 6352) support in Shuriken. It covers parsing, serialization, backend logic, HTTP handling, synchronization, and authorization.

---

## Table of Contents

1. [Protocol Overview](#1-protocol-overview)
2. [Data Formats](#2-data-formats)
3. [Parsing & Deserialization](#3-parsing--deserialization)
4. [Serialization](#4-serialization)
5. [HTTP Methods & Request Handling](#5-http-methods--request-handling)
6. [REPORT Operations](#6-report-operations)
7. [Synchronization](#7-synchronization)
8. [Recurrence Expansion](#8-recurrence-expansion)
9. [Time Zone Handling](#9-time-zone-handling)
10. [Free-Busy Queries](#10-free-busy-queries)
11. [Scheduling (iTIP)](#11-scheduling-itip)
12. [Authorization & Access Control](#12-authorization--access-control)
13. [Service Discovery](#13-service-discovery)
14. [Database Schema Mapping](#14-database-schema-mapping)
15. [Error Handling & Preconditions](#15-error-handling--preconditions)
16. [Implementation Phases](#16-implementation-phases)
17. [RFC-by-RFC Coverage Checklist](#17-rfc-by-rfc-coverage-checklist)

---

## 1. Protocol Overview

### 1.1 CalDAV (RFC 4791)

CalDAV extends WebDAV to provide calendar access. Core concepts:

| Concept | Description |
|---------|-------------|
| **Calendar Collection** | WebDAV collection containing calendar object resources; `DAV:resourcetype` includes `DAV:collection` and `CALDAV:calendar` |
| **Calendar Object Resource** | Individual `.ics` file containing one iCalendar object (one UID, possibly with recurrence overrides) |
| **Principal** | Identity for ACL; users access calendars via `CALDAV:calendar-home-set` |
| **Scheduling** | RFC 6638 defines implicit scheduling via `schedule-inbox` and `schedule-outbox` collections |

**Required Capabilities** (RFC 4791 §2):
- MUST support iCalendar (RFC 5545) as a media type
- MUST support WebDAV Class 1 (RFC 4918)
- MUST support WebDAV ACL (RFC 3744)
- MUST support transport over TLS (HTTPS/TLS)
- MUST support ETags with strong validators
- MUST advertise report support via the `DAV:supported-report-set` property (RFC 3253)
- MUST support all calendaring reports (`calendar-query`, `calendar-multiget`, `free-busy-query`)
- MKCALENDAR method (SHOULD support)

### 1.2 CardDAV (RFC 6352)

CardDAV extends WebDAV for address book access. Core concepts:

| Concept | Description |
|---------|-------------|
| **Address Book Collection** | WebDAV collection containing address object resources; `DAV:resourcetype` includes `DAV:collection` and `CARDDAV:addressbook` |
| **Address Object Resource** | Individual `.vcf` file containing exactly one vCard |
| **Principal** | Identity for ACL; users access addressbooks via `CARDDAV:addressbook-home-set` |
| **Principal Address** | Optional vCard resource representing the principal (`CARDDAV:principal-address`) |

**Required Capabilities** (RFC 6352 §3):
- MUST support vCard v3 (RFC 2426) as a media type; SHOULD support vCard v4 (RFC 6350)
- MUST support WebDAV Class 3 (RFC 4918)
- MUST support WebDAV ACL (RFC 3744)
- MUST support secure transport (HTTPS/TLS)
- MUST support ETags with strong validators
- MUST advertise report support via the `DAV:supported-report-set` property (RFC 3253)
- MUST support all addressbook reports (`addressbook-query`, `addressbook-multiget`)
- MUST support the `DAV:expand-property` report (RFC 3253 §3.8)

**Recommended Capabilities**:
- Extended MKCOL (RFC 5689) for creating address book collections
- `DAV:current-user-principal` (RFC 5397; RFC 6352 refers to this as `DAV:current-user-principal-URL`) for principal discovery

#### 1.2.1 Address Book Collection Constraints

| Constraint | Description |
|------------|-------------|
| Single vCard per resource | Each address object resource contains exactly ONE vCard |
| UID uniqueness | UID MUST be unique within the address book collection |
| No nested address books | Address book collections MUST NOT contain other address books at any depth |
| Allowed child types | Address book collections MUST only contain address object resources and collections that are not address book collections |
| Sub-collections allowed | Non-addressbook collections MAY exist but MUST NOT contain address books |

#### 1.2.2 CardDAV Collection Properties

| Property | Protected | Description |
|----------|-----------|-------------|
| `CARDDAV:addressbook-description` | No | Human-readable collection description |
| `CARDDAV:supported-address-data` | Yes | Supported vCard media types/versions |
| `CARDDAV:max-resource-size` | Yes | Maximum size in octets for address objects |
| `CARDDAV:supported-collation-set` | Yes | Supported text collations for queries |

**supported-address-data Example**:
```xml
<C:supported-address-data xmlns:C="urn:ietf:params:xml:ns:carddav">
  <C:address-data-type content-type="text/vcard" version="3.0"/>
  <C:address-data-type content-type="text/vcard" version="4.0"/>
</C:supported-address-data>
```

#### 1.2.3 CardDAV Principal Properties

| Property | Description |
|----------|-------------|
| `CARDDAV:addressbook-home-set` | URL(s) of collections containing user's address books |
| `CARDDAV:principal-address` | URL of vCard representing the principal |

**addressbook-home-set Example**:
```xml
<C:addressbook-home-set xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:href>/addressbooks/user/</D:href>
</C:addressbook-home-set>
```

#### 1.2.4 CardDAV Preconditions for PUT/COPY/MOVE

| Precondition | Triggered When |
|--------------|----------------|
| `CARDDAV:supported-address-data` | Unsupported media type |
| `CARDDAV:valid-address-data` | Invalid vCard syntax |
| `CARDDAV:no-uid-conflict` | UID already exists in collection (or UID changed on update) |
| `CARDDAV:addressbook-collection-location-ok` | Destination doesn't allow address book creation |
| `CARDDAV:max-resource-size` | Resource exceeds size limit |

**no-uid-conflict Response**:
```xml
<D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <C:no-uid-conflict>
    <D:href>/addressbooks/user/contacts/existing.vcf</D:href>
  </C:no-uid-conflict>
</D:error>
```

### 1.3 XML Namespaces

| Prefix | Namespace URI |
|--------|---------------|
| `DAV:` | `DAV:` |
| `CALDAV:` | `urn:ietf:params:xml:ns:caldav` |
| `CARDDAV:` | `urn:ietf:params:xml:ns:carddav` |
| `CS:` | `http://calendarserver.org/ns/` (Apple extensions) |

---

## 2. Data Formats

### 2.1 iCalendar (RFC 5545)

#### 2.1.1 Content Line Grammar

```abnf
contentline   = name *(";" param) ":" value CRLF
name          = iana-token / x-name
iana-token    = 1*(ALPHA / DIGIT / "-")
x-name        = "X-" [vendorid "-"] 1*(ALPHA / DIGIT / "-")
vendorid      = 3*(ALPHA / DIGIT)
param         = param-name "=" param-value *("," param-value)
param-value   = paramtext / quoted-string
paramtext     = *SAFE-CHAR
quoted-string = DQUOTE *QSAFE-CHAR DQUOTE
SAFE-CHAR     = WSP / %x21 / %x23-2B / %x2D-39 / %x3C-7E / NON-US-ASCII
                ; excludes CONTROL, DQUOTE, ";", ":", ","
QSAFE-CHAR    = WSP / %x21 / %x23-7E / NON-US-ASCII
                ; excludes CONTROL and DQUOTE
```

**Line Folding** (RFC 5545 §3.1):
- Lines SHOULD NOT exceed 75 octets (excluding CRLF)
- Fold by inserting `CRLF` followed by single linear whitespace (SPACE or HTAB)
- Unfold by removing `CRLF` immediately followed by single WSP
- **Critical**: Folding may split UTF-8 multi-octet sequences; unfold at the octet level before decoding to UTF-8

**Case Sensitivity**:
- Property names, parameter names, enumerated values: **case-insensitive**
- All other property values: **case-sensitive** (unless specified otherwise)
- Normalize to uppercase for property/parameter names when serializing

**Character Set**: Applications MUST generate iCalendar in UTF-8 and MUST accept UTF-8 or US-ASCII; other charsets are deprecated.

#### 2.1.2 Component Hierarchy

```
VCALENDAR                              ; Wrapper (exactly one per stream typically)
├── PRODID (required, once)            ; "-//Company//Product//EN"
├── VERSION (required, once)           ; Must be "2.0"
├── CALSCALE (optional, once)          ; Default: "GREGORIAN"
├── METHOD (optional, once)            ; iTIP method (MUST NOT appear in CalDAV storage)
├── NAME (optional, RFC 7986)          ; Human-readable calendar name
├── DESCRIPTION (optional, RFC 7986)   ; Calendar description
├── COLOR (optional, RFC 7986)         ; CSS3 color name
├── SOURCE (optional, RFC 7986)        ; URI for calendar refresh
├── REFRESH-INTERVAL (optional, RFC 7986) ; Polling interval
│
├── VTIMEZONE* (zero or more)
│   ├── TZID (required)                ; e.g., "America/New_York"
│   ├── LAST-MODIFIED (optional)
│   ├── TZURL (optional)               ; URI to authoritative definition
│   ├── STANDARD+ / DAYLIGHT+ (at least one required)
│   │   ├── DTSTART (required)         ; Local time, no TZID
│   │   ├── TZOFFSETFROM (required)    ; UTC offset before transition
│   │   ├── TZOFFSETTO (required)      ; UTC offset after transition
│   │   ├── RRULE (optional)           ; Recurrence for DST transitions
│   │   ├── RDATE (optional)           ; Additional transition dates
│   │   ├── TZNAME (optional)          ; e.g., "EST", "EDT"
│   │   └── COMMENT (optional)
│
├── VEVENT*
│   ├── UID (required)                 ; Globally unique identifier
│   ├── DTSTAMP (required)             ; Creation/modification timestamp (UTC)
│   ├── DTSTART (required)
│   ├── DTEND / DURATION (optional, mutually exclusive)
│   ├── RRULE (optional, SHOULD occur at most once)
│   ├── RDATE, EXDATE (optional, may repeat)
│   ├── RECURRENCE-ID (for overrides)
│   ├── SUMMARY, DESCRIPTION, LOCATION (optional)
│   ├── CLASS (optional: PUBLIC/PRIVATE/CONFIDENTIAL)
│   ├── STATUS (optional: TENTATIVE/CONFIRMED/CANCELLED)
│   ├── TRANSP (optional: OPAQUE/TRANSPARENT)
│   ├── PRIORITY (optional: 0-9, 0=undefined, 1=highest)
│   ├── ORGANIZER (optional, required for scheduling)
│   ├── ATTENDEE* (optional, may repeat)
│   ├── CATEGORIES* (optional, may repeat)
│   ├── GEO (optional: latitude;longitude)
│   ├── CREATED, LAST-MODIFIED, SEQUENCE (optional)
│   ├── URL, ATTACH* (optional)
│   ├── CONFERENCE* (optional, RFC 7986)
│   ├── IMAGE* (optional, RFC 7986)
│   ├── COLOR (optional, RFC 7986)
│   └── VALARM* (nested alarms)
│
├── VTODO*
│   ├── UID, DTSTAMP (required)
│   ├── DTSTART (optional)
│   ├── DUE / DURATION (optional, mutually exclusive; DURATION requires DTSTART)
│   ├── COMPLETED (optional, UTC)
│   ├── PERCENT-COMPLETE (optional: 0-100)
│   ├── STATUS (optional: NEEDS-ACTION/COMPLETED/IN-PROCESS/CANCELLED)
│   └── ... (similar to VEVENT)
│
├── VJOURNAL*
│   ├── UID, DTSTAMP (required)
│   ├── DTSTART (optional, typically DATE)
│   ├── DESCRIPTION* (may repeat)
│   ├── STATUS (optional: DRAFT/FINAL/CANCELLED)
│   └── ... (subset of VEVENT properties)
│
└── VFREEBUSY*
    ├── UID, DTSTAMP (required)
    ├── DTSTART, DTEND (optional)
    ├── ORGANIZER (optional)
    ├── ATTENDEE* (optional)
    └── FREEBUSY* (optional, may repeat)
```

**CalDAV Storage Constraints** (RFC 4791 §4.1):
- One calendar object resource contains exactly ONE main component type (VEVENT, VTODO, VJOURNAL, or VFREEBUSY) plus any required VTIMEZONE components
- All components sharing the same UID (master + overrides) MUST be in the same resource
- UID MUST be unique within a calendar collection
- METHOD property MUST NOT be present in stored resources
- VTIMEZONE MUST be included for every unique TZID referenced

#### 2.1.3 Value Types

| Type | Format | Example | Notes |
|------|--------|---------|-------|
| BINARY | BASE64 | `VGhlIHF1aWNr...` | Requires `;ENCODING=BASE64;VALUE=BINARY` |
| BOOLEAN | "TRUE" / "FALSE" | `TRUE` | Case-insensitive |
| CAL-ADDRESS | URI | `mailto:user@example.com` | Usually mailto: |
| DATE | YYYYMMDD | `19970714` | No time component |
| DATE-TIME | YYYYMMDD"T"HHMMSS[Z] | `19970714T133000Z` | See §2.1.5 for forms |
| DURATION | [+\|-]P[nW] or [+\|-]P[nD][T[nH][nM][nS]] | `P1DT2H30M` | No Y/M designators |
| FLOAT | [+\|-]digits[.digits] | `37.386013` | Used for GEO |
| INTEGER | [+\|-]digits | `5` | Range: -2147483648 to 2147483647 |
| PERIOD | start"/"end or start"/"duration | `19970101T180000Z/PT5H30M` | Start must precede end |
| RECUR | rule-parts | `FREQ=WEEKLY;BYDAY=MO,WE,FR` | See §2.1.6 |
| TEXT | escaped-text | `Meeting\, 2PM` | See §2.1.4 for escaping |
| TIME | HHMMSS[Z] | `133000Z` | Rare standalone use |
| URI | RFC 3986 URI | `https://example.com` | No escaping needed |
| UTC-OFFSET | (+\|-)HHMM[SS] | `+0530` | "-0000" is invalid |

#### 2.1.4 Text Escaping

Within TEXT values, these characters MUST be escaped with backslash:

| Character | Escape Sequence | Notes |
|-----------|-----------------|-------|
| Backslash `\` | `\\` | |
| Comma `,` | `\,` | In multi-value properties |
| Semicolon `;` | `\;` | In structured values (N, ADR) |
| Newline | `\n` or `\N` | Intentional line breaks |
| Colon `:` | NOT escaped | Unlike semicolon/comma |

**Parameter Value Encoding** (RFC 6868):
When parameter values contain special characters, use caret escaping:

| Sequence | Meaning |
|----------|---------|
| `^^` | Literal `^` |
| `^n` | Newline (LF) |
| `^'` | Double quote `"` |

#### 2.1.5 DATE-TIME Forms (RFC 5545 §3.3.5)

Three mutually exclusive forms:

| Form | Format | Example | Semantics |
|------|--------|---------|-----------|
| **Floating** | YYYYMMDD"T"HHMMSS | `19980118T230000` | Same wall-clock time in any timezone |
| **UTC** | YYYYMMDD"T"HHMMSS"Z" | `19980119T070000Z` | Absolute instant |
| **Zoned** | TZID=...;YYYYMMDD"T"HHMMSS | `TZID=America/New_York:19980119T020000` | Local time with TZID reference |

**Invalid Form**: `19980119T230000-0800` (UTC offset suffix is NOT allowed in iCalendar)

**DST Ambiguity Rules**:
- When local time occurs twice (fall-back): refers to first occurrence (before transition)
- When local time doesn't exist (spring-forward): interpret using offset before gap

**Leap Seconds**: Second value `60` is valid only for positive leap seconds. Implementations not supporting leap seconds SHOULD treat as `59`.

#### 2.1.6 Recurrence Rules (RRULE) — RFC 5545 §3.3.10

```abnf
recur = recur-rule-part *(";" recur-rule-part)
; FREQ is REQUIRED and SHOULD appear first for compatibility
; UNTIL and COUNT are mutually exclusive
```

| Part | Values | Default | Notes |
|------|--------|---------|-------|
| FREQ | SECONDLY, MINUTELY, HOURLY, DAILY, WEEKLY, MONTHLY, YEARLY | (required) | |
| INTERVAL | positive integer | 1 | Every Nth occurrence |
| UNTIL | DATE or DATE-TIME | (none) | Inclusive bound; must match DTSTART type |
| COUNT | positive integer | (none) | Total occurrences including DTSTART |
| WKST | SU, MO, TU, WE, TH, FR, SA | MO | Week start day |
| BYSECOND | 0-60 | | 60 for leap second |
| BYMINUTE | 0-59 | | |
| BYHOUR | 0-23 | | |
| BYDAY | [±n]SU/MO/TU/WE/TH/FR/SA | | +1MO = first Monday; -1FR = last Friday |
| BYMONTHDAY | ±1 to ±31 | | -1 = last day of month |
| BYYEARDAY | ±1 to ±366 | | |
| BYWEEKNO | ±1 to ±53 | | ISO 8601 week numbers; YEARLY only |
| BYMONTH | 1-12 | | |
| BYSETPOS | ±1 to ±366 | | Filter on position within frequency set |

**BYxxx Expansion/Limit Behavior** (RFC 5545 Table):

| Part | DAILY | WEEKLY | MONTHLY | YEARLY |
|------|-------|--------|---------|--------|
| BYMONTH | Limit | Limit | Limit | Expand |
| BYWEEKNO | N/A | N/A | N/A | Expand |
| BYYEARDAY | N/A | N/A | N/A | Expand |
| BYMONTHDAY | Limit | N/A | Expand | Expand |
| BYDAY | Limit | Expand | Special¹ | Special² |
| BYHOUR | Expand | Expand | Expand | Expand |
| BYMINUTE | Expand | Expand | Expand | Expand |
| BYSECOND | Expand | Expand | Expand | Expand |
| BYSETPOS | Limit | Limit | Limit | Limit |

¹ MONTHLY+BYDAY: Limit if BYMONTHDAY present; otherwise expand to all matching weekdays
² YEARLY+BYDAY: Complex rules depending on BYWEEKNO, BYMONTH presence

**Evaluation Order**: BYMONTH → BYWEEKNO → BYYEARDAY → BYMONTHDAY → BYDAY → BYHOUR → BYMINUTE → BYSECOND → BYSETPOS → COUNT/UNTIL

**Invalid Instance Handling**: Skip instances with invalid dates (Feb 30) or nonexistent local times (DST gap).

**UNTIL Synchronization** (RFC 5545):
- If DTSTART is DATE, UNTIL must be DATE
- If DTSTART is DATE-TIME with TZID or UTC, UNTIL must be UTC (with Z suffix)
- VTIMEZONE STANDARD/DAYLIGHT: UNTIL must always be UTC

#### 2.1.7 VALARM Component

Three action types with different required properties:

| ACTION | Required Properties | Optional |
|--------|---------------------|----------|
| AUDIO | TRIGGER | ATTACH (sound URI), DURATION+REPEAT |
| DISPLAY | TRIGGER, DESCRIPTION | DURATION+REPEAT |
| EMAIL | TRIGGER, DESCRIPTION, SUMMARY, ATTENDEE+ | ATTACH*, DURATION+REPEAT |

**TRIGGER** can be:
- Relative duration: `-PT15M` (15 min before; default relative to START)
- Absolute: `VALUE=DATE-TIME:19970317T133000Z`
- RELATED parameter: `RELATED=END` (relative to DTEND/DUE)

**DURATION+REPEAT**: If present, both must appear together. REPEAT specifies additional triggers after initial.

#### 2.1.8 Extended Properties (RFC 7986)

RFC 7986 adds properties for richer calendar metadata:

| Property | Scope | Value Type | Purpose |
|----------|-------|------------|---------|
| NAME | VCALENDAR | TEXT | Human-readable calendar name |
| DESCRIPTION | VCALENDAR | TEXT | Calendar description |
| UID | VCALENDAR | TEXT | Calendar identifier |
| LAST-MODIFIED | VCALENDAR | DATE-TIME | Calendar modification time |
| URL | VCALENDAR | URI | Alternative calendar location |
| CATEGORIES | VCALENDAR | TEXT | Calendar categories |
| REFRESH-INTERVAL | VCALENDAR | DURATION | Suggested polling interval |
| SOURCE | VCALENDAR | URI | Location for data refresh |
| COLOR | VCALENDAR, components | TEXT | CSS3 color name (e.g., "turquoise") |
| IMAGE | VCALENDAR, components | URI/BINARY | Associated image |
| CONFERENCE | VEVENT, VTODO | URI | Video/audio conference URI |

**UID Best Practice** (RFC 7986 update): Generate hex-encoded random UUIDs. MUST NOT include identifying information (hostname, email, IP address) for privacy.

#### 2.1.9 Client Compatibility & Provider Quirks

##### Apple Calendar (macOS/iOS)

| Behavior | Notes |
|----------|-------|
| **X-APPLE-TRAVEL-ADVISORY-BEHAVIOR** | Custom property for travel time |
| **VALARM proximity** | Supports `X-APPLE-PROXIMITY` for location-based alarms |
| **Timezone handling** | Prefers IANA TZIDs; may emit proprietary `/Apple/...` prefixes in edge cases |
| **ATTACH** | Supports inline BASE64 for small attachments |
| **Default alarms** | Applies per-calendar default alarms unless `X-APPLE-DEFAULT-ALARM:FALSE` |
| **Floating time** | Treats floating times as device-local timezone |
| **VTODO** | Full support including PERCENT-COMPLETE and subtasks |
| **Recurrence limits** | May limit expansion to ~4 years ahead for performance |

##### Google Calendar

| Behavior | Notes |
|----------|-------|
| **X-properties** | Uses `X-GOOGLE-*` for conferencing, attachments, etc. |
| **CONFERENCE** | Generates `X-GOOGLE-CONFERENCE` alongside RFC 7986 CONFERENCE |
| **VALARM** | Only DISPLAY and EMAIL; ignores AUDIO |
| **VTODO** | NOT supported in Google Calendar UI |
| **All-day events** | Creates as DATE (not DATE-TIME) for DTSTART/DTEND |
| **RECURRENCE-ID** | Requires exact match with master DTSTART format |
| **Timezone** | Requires VTIMEZONE for all non-UTC times; may reject unknown TZIDs |
| **UID stability** | May modify UID on import; use ETag for identity |
| **RRULE limits** | COUNT limited to 730; complex rules may be simplified |
| **EXDATE timezone** | EXDATE TZID must match DTSTART TZID exactly |

##### Microsoft Outlook/Exchange

| Behavior | Notes |
|----------|-------|
| **X-MICROSOFT-*** | Various proprietary properties |
| **All-day events** | May emit `X-MICROSOFT-CDO-ALLDAYEVENT:TRUE` |
| **VTIMEZONE** | Often uses Windows timezone names; may not recognize IANA IDs |
| **VALARM** | EMAIL alarms may not work cross-platform |
| **RRULE complexity** | Limited support for BYYEARDAY, BYWEEKNO |
| **ATTENDEE RSVP** | Requires specific property combinations for proper scheduling |
| **Line folding** | Older versions may break UTF-8 sequences |
| **Time precision** | May truncate to minute precision |
| **Categories** | Case-insensitive matching |

##### General Interoperability Guidelines

1. **Always include VTIMEZONE** for zoned DATE-TIME values
2. **Use IANA timezone IDs** (e.g., `America/New_York`, not `Eastern Standard Time`)
3. **Limit RRULE complexity**: Avoid BYSECOND, BYMINUTE for events; prefer simple patterns
4. **VALARM**: Use DISPLAY for maximum compatibility; EMAIL for Outlook
5. **UID format**: Use UUID v4/v7 hex strings, not email-based identifiers
6. **DTSTAMP**: Always UTC; update on every modification
7. **SEQUENCE**: Increment on significant changes for scheduling
8. **Text encoding**: Escape properly; assume clients may not handle all Unicode
9. **ATTENDEE/ORGANIZER**: Use lowercase mailto: URIs
10. **Test edge cases**: Feb 29, DST transitions, midnight boundaries

##### DAVx5 (Android)

| Behavior | Notes |
|----------|-------|
| Collection discovery | Commonly does a Depth: 1 PROPFIND on home-sets and expects `DAV:resourcetype`, `DAV:displayname`, and `DAV:getetag` consistently |
| Sync behavior | Uses `DAV:sync-token` when present; otherwise falls back to listing + multiget patterns |

##### Thunderbird (Calendar clients)

| Behavior | Notes |
|----------|-------|
| Strict XML parsing | Less forgiving of malformed XML namespaces/prefixes in PROPFIND/REPORT responses |
| ETag reliance | Relies heavily on `DAV:getetag` plus `If-Match`; weak/unstable ETags cause noisy resyncs |

### 2.2 vCard (RFC 6350)

#### 2.2.1 vCard 4.0 Structure

**Content Line Grammar** (RFC 6350 §3.3):

```abnf
vcard-entity = 1*vcard

vcard = "BEGIN:VCARD" CRLF
        "VERSION:4.0" CRLF
        1*contentline
        "END:VCARD" CRLF

contentline = [group "."] name *(";" param) ":" value CRLF

group = 1*(ALPHA / DIGIT / "-")
name  = "FN" / "N" / "ADR" / "TEL" / "EMAIL" / ... / x-name / iana-token
param = param-name "=" param-value *("," param-value)
```

**Required Properties**:
- VERSION: MUST be "4.0" and MUST appear immediately after BEGIN:VCARD
- FN: MUST be present (formatted name for display)

**Charset**: UTF-8 only (RFC 6350 §3.1). No charset parameter; specifying non-UTF-8 is invalid.

**Line Folding**: Same as iCalendar—CRLF + (SPACE or HTAB). Maximum 75 octets SHOULD. Folding may split UTF-8 multi-octet sequences; unfold at the octet level before decoding.

**CardDAV Storage Constraint** (RFC 6352 §5.1):
- One address object resource contains exactly ONE vCard
- UID MUST be unique within an address book collection
- Server MUST reject PUT with duplicate UID (CARDDAV:no-uid-conflict)

#### 2.2.2 Property Cardinality Notation

| Symbol | Meaning |
|--------|---------|
| 1 | Exactly one instance MUST be present |
| *1 | At most one instance MAY be present |
| 1* | One or more instances MUST be present |
| * | Zero or more instances MAY be present |

#### 2.2.3 Complete Property Reference

**General Properties**:

| Property | Cardinality | Default Type | Description |
|----------|-------------|--------------|-------------|
| BEGIN | 1 | text | Always "VCARD" |
| END | 1 | text | Always "VCARD" |
| VERSION | 1 | text | Always "4.0" |
| SOURCE | * | uri | URL to retrieve latest vCard |
| KIND | *1 | text | individual/group/org/location (default: individual) |
| XML | * | text | Extended XML data (namespace required) |

**Identification Properties**:

| Property | Cardinality | Default Type | Description |
|----------|-------------|--------------|-------------|
| FN | 1* | text | Formatted name (required) |
| N | *1 | structured | 5 components: family;given;additional;prefix;suffix |
| NICKNAME | * | text-list | Comma-separated nicknames |
| PHOTO | * | uri | Photo URI or data: URI |
| BDAY | *1 | date-and-or-time | Birthday (may use truncated dates) |
| ANNIVERSARY | *1 | date-and-or-time | Marriage/equivalent date |
| GENDER | *1 | structured | sex;identity (M/F/O/N/U + freeform) |

**Delivery Addressing**:

| Property | Cardinality | Default Type | Description |
|----------|-------------|--------------|-------------|
| ADR | * | structured | 7 components: PO;ext;street;locality;region;postal;country |

**Communications**:

| Property | Cardinality | Default Type | Description |
|----------|-------------|--------------|-------------|
| TEL | * | uri or text | tel: URI preferred; TYPE for voice/cell/fax/etc. |
| EMAIL | * | text | Email address |
| IMPP | * | uri | Instant messaging URI (xmpp:, sip:, etc.) |
| LANG | * | language-tag | Preferred communication languages |

**Geographical**:

| Property | Cardinality | Default Type | Description |
|----------|-------------|--------------|-------------|
| TZ | * | text/uri/utc-offset | Timezone (IANA ID preferred) |
| GEO | * | uri | geo: URI (RFC 5870) |

**Organizational**:

| Property | Cardinality | Default Type | Description |
|----------|-------------|--------------|-------------|
| TITLE | * | text | Job title |
| ROLE | * | text | Role/function |
| LOGO | * | uri | Logo image |
| ORG | * | structured | org-name;unit1;unit2;... |
| MEMBER | * | uri | Group member UID or URI (KIND=group only) |
| RELATED | * | uri or text | Related entity with TYPE |

**Explanatory**:

| Property | Cardinality | Default Type | Description |
|----------|-------------|--------------|-------------|
| CATEGORIES | * | text-list | Tags/categories |
| NOTE | * | text | Free-form notes |
| PRODID | *1 | text | Product identifier |
| REV | *1 | timestamp | Last revision (use UTC/Z for interoperability) |
| SOUND | * | uri | Pronunciation audio |
| UID | *1 | uri or text | Unique identifier (urn:uuid: recommended) |
| CLIENTPIDMAP | * | structured | Sync PID mapping |
| URL | * | uri | Associated URL |

**Security**:

| Property | Cardinality | Default Type | Description |
|----------|-------------|--------------|-------------|
| KEY | * | uri or text | Public key or certificate |

**Calendar**:

| Property | Cardinality | Default Type | Description |
|----------|-------------|--------------|-------------|
| FBURL | * | uri | Free/busy URL |
| CALADRURI | * | uri | Calendar scheduling address |
| CALURI | * | uri | Calendar URL |

#### 2.2.4 Value Types (RFC 6350 §4)

| Type | Format | Example | Notes |
|------|--------|---------|-------|
| TEXT | escaped-text | `Meeting\, today` | See §2.2.5 |
| URI | RFC 3986 | `https://example.com` | Unescaped |
| DATE | YYYYMMDD or truncated | `19850412`, `--0412`, `---12` | ISO 8601 basic |
| TIME | HHMMSS[zone] or truncated | `102200Z`, `-2200` | See below |
| DATE-TIME | date "T" time | `19961022T140000` | Date truncation is permitted (RFC 6350 §4.3.3) |
| DATE-AND-OR-TIME | date-time / date / "T" time | `T102200Z` | Standalone time has T |
| TIMESTAMP | full date "T" full time | `19961022T140000Z` | Complete, often UTC |
| BOOLEAN | TRUE / FALSE | `TRUE` | Case-insensitive |
| INTEGER | [+\|-]digits | `-1234567890` | 64-bit signed |
| FLOAT | [+\|-]digits[.digits] | `37.386013` | No scientific notation |
| UTC-OFFSET | (+\|-)HHMM | `-0500` | Should avoid; use TZ name |
| LANGUAGE-TAG | RFC 5646 | `en-US` | BCP 47 |

**Truncated Date Formats** (vCard-specific):

| Format | Example | Meaning |
|--------|---------|---------|
| YYYY | `1985` | Year only |
| YYYY-MM | `1985-04` | Year and month (note hyphen) |
| --MMDD | `--0412` | Month and day (no year) |
| ---DD | `---12` | Day only |

**Truncated Time Formats**:

| Format | Example | Meaning |
|--------|---------|---------|
| -MMSS | `-2200` | Minute and second (no hour) |
| --SS | `--00` | Second only |

#### 2.2.5 Value Escaping (RFC 6350 §3.4)

| Character | Escape | Where Required |
|-----------|--------|----------------|
| Backslash `\` | `\\` | Always |
| Comma `,` | `\,` | Always (even single-value) |
| Semicolon `;` | `\;` | In compound properties (N, ADR, ORG) |
| Newline | `\n` or `\N` | Always |

**Critical Difference from iCalendar**: Colon (`:`) is NOT escaped.

**Compound Properties** have multiple fields separated by `;`. Each field may contain multiple values separated by `,`.

```
N:Public;John;Quinlan,Paul;Mr.;Esq.
   │       │     │          │    └── suffixes: ["Esq."]
   │       │     │          └────── prefixes: ["Mr."]
   │       │     └───────────────── additional: ["Quinlan", "Paul"]
   │       └─────────────────────── given: ["John"]
   └─────────────────────────────── family: ["Public"]
```

**Example with escaping**:

```
ORG:ABC\, Inc.;North American Division;Marketing
    └── Single org name with comma ───┘
```

#### 2.2.6 Parameters (RFC 6350 §5)

| Parameter | Purpose | Example |
|-----------|---------|---------|
| LANGUAGE | Language of value | `LANGUAGE=fr-CA` |
| VALUE | Override default value type | `VALUE=uri` |
| PREF | Preference 1-100 (1=highest) | `PREF=1` |
| ALTID | Link alternative representations | `ALTID=1` |
| PID | Property instance identifier | `PID=1.1` |
| TYPE | Property classification | `TYPE=work,voice` |
| MEDIATYPE | Media type hint for URI | `MEDIATYPE=image/jpeg` |
| CALSCALE | Calendar system | `CALSCALE=gregorian` |
| SORT-AS | Sort key override | `SORT-AS="Doe,John"` |
| GEO | Geo-tag for ADR | `GEO="geo:12.34,56.78"` |
| TZ | Timezone for ADR | `TZ=America/New_York` |
| LABEL | Formatted address label | `LABEL="123 Main St\nCity"` |

**PREF Semantics**: 
- Relative within same property name in same vCard
- Lower value = higher preference
- Absent = lowest preference

**ALTID Semantics**:
- Properties with same name and same ALTID are alternative representations
- Typically used with LANGUAGE for translations
- Count as ONE toward cardinality

**PID for Synchronization**:
- Format: `local-id` or `local-id.source-id`
- Used with CLIENTPIDMAP for cross-device sync
- Source-id maps to URI in CLIENTPIDMAP

#### 2.2.7 KIND Property Values

| Kind | Description | Special Rules |
|------|-------------|---------------|
| individual | Person (default) | Standard vCard |
| group | Group of entities | May have MEMBER properties |
| org | Organization | MUST NOT have MEMBER |
| location | Named place | Usually has GEO or ADR |

**Group vCard Example**:

```
BEGIN:VCARD
VERSION:4.0
KIND:group
FN:The Doe Family
MEMBER:urn:uuid:03a0e51f-d1aa-4385-8a53-e29025acd8af
MEMBER:urn:uuid:b8767877-b4a1-4c70-9acc-505d3819e519
END:VCARD
```

#### 2.2.8 TEL TYPE Values

| Type | Description |
|------|-------------|
| text | Supports SMS |
| voice | Voice telephone (default) |
| fax | Facsimile |
| cell | Mobile/cellular |
| video | Video conferencing |
| pager | Paging device |
| textphone | TTY/TDD |
| work | Work number |
| home | Personal number |

**Preferred Format** (vCard 4.0):

```
TEL;VALUE=uri;TYPE="voice,cell";PREF=1:tel:+1-555-555-5555;ext=102
```

#### 2.2.9 RELATED TYPE Values

| Type | Meaning |
|------|---------|
| contact | General contact |
| acquaintance | Known person |
| friend | Friend |
| met | Have met |
| co-worker | Work colleague |
| colleague | Professional colleague |
| co-resident | Lives together |
| neighbor | Neighbor |
| child | Child |
| parent | Parent |
| sibling | Sibling |
| spouse | Spouse |
| kin | Family member |
| muse | Source of inspiration |
| crush | Romantic interest |
| date | Dating |
| sweetheart | Romantic partner |
| me | The contact itself |
| agent | Acts on behalf of |
| emergency | Emergency contact |

#### 2.2.10 Client Compatibility & Provider Quirks

##### Apple Contacts (macOS/iOS)

| Behavior | Notes |
|----------|-------|
| **X-ABUID** | Apple-specific UID, separate from standard UID |
| **X-ABLABEL** | Custom labels for properties (replaces TYPE) |
| **X-ABADR** | Address formatting hints |
| **X-ABRELATEDNAMES** | Relationship labels |
| **PHOTO inline** | Prefers inline BASE64 over URIs for photos |
| **vCard 3.0** | Default export is vCard 3.0; may need conversion |
| **Group handling** | Uses X-ADDRESSBOOKSERVER-KIND for groups |
| **Property groups** | Extensive use of property grouping (item1.TEL, etc.) |

##### Google Contacts

| Behavior | Notes |
|----------|-------|
| **vCard version** | Exports vCard 3.0 by default |
| **X-GOOGLE-TALK** | Custom IM property |
| **PHOTO** | Prefers URL references to Google's CDN |
| **Groups** | Uses CATEGORIES for contact groups |
| **Custom fields** | X-GOOGLE-CUSTOM-LABEL |
| **Merging** | Aggressive duplicate detection by name/email |
| **UID handling** | May modify UID on import |
| **Missing properties** | May strip unknown X-properties |

##### Microsoft Outlook/Exchange

| Behavior | Notes |
|----------|-------|
| **vCard version** | Primarily vCard 2.1, limited 3.0/4.0 support |
| **X-MS-* properties** | Various proprietary extensions |
| **PHOTO encoding** | Often uses ENCODING=B (vCard 2.1 style) |
| **Character encoding** | May use CHARSET parameter (deprecated in 4.0) |
| **ADR format** | May not preserve all 7 components |
| **Line folding** | Older versions may break UTF-8 |
| **TYPE values** | May use non-standard TYPE values |

##### General Interoperability Guidelines

1. **UID format**: Use `urn:uuid:` prefix with UUID v4/v7
2. **PHOTO storage**: Accept both URI and data: inline; prefer URI for large images
3. **TEL format**: Accept both text and uri VALUE types
4. **N property**: Always include even if FN is primary; some clients require it
5. **VERSION placement**: Must be immediately after BEGIN:VCARD
6. **Character encoding**: Always UTF-8; reject CHARSET parameters
7. **Property groups**: Preserve on round-trip even if not understood
8. **X-properties**: Preserve unknown X-properties for round-trip
9. **vCard 3.0 import**: Be prepared to convert from 3.0 format
10. **Empty values**: Preserve structure (e.g., `N:;;;;`) for compound properties

##### DAVx5 (Android)

| Behavior | Notes |
|----------|-------|
| Group prefixes | Preserves `itemX.` group prefixes; losing them can break label associations in some contact apps |
| Photo payloads | Stable ETags matter for PHOTO-heavy address books to avoid repeated downloads |

##### Thunderbird (Address Book clients)

| Behavior | Notes |
|----------|-------|
| Partial retrieval | Often requests a limited set of properties via `CARDDAV:address-data`; ensure server honors partial retrieval |
| Filter support | Expects `CARDDAV:supported-filter` errors for unsupported filters rather than silently returning empty results |

---

## 3. Parsing & Deserialization

### 3.1 iCalendar Parser

**Implementation Path**: `src/component/rfc/ical/`

#### 3.1.1 Lexer Stage

Implement a streaming lexer:

1. **Line accumulation**: Read bytes until CRLF (or tolerate bare LF)
2. **Unfolding**: If next line starts with SPACE/HTAB, append remainder and continue
3. **UTF-8 boundary handling**: When unfolding, ensure multi-byte sequences aren't broken
4. **Tokenization**: Split at first unquoted `:` for name+params vs value

```rust
pub struct ContentLine<'a> {
    pub name: &'a str,              // Property name (uppercase normalized)
    pub params: Vec<Parameter<'a>>, // Parameters in order
    pub value: &'a str,             // Raw value (not yet parsed)
}

pub struct Parameter<'a> {
    pub name: &'a str,              // Parameter name (uppercase normalized)
    pub values: Vec<&'a str>,       // One or more values (comma-separated)
}
```

**Lexer Edge Cases**:

| Case | Handling |
|------|----------|
| Bare LF line endings | Accept (common in wild) |
| Missing final CRLF | Accept, complete the line |
| Line > 998 octets (MIME) | Accept (only 75 is "SHOULD") |
| Empty lines | Skip silently |
| BOM (U+FEFF) | Strip from start of stream |
| Control characters | Reject `%x00-08`, `%x0A-1F` except HTAB |
| Quoted parameter with `;:,` | Preserve literally |
| Unquoted parameter with `;:,` | Parse error |

**Parameter Parsing State Machine**:
```
START → NAME → "=" → (DQUOTE → QVALUE → DQUOTE | VALUE) → ("," → repeat | ";" → NAME | ":" → done)
```

#### 3.1.2 Parser Stage

Build a recursive component tree:

```rust
#[derive(Debug, Clone)]
pub enum ICalValue {
    Text(String),                   // Unescaped text
    DateTime(DateTimeValue),        // See below
    Date(NaiveDate),                // YYYYMMDD
    Duration(ICalDuration),         // Signed duration
    Integer(i64),                   // -2147483648..2147483647
    Float(f64),                     // IEEE 754
    Boolean(bool),                  // TRUE/FALSE
    Period(Period),                 // Start + end/duration
    Recur(RecurrenceRule),          // RRULE
    Uri(String),                    // Unescaped URI
    UtcOffset(i32),                 // Seconds from UTC
    Binary(Vec<u8>),                // Decoded BASE64
    CalAddress(String),             // mailto: URI typically
    Unknown(String),                // Preserve unknown types
}

#[derive(Debug, Clone)]
pub struct ICalProperty {
    pub name: String,               // Normalized uppercase
    pub params: Vec<ICalParameter>,
    pub value: ICalValue,           // Typed value
    pub raw_value: String,          // Original for round-trip
}

#[derive(Debug, Clone)]
pub struct ICalParameter {
    pub name: String,               // Normalized uppercase
    pub values: Vec<String>,        // Decoded values
}

#[derive(Debug, Clone)]
pub struct ICalComponent {
    pub name: String,               // VCALENDAR, VEVENT, etc.
    pub properties: Vec<ICalProperty>,
    pub children: Vec<ICalComponent>,
}

#[derive(Debug, Clone)]
pub struct ICalendar {
    pub prodid: String,
    pub version: String,            // "2.0"
    pub calscale: Option<String>,   // Default: GREGORIAN
    pub method: Option<String>,     // iTIP method (not in CalDAV storage)
    pub components: Vec<ICalComponent>,
}
```

**Type Resolution**: Determine value type from:
1. Explicit `VALUE=` parameter
2. Property-specific default type (per RFC 5545 property definitions)
3. Fall back to TEXT for unknown properties

#### 3.1.3 RRULE Parser

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Frequency {
    Secondly,
    Minutely,
    Hourly,
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

#[derive(Debug, Clone)]
pub struct WeekdayNum {
    pub ordinal: Option<i8>,        // +1 to +53 or -1 to -53; None = all
    pub weekday: Weekday,           // SU..SA
}

#[derive(Debug, Clone)]
pub struct RecurrenceRule {
    pub freq: Frequency,            // REQUIRED
    pub until: Option<DateTimeValue>,
    pub count: Option<u32>,
    pub interval: u32,              // Default: 1
    pub by_second: Vec<u8>,         // 0-60 (60 for leap second)
    pub by_minute: Vec<u8>,         // 0-59
    pub by_hour: Vec<u8>,           // 0-23
    pub by_day: Vec<WeekdayNum>,    // SU, +1MO, -1FR, etc.
    pub by_month_day: Vec<i8>,      // 1-31 or -31..-1
    pub by_year_day: Vec<i16>,      // 1-366 or -366..-1
    pub by_week_no: Vec<i8>,        // 1-53 or -53..-1
    pub by_month: Vec<u8>,          // 1-12
    pub by_set_pos: Vec<i16>,       // 1-366 or -366..-1
    pub wkst: Weekday,              // Default: MO
}
```

**RRULE Parsing Notes**:
- Parts are `;`-separated, order does not matter (but FREQ SHOULD be first for compatibility)
- UNTIL and COUNT are mutually exclusive; reject if both present
- BYDAY ordinal only valid for MONTHLY/YEARLY frequency
- Validate part combinations per RFC 5545 table (e.g., BYWEEKNO only with YEARLY)

#### 3.1.4 Date/Time Parsing

```rust
#[derive(Debug, Clone)]
pub enum DateTimeValue {
    /// DATE value: YYYYMMDD
    Date(NaiveDate),
    
    /// Floating DATE-TIME: YYYYMMDD"T"HHMMSS (no timezone binding)
    Floating(NaiveDateTime),
    
    /// UTC DATE-TIME: YYYYMMDD"T"HHMMSS"Z"
    Utc(DateTime<Utc>),
    
    /// Zoned DATE-TIME: TZID=...;YYYYMMDD"T"HHMMSS
    Zoned {
        datetime: NaiveDateTime,
        tzid: String,
    },
}

#[derive(Debug, Clone)]
pub struct ICalDuration {
    pub negative: bool,
    pub weeks: u32,                 // Mutually exclusive with days+time
    pub days: u32,
    pub hours: u32,
    pub minutes: u32,
    pub seconds: u32,
}

#[derive(Debug, Clone)]
pub struct Period {
    pub start: DateTime<Utc>,
    pub end: PeriodEnd,
}

#[derive(Debug, Clone)]
pub enum PeriodEnd {
    DateTime(DateTime<Utc>),
    Duration(ICalDuration),
}
```

**Parsing Patterns**:

```rust
// DATE: 8 digits
fn parse_date(s: &str) -> Result<NaiveDate> {
    // YYYYMMDD -> NaiveDate::from_ymd_opt(year, month, day)
}

// TIME: 6 digits + optional Z
fn parse_time(s: &str) -> Result<(NaiveTime, bool)> {
    // HHMMSS[Z] -> (time, is_utc)
}

// DATE-TIME: DATE "T" TIME
fn parse_datetime(s: &str, tzid: Option<&str>) -> Result<DateTimeValue> {
    // Handle floating, UTC, and zoned forms
}

// DURATION: [+|-]P(nW | nDTnHnMnS)
fn parse_duration(s: &str) -> Result<ICalDuration> {
    // Week form and day+time form are mutually exclusive
}
```

**Time Value Edge Cases**:

| Input | Handling |
|-------|----------|
| `235960` | Leap second; normalize to `235959` if unsupported |
| `240000` | Invalid; reject |
| `19700101T000000` with TZID | Valid; check DST history |
| Ambiguous local time (DST) | Use first occurrence per RFC 5545 |
| Non-existent local time (DST) | Use offset before gap per RFC 5545 |

#### 3.1.5 Text Unescaping

```rust
fn unescape_text(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') | Some('N') => result.push('\n'),
                Some(';') => result.push(';'),
                Some(',') => result.push(','),
                Some('\\') => result.push('\\'),
                Some(other) => {
                    // Lenient: preserve unknown escapes
                    result.push('\\');
                    result.push(other);
                }
                None => result.push('\\'),
            }
        } else {
            result.push(c);
        }
    }
    result
}
```

#### 3.1.6 Validation Rules

**Structural Validation**:

| Rule | Check |
|------|-------|
| VCALENDAR wrapper | First component must be VCALENDAR |
| VERSION required | Must be "2.0" |
| PRODID required | Non-empty string |
| Component nesting | Only VALARM can nest; only inside VEVENT/VTODO |
| UID uniqueness | Per calendar collection (CalDAV) |
| DTSTAMP required | For VEVENT, VTODO, VJOURNAL, VFREEBUSY |
| DTSTART for VEVENT | Required |
| DTEND/DURATION mutual exclusion | Cannot have both |
| VTIMEZONE coverage | Required for all referenced TZIDs |

**Recurrence Validation**:

| Rule | Check |
|------|-------|
| RRULE + RECURRENCE-ID | RECURRENCE-ID only on override instances |
| Same UID | All components with same UID in one resource |
| RECURRENCE-ID format | Must match DTSTART type (DATE or DATE-TIME) |
| RANGE=THISANDFUTURE | Only value; THISANDPRIOR is deprecated |
| EXDATE type | Must match DTSTART type |

### 3.2 vCard Parser

**Implementation Path**: `src/component/rfc/vcard/`

#### 3.2.1 Lexer Stage

Same content-line grammar as iCalendar but with vCard-specific extensions:

```rust
pub struct ContentLine<'a> {
    pub group: Option<&'a str>,     // Property grouping (item1, item2, etc.)
    pub name: &'a str,              // Property name (uppercase normalized)
    pub params: Vec<Parameter<'a>>, // Parameters in order
    pub value: &'a str,             // Raw value (not yet parsed)
}
```

**Lexer Edge Cases**:

| Case | Handling |
|------|----------|
| Property group prefix | Parse `group.NAME` format; preserve group name |
| Bare LF line endings | Accept (common in wild) |
| BOM (U+FEFF) | Strip from start of stream |
| Control characters | Reject except HTAB in folding |
| vCard 2.1 CHARSET | Warn/convert; 4.0 is UTF-8 only |
| vCard 2.1 ENCODING=QUOTED-PRINTABLE | Decode before unfolding |
| Empty parameter values | Accept (e.g., `TYPE=`) |

**Group Handling**:

```
item1.TEL:+1-555-555-5555
item1.X-ABLABEL:Mobile

item2.TEL:+1-555-555-5556
item2.X-ABLABEL:Work
```

Groups associate related properties. Preserve group prefixes for round-trip fidelity.

#### 3.2.2 Parser Stage

```rust
#[derive(Debug, Clone)]
pub enum VCardValue {
    Text(String),                   // Unescaped text
    TextList(Vec<String>),          // Comma-separated values
    Uri(String),                    // URI reference
    Date(VCardDate),                // Full or truncated
    Time(VCardTime),                // Full or truncated
    DateTime(VCardDateTime),        // Combined
    DateAndOrTime(DateAndOrTime),   // Flexible format
    Timestamp(VCardTimestamp),      // Complete date-time
    Boolean(bool),                  // TRUE/FALSE
    Integer(i64),                   // 64-bit signed
    Float(f64),                     // IEEE 754
    UtcOffset(i32),                 // Seconds from UTC
    LanguageTag(String),            // BCP 47
    Structured(Vec<Vec<String>>),   // Compound property
    Unknown(String),                // Preserve unknown types
}

#[derive(Debug, Clone)]
pub struct VCardProperty {
    pub group: Option<String>,
    pub name: String,               // Normalized uppercase
    pub params: Vec<VCardParameter>,
    pub value: VCardValue,
    pub raw_value: String,          // Original for round-trip
}

#[derive(Debug, Clone)]
pub struct VCardParameter {
    pub name: String,               // Normalized uppercase
    pub values: Vec<String>,        // One or more decoded values
}

#[derive(Debug, Clone)]
pub struct VCard {
    pub properties: Vec<VCardProperty>,
}
```

**Type Resolution**: Determine value type from:
1. Explicit `VALUE=` parameter
2. Property-specific default (per RFC 6350 property definitions)
3. Fall back to TEXT for X-properties

#### 3.2.3 Structured Value Parsing

**N Property** (5 components):

```rust
pub struct StructuredName {
    pub family: Vec<String>,        // Surname(s)
    pub given: Vec<String>,         // First name(s)
    pub additional: Vec<String>,    // Middle name(s)
    pub prefixes: Vec<String>,      // Honorific prefix(es)
    pub suffixes: Vec<String>,      // Honorific suffix(es)
}

fn parse_n(value: &str) -> Result<StructuredName> {
    let components = split_structured(value, 5);
    Ok(StructuredName {
        family: parse_component_list(&components[0]),
        given: parse_component_list(&components[1]),
        additional: parse_component_list(&components[2]),
        prefixes: parse_component_list(&components[3]),
        suffixes: parse_component_list(&components[4]),
    })
}
```

**ADR Property** (7 components):

```rust
pub struct Address {
    pub po_box: Vec<String>,        // Post office box (SHOULD be empty)
    pub extended: Vec<String>,      // Extended address (SHOULD be empty)
    pub street: Vec<String>,        // Street address (may have multiple lines)
    pub locality: Vec<String>,      // City
    pub region: Vec<String>,        // State/province
    pub postal_code: Vec<String>,   // Postal/ZIP code
    pub country: Vec<String>,       // Country name
}
```

**ORG Property** (variable components):

```rust
pub struct Organization {
    pub name: String,               // Organization name
    pub units: Vec<String>,         // Organizational unit hierarchy
}

fn parse_org(value: &str) -> Result<Organization> {
    let parts = split_structured_variable(value);
    Ok(Organization {
        name: parts.get(0).cloned().unwrap_or_default(),
        units: parts.into_iter().skip(1).collect(),
    })
}
```

**GENDER Property** (2 components):

```rust
pub struct Gender {
    pub sex: Option<char>,          // M/F/O/N/U or None
    pub identity: Option<String>,   // Free-form text
}

fn parse_gender(value: &str) -> Result<Gender> {
    let parts: Vec<&str> = value.splitn(2, ';').collect();
    let sex = parts[0].chars().next();
    let identity = parts.get(1).filter(|s| !s.is_empty()).map(|s| s.to_string());
    Ok(Gender { sex, identity })
}
```

#### 3.2.4 Date/Time Parsing (RFC 6350 §4.3)

vCard dates support truncation and have different rules than iCalendar:

```rust
#[derive(Debug, Clone)]
pub enum VCardDate {
    Full { year: u16, month: u8, day: u8 },        // 19850412
    YearMonth { year: u16, month: u8 },            // 1985-04
    Year { year: u16 },                             // 1985
    MonthDay { month: u8, day: u8 },               // --0412
    Day { day: u8 },                                // ---12
}

#[derive(Debug, Clone)]
pub enum VCardTime {
    Full { hour: u8, minute: u8, second: u8, zone: Option<TzOffset> },
    HourMinute { hour: u8, minute: u8, zone: Option<TzOffset> },
    Hour { hour: u8, zone: Option<TzOffset> },
    MinuteSecond { minute: u8, second: u8, zone: Option<TzOffset> },
    Second { second: u8, zone: Option<TzOffset> },
}

#[derive(Debug, Clone)]
pub enum TzOffset {
    Utc,                            // Z
    Offset(i32),                    // +0530, -0800 as seconds
}

#[derive(Debug, Clone)]
pub enum DateAndOrTime {
    DateTime(VCardDate, VCardTime), // 19961022T140000
    Date(VCardDate),                // 19850412
    Time(VCardTime),                // T102200Z (note leading T)
}
```

**Parsing Patterns**:

```rust
fn parse_vcard_date(s: &str) -> Result<VCardDate> {
    match s.len() {
        8 => parse_full_date(s),              // YYYYMMDD
        7 if s.contains('-') => parse_year_month(s), // YYYY-MM
        4 => parse_year_only(s),              // YYYY
        6 if s.starts_with("--") => parse_month_day(s), // --MMDD
        5 if s.starts_with("---") => parse_day_only(s), // ---DD
        _ => Err(ParseError::InvalidDate),
    }
}

fn parse_date_and_or_time(s: &str) -> Result<DateAndOrTime> {
    if s.starts_with('T') {
        // Standalone time: T102200Z
        Ok(DateAndOrTime::Time(parse_vcard_time(&s[1..])?))
    } else if s.contains('T') {
        // Date-time: 19961022T140000
        let (date, time) = s.split_once('T').unwrap();
        Ok(DateAndOrTime::DateTime(
            parse_vcard_date(date)?,
            parse_vcard_time(time)?,
        ))
    } else {
        // Date only
        Ok(DateAndOrTime::Date(parse_vcard_date(s)?))
    }
}
```

#### 3.2.5 Text Unescaping

```rust
fn unescape_vcard_text(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') | Some('N') => result.push('\n'),
                Some(',') => result.push(','),
                Some(';') => result.push(';'),
                Some('\\') => result.push('\\'),
                Some(other) => {
                    // RFC 6350: only defined escapes; preserve others
                    result.push('\\');
                    result.push(other);
                }
                None => result.push('\\'),
            }
        } else {
            result.push(c);
        }
    }
    result
}
```

#### 3.2.6 Validation Rules

**Structural Validation**:

| Rule | Check |
|------|-------|
| VCARD wrapper | Must have BEGIN:VCARD and END:VCARD |
| VERSION required | Must be "4.0" immediately after BEGIN |
| FN required | At least one FN property |
| UID recommended | Warn if missing for CardDAV |
| Cardinality | Check *1 properties appear at most once |
| MEMBER restriction | Only allowed when KIND=group |
| KIND value | Must be individual/group/org/location or x-name |

**Property-Specific Validation**:

| Property | Validation |
|----------|------------|
| TEL | If VALUE=uri, must be valid tel: URI |
| EMAIL | Should be valid email format (RFC 5322) |
| GEO | Must be valid geo: URI |
| PHOTO | If data: URI, validate MEDIATYPE |
| BDAY/ANNIVERSARY | Validate date/time format |
| REV | Must be TIMESTAMP (complete date-time) |
| PREF | Value must be 1-100 |
| CALSCALE | Only valid on date-containing properties |

**ALTID Consistency**:

```rust
fn validate_altid_consistency(vcard: &VCard) -> Result<()> {
    // Properties with same name and same ALTID should have same cardinality
    // ALTID properties count as one toward cardinality limits
    let mut altid_groups: HashMap<(&str, &str), Vec<&VCardProperty>> = HashMap::new();
    
    for prop in &vcard.properties {
        if let Some(altid) = prop.get_param("ALTID") {
            altid_groups
                .entry((&prop.name, altid))
                .or_default()
                .push(prop);
        }
    }
    
    // Check that grouped properties are valid alternatives
    // (e.g., different LANGUAGE parameters)
    Ok(())
}
```

#### 3.2.7 vCard 3.0 to 4.0 Conversion

Many clients still use vCard 3.0. Key differences to handle:

| vCard 3.0 | vCard 4.0 | Conversion |
|-----------|-----------|------------|
| `ENCODING=B` | `data:` URI | Convert inline to data: URI |
| `TYPE=PREF` | `PREF=1` | Convert preference marker |
| `TYPE=CELL` | `TYPE=cell` | Lowercase (both accepted) |
| `CHARSET=UTF-8` | (removed) | Strip parameter |
| `LABEL` property | `ADR;LABEL=` | Move to ADR parameter |
| `AGENT` property | `RELATED;TYPE=agent` | Convert to RELATED |
| `CLASS` property | (removed) | Drop (security classification) |
| `MAILER` property | (removed) | Drop |
| `NAME`/`PROFILE` | (removed) | Drop |
| `SORT-STRING` | `SORT-AS` parameter | Convert to parameter |

```rust
fn convert_v3_to_v4(v3: VCard) -> VCard {
    let mut v4 = VCard::new();
    v4.add_property("VERSION", "4.0");
    
    for prop in v3.properties {
        match prop.name.as_str() {
            "VERSION" => continue, // Already added
            "LABEL" => {
                // Find corresponding ADR and add as parameter
                // Or create synthetic ADR
            }
            "AGENT" => {
                // Convert to RELATED;TYPE=agent
            }
            _ => {
                // Convert parameters (ENCODING=B, TYPE=PREF, etc.)
                let converted = convert_v3_property(prop);
                v4.properties.push(converted);
            }
        }
    }
    v4
}
```

### 3.3 WebDAV XML Parser

**Implementation Path**: `src/component/rfc/dav/`

Use `quick-xml` for SAX-style parsing of:
- PROPFIND requests
- PROPPATCH requests
- REPORT requests (calendar-query, calendar-multiget, addressbook-query, etc.)
- MKCALENDAR / MKCOL requests

```rust
pub enum DavRequest {
    Propfind(PropfindRequest),
    Proppatch(ProppatchRequest),
    Report(ReportRequest),
    Mkcalendar(MkcalendarRequest),
    Mkcol(MkcolRequest),
}

pub struct PropfindRequest {
    pub prop_type: PropfindType, // AllProp, PropName, Prop(Vec<QName>)
}

pub enum ReportRequest {
    CalendarQuery(CalendarQueryReport),
    CalendarMultiget(CalendarMultigetReport),
    AddressbookQuery(AddressbookQueryReport),
    AddressbookMultiget(AddressbookMultigetReport),
    FreeBusyQuery(FreeBusyQueryReport),
    SyncCollection(SyncCollectionReport),
}
```

---

## 4. Serialization

### 4.1 iCalendar Serialization

#### 4.1.1 Content Line Formatting

1. Construct `NAME[;PARAM=VALUE]*:VALUE`
2. Fold at 75 octets (not breaking UTF-8 sequences)
3. Terminate with `CRLF`

```rust
fn serialize_property(prop: &ICalProperty) -> String {
    let mut line = prop.name.clone();
    for param in &prop.params {
        line.push(';');
        line.push_str(&param.name);
        line.push('=');
        // Quote if contains special chars
        line.push_str(&serialize_param_value(&param.values));
    }
    line.push(':');
    line.push_str(&serialize_value(&prop.value, &prop.name));
    fold_line(&line)
}

fn fold_line(line: &str) -> String {
    // Fold at 75 octets, insert CRLF + SPACE
    // Ensure UTF-8 boundaries respected
}
```

#### 4.1.2 Canonical Ordering

For deterministic output (important for ETags):
1. VCALENDAR properties first (PRODID, VERSION, CALSCALE, METHOD)
2. VTIMEZONE components
3. Other components in UID order, then RECURRENCE-ID order
4. Properties within components in defined order

### 4.2 vCard Serialization

**Implementation Path**: `src/component/rfc/vcard/`

#### 4.2.1 Content Line Formatting

Same general rules as iCalendar with vCard-specific considerations:

```rust
fn serialize_vcard_property(prop: &VCardProperty) -> String {
    let mut line = String::new();
    
    // Property group prefix
    if let Some(ref group) = prop.group {
        line.push_str(group);
        line.push('.');
    }
    
    // Property name
    line.push_str(&prop.name);
    
    // Parameters
    for param in &prop.params {
        line.push(';');
        line.push_str(&param.name);
        line.push('=');
        line.push_str(&serialize_vcard_param_value(&param.values));
    }
    
    // Value
    line.push(':');
    line.push_str(&serialize_vcard_value(&prop.value, &prop.name));
    
    fold_line(&line)
}
```

#### 4.2.2 Value Escaping

```rust
fn escape_vcard_text(s: &str) -> String {
    let mut result = String::with_capacity(s.len() + 10);
    for c in s.chars() {
        match c {
            '\\' => result.push_str("\\\\"),
            ',' => result.push_str("\\,"),
            ';' => result.push_str("\\;"),
            '\n' => result.push_str("\\n"),
            _ => result.push(c),
        }
    }
    result
}

fn escape_vcard_component(s: &str) -> String {
    // For compound property fields (N, ADR, ORG)
    // Escape backslash, comma, semicolon, newline
    escape_vcard_text(s)
}
```

#### 4.2.3 Structured Value Serialization

```rust
fn serialize_structured_name(n: &StructuredName) -> String {
    let components = [
        serialize_list_component(&n.family),
        serialize_list_component(&n.given),
        serialize_list_component(&n.additional),
        serialize_list_component(&n.prefixes),
        serialize_list_component(&n.suffixes),
    ];
    components.join(";")
}

fn serialize_list_component(values: &[String]) -> String {
    values.iter()
        .map(|v| escape_vcard_component(v))
        .collect::<Vec<_>>()
        .join(",")
}

fn serialize_address(adr: &Address) -> String {
    let components = [
        serialize_list_component(&adr.po_box),
        serialize_list_component(&adr.extended),
        serialize_list_component(&adr.street),
        serialize_list_component(&adr.locality),
        serialize_list_component(&adr.region),
        serialize_list_component(&adr.postal_code),
        serialize_list_component(&adr.country),
    ];
    components.join(";")
}
```

#### 4.2.4 Parameter Value Serialization

```rust
fn serialize_vcard_param_value(values: &[String]) -> String {
    values.iter()
        .map(|v| {
            // Quote if contains special characters
            if needs_quoting(v) {
                format!("\"{}\"", v)
            } else {
                v.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(",")
}

fn needs_quoting(s: &str) -> bool {
    s.chars().any(|c| matches!(c, ':' | ';' | ',' | '"'))
}
```

#### 4.2.5 Canonical Ordering

For deterministic output:

```rust
fn serialize_vcard(vcard: &VCard) -> String {
    let mut result = String::new();
    result.push_str("BEGIN:VCARD\r\n");
    result.push_str("VERSION:4.0\r\n");
    
    // Group properties by group prefix
    let mut grouped: BTreeMap<Option<&str>, Vec<&VCardProperty>> = BTreeMap::new();
    for prop in &vcard.properties {
        if prop.name != "VERSION" {
            grouped.entry(prop.group.as_deref())
                .or_default()
                .push(prop);
        }
    }
    
    // Output ungrouped properties first in defined order
    let property_order = [
        "FN", "N", "NICKNAME", "PHOTO", "BDAY", "ANNIVERSARY", "GENDER",
        "ADR", "TEL", "EMAIL", "IMPP", "LANG", "TZ", "GEO",
        "TITLE", "ROLE", "LOGO", "ORG", "MEMBER", "RELATED",
        "CATEGORIES", "NOTE", "PRODID", "REV", "SOUND", "UID",
        "CLIENTPIDMAP", "URL", "KEY", "FBURL", "CALADRURI", "CALURI",
    ];
    
    if let Some(props) = grouped.remove(&None) {
        for name in &property_order {
            for prop in &props {
                if prop.name.eq_ignore_ascii_case(name) {
                    result.push_str(&serialize_vcard_property(prop));
                }
            }
        }
        // X-properties and unknown properties last
        for prop in &props {
            if !property_order.iter().any(|n| prop.name.eq_ignore_ascii_case(n)) {
                result.push_str(&serialize_vcard_property(prop));
            }
        }
    }
    
    // Output grouped properties together
    for (group, props) in grouped {
        // Same ordering within group
        // ...
    }
    
    result.push_str("END:VCARD\r\n");
    result
}
```

#### 4.2.6 vCard 4.0 to 3.0 Conversion

For clients requesting vCard 3.0:

| vCard 4.0 | vCard 3.0 | Conversion |
|-----------|-----------|------------|
| data: URI | ENCODING=B | Extract base64 from data: URI |
| PREF=1 | TYPE=PREF | Convert preference |
| VALUE=uri (TEL) | VALUE=uri (keep) or text | May need adjustment |
| KIND=group | X-ADDRESSBOOKSERVER-KIND | Apple compatibility |
| RELATED | X-* or drop | No direct equivalent |
| GENDER | X-GENDER | Custom property |

```rust
fn convert_v4_to_v3(v4: &VCard) -> VCard {
    let mut v3 = VCard::new();
    v3.add_property("VERSION", "3.0");
    
    for prop in &v4.properties {
        if prop.name == "VERSION" {
            continue;
        }
        
        let converted = match prop.name.as_str() {
            "KIND" if prop.value_text() == "group" => {
                VCardProperty::new("X-ADDRESSBOOKSERVER-KIND", "group")
            }
            "PHOTO" | "LOGO" | "SOUND" | "KEY" => {
                convert_media_property(prop)
            }
            _ => {
                convert_parameters_v4_to_v3(prop.clone())
            }
        };
        v3.properties.push(converted);
    }
    v3
}
```

### 4.3 WebDAV XML Serialization

Generate XML responses:

```rust
pub struct MultistatusResponse {
    pub responses: Vec<DavResponse>,
}

pub struct DavResponse {
    pub href: String,
    pub propstats: Vec<Propstat>,
    pub error: Option<DavError>,
}

pub struct Propstat {
    pub props: Vec<(QName, PropValue)>,
    pub status: StatusCode,
}
```

Use `quick-xml` writer with proper namespace handling.

---

## 5. HTTP Methods & Request Handling

### 5.1 Method Routing

**Implementation Path**: `src/app/api/caldav/` and `src/app/api/carddav/`

| Method | Collection | Resource | Description |
|--------|------------|----------|-------------|
| OPTIONS | ✓ | ✓ | Capability discovery |
| PROPFIND | ✓ | ✓ | Retrieve properties |
| PROPPATCH | ✓ | ✓ | Modify properties |
| GET | - | ✓ | Retrieve resource content |
| PUT | - | ✓ | Create/update resource |
| DELETE | ✓ | ✓ | Remove resource/collection |
| MKCALENDAR | - | - | Create calendar collection |
| MKCOL | - | - | Create address book collection (extended) |
| REPORT | ✓ | ✓ | Execute queries |
| COPY | ✓ | ✓ | Copy resource |
| MOVE | ✓ | ✓ | Move resource |
| LOCK | ✓ | ✓ | Lock resource (optional) |
| UNLOCK | ✓ | ✓ | Unlock resource (optional) |

### 5.2 OPTIONS Response

```http
HTTP/1.1 200 OK
Allow: OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, MKCALENDAR, MKCOL
DAV: 1, 3, access-control, calendar-access, addressbook
```

Only advertise what you actually implement:
- Include `2` in the `DAV:` header only if you implement WebDAV locking (`LOCK`/`UNLOCK`).
- Include `calendar-auto-schedule` only if you implement CalDAV auto-scheduling (RFC 6638).

If you support Extended MKCOL (RFC 5689), include `extended-mkcol` in the `DAV:` header on applicable collections.

### 5.3 PROPFIND Handling

Request body specifies which properties to retrieve:

```xml
<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:displayname/>
    <D:resourcetype/>
    <D:getetag/>
    <C:calendar-data xmlns:C="urn:ietf:params:xml:ns:caldav"/>
  </D:prop>
</D:propfind>
```

**Discovery Properties Clients Commonly Request**:
- `DAV:current-user-principal` (principal discovery)
- `CALDAV:calendar-home-set` / `CARDDAV:addressbook-home-set` (home collections)
- `DAV:supported-report-set` (RFC 3253; clients use this to decide which REPORTs to issue; advertise it accurately per collection/resource type, including `calendar-query`/`calendar-multiget`/`free-busy-query` for calendars, `addressbook-query`/`addressbook-multiget` for address books, `sync-collection` where supported, and `expand-property` where required by CardDAV)
- `DAV:sync-token` (RFC 6578; if you support sync)
- `CS:getctag` (Apple ecosystem; some clients still use this)

**Depth Header**:
- `0`: Target resource only
- `1`: Target + immediate children
- `infinity`: Target + all descendants (servers MAY reject)

### 5.4 PUT Handling

#### 5.4.1 Creating New Resources

Client SHOULD use `If-None-Match: *` to prevent overwriting.

**Preconditions** (RFC 4791 §5.3.2.1):
- `CALDAV:supported-calendar-data`: Valid media type
- `CALDAV:valid-calendar-data`: Syntactically valid iCalendar
- `CALDAV:valid-calendar-object-resource`: Semantically valid
- `CALDAV:supported-calendar-component`: Component type allowed
- `CALDAV:no-uid-conflict`: UID not already in use
- `CALDAV:max-resource-size`: Size within limit
- `CALDAV:min-date-time` / `CALDAV:max-date-time`: Dates within range
- `CALDAV:max-instances`: Recurrence count within limit
- `CALDAV:max-attendees-per-instance`: Attendee count within limit

#### 5.4.2 Updating Existing Resources

Client SHOULD use `If-Match: "etag"` for optimistic locking.

**ETag Generation**:
- MUST be strong validator
- Changes when resource content changes
- Consider: hash of canonical serialization, or `{entity_id}-{revision}`

### 5.5 DELETE Handling

- Delete resource and create tombstone for sync
- If collection, recursively delete contents
- Update `synctoken` on parent collection

### 5.6 MKCALENDAR Handling (RFC 4791 §5.3.1)

```xml
<?xml version="1.0" encoding="utf-8"?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set>
    <D:prop>
      <D:displayname>Work Calendar</D:displayname>
      <C:calendar-description>My work events</C:calendar-description>
      <C:supported-calendar-component-set>
        <C:comp name="VEVENT"/>
      </C:supported-calendar-component-set>
    </D:prop>
  </D:set>
</C:mkcalendar>
```

### 5.7 PROPPATCH Handling

Use PROPPATCH to update **writable** collection properties such as `DAV:displayname` and descriptions. Reject writes to protected properties.

- Return `207 Multi-Status` with per-property `propstat` results.
- Treat PROPPATCH as subject to the same ACL checks as other write operations (`DAV:write-properties`).
- For properties you do not recognize or do not allow, return `403 Forbidden` for that property in the multistatus.

### 5.8 Extended MKCOL for Address Books (RFC 5689)

Clients commonly create address books using Extended MKCOL with a request body that sets properties at creation time.

- Accept `MKCOL` with a `DAV:set` body.
- Support setting `DAV:displayname` and `CARDDAV:addressbook-description` at creation time.
- Validate that the resulting collection has the correct `DAV:resourcetype` including `DAV:collection` and `CARDDAV:addressbook`.

### 5.9 COPY and MOVE Handling

Implement COPY/MOVE primarily for interoperability (some clients use MOVE for renames).

- Enforce destination constraints (e.g., CardDAV `addressbook-collection-location-ok`).
- Ensure sync state is updated: bump sync tokens on source/target collections and create tombstones as needed.
- Preserve optimistic concurrency where possible (If-Match on source; handle overwrites explicitly).

---

## 6. REPORT Operations

### 6.0 REPORT Method Basics (RFC 3253 §3.6)

- The REPORT request body’s root element selects the report type (e.g., `CALDAV:calendar-query`, `CARDDAV:addressbook-query`).
- If the request omits the `Depth` header, treat it as `Depth: 0`.
- For reports evaluated over a collection (common for CalDAV/CardDAV), clients typically send `Depth: 1` and servers respond with `207 Multi-Status` containing one `DAV:response` per matched member.
- If the specified report is not supported by the request-URL, return `403 Forbidden` with a `DAV:error` body containing `DAV:supported-report`.

### 6.1 CALDAV:calendar-query (RFC 4791 §7.8)

Query calendar resources matching filter criteria.

```xml
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data>
      <C:comp name="VCALENDAR">
        <C:prop name="VERSION"/>
        <C:comp name="VEVENT">
          <C:prop name="SUMMARY"/>
          <C:prop name="DTSTART"/>
          <C:prop name="DTEND"/>
        </C:comp>
      </C:comp>
    </C:calendar-data>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="20060104T000000Z" end="20060105T000000Z"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>
```

#### 6.1.1 Filter Elements

| Element | Description |
|---------|-------------|
| `comp-filter` | Filter by component name; can nest |
| `prop-filter` | Filter by property existence/value |
| `param-filter` | Filter by parameter existence/value |
| `time-range` | Filter by temporal overlap |
| `text-match` | Text comparison with collation |
| `is-not-defined` | Property/param must NOT exist |

#### 6.1.2 Time-Range Semantics (RFC 4791 §9.9)

For VEVENT:
- Start defaults to DTSTART
- End defaults to DTEND, or DTSTART + DURATION, or DTSTART + P1D (all-day), or DTSTART (instantaneous)

Overlap test: `(start < time-range.end) AND (end > time-range.start)`

For recurring events, expand occurrences and test each.

### 6.2 CALDAV:calendar-multiget (RFC 4791 §7.9)

Retrieve specific resources by href:

```xml
<C:calendar-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <D:href>/calendars/user/cal/event1.ics</D:href>
  <D:href>/calendars/user/cal/event2.ics</D:href>
</C:calendar-multiget>
```

### 6.3 CARDDAV:addressbook-query (RFC 6352 §8.6)

**Purpose**: Search for address object resources matching filter criteria.

**Request Structure**:

```xml
<C:addressbook-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:prop>
    <D:getetag/>
    <C:address-data>
      <C:prop name="VERSION"/>
      <C:prop name="FN"/>
      <C:prop name="N"/>
      <C:prop name="EMAIL"/>
      <C:prop name="TEL"/>
      <C:prop name="UID"/>
    </C:address-data>
  </D:prop>
  <C:filter test="anyof">
    <C:prop-filter name="FN">
      <C:text-match collation="i;unicode-casemap" match-type="contains">
        doe
      </C:text-match>
    </C:prop-filter>
    <C:prop-filter name="EMAIL">
      <C:text-match collation="i;unicode-casemap" match-type="contains">
        doe
      </C:text-match>
    </C:prop-filter>
  </C:filter>
  <C:limit>
    <C:nresults>50</C:nresults>
  </C:limit>
</C:addressbook-query>
```

**Required Headers**:
- `Depth: 1` or `Depth: infinity` (scope of search)
- `Content-Type: text/xml; charset="utf-8"`

#### 6.3.1 Filter Structure (RFC 6352 §10.5)

```xml
<C:filter test="anyof|allof">    <!-- default: allof -->
  <C:prop-filter name="PROP-NAME" test="anyof|allof">
    <!-- At least one of: -->
    <C:is-not-defined/>           <!-- Property does not exist -->
    <C:text-match ...>value</C:text-match>
    <C:param-filter name="PARAM-NAME">
      <C:is-not-defined/>
      <C:text-match ...>value</C:text-match>
    </C:param-filter>
  </C:prop-filter>
</C:filter>
```

**Filter Logic**:
- `test="allof"` (default): All child conditions must match (AND)
- `test="anyof"`: At least one child must match (OR)
- Empty `<C:filter/>`: Matches all resources

#### 6.3.2 text-match Element (RFC 6352 §10.5.4)

```xml
<C:text-match 
    collation="i;unicode-casemap"   <!-- default if omitted -->
    match-type="contains"           <!-- default: contains -->
    negate-condition="no">          <!-- default: no -->
  search text
</C:text-match>
```

**Attributes**:

| Attribute | Values | Default | Description |
|-----------|--------|---------|-------------|
| collation | Collation identifier | i;unicode-casemap | Text comparison rules |
| match-type | equals/contains/starts-with/ends-with | contains | Match operation |
| negate-condition | yes/no | no | Invert match result |

**Collation Rules**:
- If the client omits `collation` or specifies the `default` collation identifier, the server MUST default to `i;unicode-casemap`.
- Wildcards MUST NOT be used in the collation identifier; treat this the same as an unsupported collation.
- If an unsupported collation is requested, return a 403 with the `CARDDAV:supported-collation` precondition.

#### 6.3.3 Match Types

| match-type | Description | Example |
|------------|-------------|---------|
| `equals` | Exact match (per collation) | "John Doe" matches "john doe" |
| `contains` | Substring anywhere | "ohn" matches "John Doe" |
| `starts-with` | Prefix match | "John" matches "John Doe" |
| `ends-with` | Suffix match | "Doe" matches "John Doe" |

#### 6.3.4 Collations (RFC 4790)

**Required Collations**:

| Collation | Description |
|-----------|-------------|
| `i;ascii-casemap` | ASCII case-insensitive; non-ASCII compared octet-by-octet |
| `i;unicode-casemap` | Unicode case-insensitive (default); uses Unicode Default Case Algorithm |

**Optional**:
- `i;octet` — Octet-by-octet comparison (case-sensitive)

**Collation Support Discovery**:

```xml
<C:supported-collation-set xmlns:C="urn:ietf:params:xml:ns:carddav">
  <C:supported-collation>i;ascii-casemap</C:supported-collation>
  <C:supported-collation>i;unicode-casemap</C:supported-collation>
</C:supported-collation-set>
```

#### 6.3.5 Property Filtering Examples

**Match by email domain**:
```xml
<C:prop-filter name="EMAIL">
  <C:text-match match-type="ends-with">@example.com</C:text-match>
</C:prop-filter>
```

**Match by phone TYPE parameter**:
```xml
<C:prop-filter name="TEL">
  <C:param-filter name="TYPE">
    <C:text-match match-type="equals">cell</C:text-match>
  </C:param-filter>
</C:prop-filter>
```

**Find contacts without email**:
```xml
<C:prop-filter name="EMAIL">
  <C:is-not-defined/>
</C:prop-filter>
```

**Find group vCards**:
```xml
<C:prop-filter name="KIND">
  <C:text-match match-type="equals">group</C:text-match>
</C:prop-filter>
```

#### 6.3.6 Partial vCard Retrieval (address-data)

```xml
<C:address-data content-type="text/vcard" version="4.0">
  <C:allprop/>   <!-- Return all vCard properties -->
</C:address-data>

<!-- OR specific properties -->

<C:address-data>
  <C:prop name="VERSION"/>
  <C:prop name="UID"/>
  <C:prop name="FN"/>
  <C:prop name="N"/>
  <C:prop name="EMAIL"/>
  <C:prop name="TEL"/>
  <C:prop name="PHOTO"/>
</C:address-data>
```

**Note**: Requested properties that don't exist in vCard are simply omitted from response.

#### 6.3.7 Result Limiting (RFC 6352 §10.6)

```xml
<C:limit>
  <C:nresults>25</C:nresults>
</C:limit>
```

**Truncation Handling**:
- If results exceed limit, return 207 Multi-Status
- Include `507 Insufficient Storage` for Request-URI
- Include `DAV:number-of-matches-within-limits` error
- Include partial results up to limit

**Response Example**:
```xml
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/addressbooks/user/contacts/</D:href>
    <D:status>HTTP/1.1 507 Insufficient Storage</D:status>
    <D:error><D:number-of-matches-within-limits/></D:error>
  </D:response>
  <!-- ... actual results ... -->
</D:multistatus>
```

#### 6.3.8 Preconditions

| Precondition | Condition |
|--------------|-----------|
| CARDDAV:supported-address-data | Requested content-type/version is supported |
| CARDDAV:supported-filter | Filter uses only supported properties/parameters |
| CARDDAV:supported-collation | Requested collation is supported |
| DAV:number-of-matches-within-limits | Result count within server limits |

### 6.4 CARDDAV:addressbook-multiget (RFC 6352 §8.7)

**Purpose**: Retrieve specific address object resources by href.

**Request Structure**:

```xml
<C:addressbook-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:prop>
    <D:getetag/>
    <C:address-data>
      <C:prop name="VERSION"/>
      <C:prop name="UID"/>
      <C:prop name="FN"/>
      <C:prop name="EMAIL"/>
    </C:address-data>
  </D:prop>
  <D:href>/addressbooks/user/contacts/contact1.vcf</D:href>
  <D:href>/addressbooks/user/contacts/contact2.vcf</D:href>
  <D:href>/addressbooks/user/contacts/contact3.vcf</D:href>
</C:addressbook-multiget>
```

**Required Headers**:
- `Depth: 0` (scope is determined by href list, not Depth)

**Response**: Standard multistatus with address-data in propstat.

**Error Handling**:
- Non-existent resources: Return 404 status in that DAV:response
- Access denied: Return 403 status
- Invalid href (wrong collection): Return 403 or ignore

**Use Cases**:
- Initial sync after client gets list of hrefs from PROPFIND
- Refresh specific contacts after receiving push notification
- Batch retrieval of changed resources from sync-collection report

### 6.5 CALDAV:free-busy-query (RFC 4791 §7.10)

Returns VFREEBUSY component for time range:

```xml
<C:free-busy-query xmlns:C="urn:ietf:params:xml:ns:caldav">
  <C:time-range start="20060104T000000Z" end="20060105T000000Z"/>
</C:free-busy-query>
```

### 6.6 DAV expand-property Report (RFC 3253 §3.8)

CardDAV requires support for `DAV:expand-property`, and clients use it to fetch nested properties in fewer round-trips (most commonly for principal/ACL discovery).

- Advertise support via `DAV:supported-report-set`.
- Scope expansions to a safe, documented subset to avoid expensive or cyclic expansions.

Example (simplified):

```xml
<D:expand-property xmlns:D="DAV:">
    <D:property name="D:principal-URL">
        <D:property name="D:displayname"/>
    </D:property>
</D:expand-property>
```

Response is `text/calendar` containing VFREEBUSY.

---

## 7. Synchronization

### 7.1 WebDAV Sync (RFC 6578)

**Implementation Path**: Use `synctoken` and `sync_revision` columns.

**Requirements (RFC 6578)**:
- If you implement `DAV:sync-collection`, you MUST list it in `DAV:supported-report-set` on any collection that supports synchronization.
- `DAV:sync-token` values MUST be valid URIs (clients treat them as opaque strings, but servers must make them URI-shaped so they can be used in `If`).
- `sync-collection` is only defined for `Depth: 0` (missing Depth defaults to `0` per RFC 3253); any other Depth MUST fail with `400 Bad Request`.

#### 7.1.0 DAV:sync-token Property

Clients typically discover sync support by PROPFIND on the collection and reading `DAV:sync-token`. A server that supports sync SHOULD expose a stable, opaque token here.

RFC 6578 also requires:
- The `DAV:sync-token` property MUST be defined on all resources that support `DAV:sync-collection`.
- The property value MUST be protected.
- The property value SHOULD NOT be returned by `PROPFIND` `DAV:allprop`.

**Example PROPFIND**:
```xml
<D:propfind xmlns:D="DAV:">
    <D:prop>
        <D:sync-token/>
    </D:prop>
</D:propfind>
```

**Example Response Fragment**:
```xml
<D:prop>
    <D:sync-token>http://example.com/sync/12345</D:sync-token>
</D:prop>
```

#### 7.1.1 sync-collection Report

The `sync-collection` REPORT is how clients ask for “what changed since token X”.

- The request body MUST include `DAV:sync-token`, `DAV:sync-level`, and `DAV:prop` (and MAY include `DAV:limit`).
- `DAV:sync-level` MUST be either `1` (immediate children only) or `infinite` (all descendants, but only traversing into child collections that also support sync).
- Tokens are not specific to `sync-level`: clients MAY reuse a token obtained with one `sync-level` value for a later request with a different `sync-level` value.
- Initial sync is done by sending an empty `DAV:sync-token` element.
- On initial sync (empty token), the server MUST return all member URLs (subject to `sync-level`) and MUST NOT return removed member URLs.

Token validation (RFC 6578 §3.2):
- On subsequent sync (non-empty token), the `DAV:sync-token` value MUST have been previously returned by the server for the target collection.
- If the token is out-of-date/invalidated, fail the request with the `DAV:valid-sync-token` precondition error and the client will fall back to a full sync using an empty token.
- Servers MUST limit token invalidation to cases where it is absolutely necessary (e.g., bounded history, data loss, implementation change).

```xml
<D:sync-collection xmlns:D="DAV:">
  <D:sync-token>http://example.com/sync/12345</D:sync-token>
  <D:sync-level>1</D:sync-level>
  <D:prop>
    <D:getetag/>
  </D:prop>
</D:sync-collection>
```

Response includes:
- Changed/new resources since sync-token (each `DAV:response` MUST include at least one `DAV:propstat` and MUST NOT include a `DAV:status`)
- Deleted resources (each `DAV:response` MUST include `DAV:status: 404 Not Found` and MUST NOT include any `DAV:propstat`)
- One new `DAV:sync-token` for the response

Child collections with `sync-level: infinite` (RFC 6578 §3.3):
- If a child collection cannot be synchronized as part of an `infinite` request, include a `DAV:response` for that child collection with `DAV:status: 403 Forbidden` and a `DAV:error` element.
- Use `DAV:error` containing `DAV:supported-report` when the child does not support `sync-collection` at all.
- Use `DAV:error` containing `DAV:sync-traversal-supported` when the child supports sync but the server refuses traversal from the parent scope.
- Emit that 403 response once, when the child collection is first reported.

Truncation / paging (RFC 6578 §3.6):
- A server MAY truncate results.
- When truncated, the response is still `207 Multi-Status`, but you MUST include an extra `DAV:response` for the request-URI with `DAV:status: 507 Insufficient Storage`, and it SHOULD include `DAV:error` with `DAV:number-of-matches-within-limits`.
- The returned `DAV:sync-token` MUST represent the partial result state so the client can re-issue the report with the new token to fetch the next “page” of changes.

`DAV:limit` handling (RFC 6578 §3.7):
- If the client specifies a limit and the server cannot correctly truncate at or below that limit, the server MUST fail the request with the `DAV:number-of-matches-within-limits` error.

#### 7.1.2 Sync Token Strategy

Use monotonic `synctoken` on collection (bigint, increments on any change).

Track per-resource `sync_revision` to identify changes since a given token.

Tombstones (`dav_tombstone`) track deleted resources with their `sync_revision` at deletion time.

```sql
-- Find changes since token
SELECT uri, etag, sync_revision 
FROM dav_instance 
WHERE collection_id = ? AND sync_revision > ?
UNION ALL
SELECT uri, NULL, sync_revision
FROM dav_tombstone
WHERE collection_id = ? AND sync_revision > ?;
```

#### 7.1.3 Using DAV:sync-token with the If Header

RFC 6578 requires servers to support use of `DAV:sync-token` values in `If` request headers, so clients can make write operations conditional on the collection not having changed since the last sync.

- Support `If` with a collection “resource tag” targeting the collection URI and the sync-token as the state token.
- Return `412 Precondition Failed` when the token no longer matches.

### 7.2 CTag (Calendar Server Extension)

`CS:getctag` property: opaque token that changes when collection contents change.

Implementation: use `synctoken` value or hash of all ETags.

### 7.3 ETag Handling

- Generate strong ETag for each resource
- Include in GET/PUT responses
- Validate `If-Match` / `If-None-Match` headers
- Consider: `"{entity_id}-{revision}"` format

---

## 8. Recurrence Expansion

### 8.1 RRULE Evaluation Algorithm (RFC 5545 §3.3.10)

**Conceptual Algorithm**:

```
function expand_rrule(dtstart, rrule, rdate, exdate, range_start, range_end):
    occurrences = []
    
    // 1. Generate candidate set from FREQ + INTERVAL
    candidates = generate_base_candidates(dtstart, rrule.freq, rrule.interval, range_end)
    
    // 2. Apply BYxxx rules in order (expand or limit depending on FREQ)
    for rule in [BYMONTH, BYWEEKNO, BYYEARDAY, BYMONTHDAY, BYDAY, 
                 BYHOUR, BYMINUTE, BYSECOND]:
        if rule is set:
            candidates = apply_by_rule(candidates, rule, rrule.freq)
    
    // 3. Apply BYSETPOS filter (operates on each frequency period)
    if rrule.by_set_pos is set:
        candidates = filter_by_setpos(candidates, rrule.by_set_pos)
    
    // 4. Filter by UNTIL or COUNT
    if rrule.until:
        candidates = candidates.filter(|c| c <= rrule.until)
    else if rrule.count:
        candidates = candidates.take(rrule.count)
    
    // 5. Include DTSTART (always counts as first occurrence)
    occurrences = [dtstart] + candidates.filter(|c| c != dtstart)
    
    // 6. Add RDATE instances
    occurrences = occurrences.union(rdate)
    
    // 7. Remove EXDATE instances
    occurrences = occurrences.difference(exdate)
    
    // 8. Filter to range
    return occurrences.filter(|o| overlaps(o, range_start, range_end))
```

**FREQ Generation**:

| FREQ | Base Period |
|------|-------------|
| YEARLY | Same month/day/time each year from DTSTART |
| MONTHLY | Same day/time each month from DTSTART |
| WEEKLY | Same weekday/time each week from DTSTART |
| DAILY | Same time each day from DTSTART |
| HOURLY | Same minute/second each hour from DTSTART |
| MINUTELY | Same second each minute from DTSTART |
| SECONDLY | Each second from DTSTART |

**BYxxx Application**:

```rust
fn apply_by_rule(candidates: Vec<DateTime>, rule: ByRule, freq: Frequency) -> Vec<DateTime> {
    match behavior(rule, freq) {
        Expand => {
            // Generate additional instances within each candidate's period
            candidates.flat_map(|c| expand_within_period(c, rule))
        }
        Limit => {
            // Filter candidates to those matching the rule values
            candidates.filter(|c| matches_rule(c, rule))
        }
    }
}
```

**BYDAY Special Cases**:

| Context | Example | Meaning |
|---------|---------|---------|
| MONTHLY + BYDAY=MO | | Every Monday in month |
| MONTHLY + BYDAY=+1MO | | First Monday of month |
| MONTHLY + BYDAY=-1FR | | Last Friday of month |
| MONTHLY + BYDAY=+2TU,+4TU | | 2nd and 4th Tuesday |
| YEARLY + BYMONTH=1 + BYDAY=SU | | Every Sunday in January |
| YEARLY + BYDAY=+1MO + BYMONTH=9 | | First Monday of September |
| WEEKLY + BYDAY=MO,WE,FR | | Mon/Wed/Fri weekly |

**BYSETPOS Examples**:

| RRULE | Meaning |
|-------|---------|
| `FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1` | Last weekday of month |
| `FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1,2,3` | First 3 weekdays of month |
| `FREQ=YEARLY;BYDAY=TH;BYMONTH=11;BYSETPOS=4` | 4th Thursday in November (US Thanksgiving) |

### 8.2 Invalid Instance Handling

Instances MUST be skipped and not counted when:

| Condition | Example |
|-----------|---------|
| Invalid date | Feb 30, Apr 31 |
| Non-existent local time | 2:30 AM during DST spring-forward |
| Out of range | BYMONTHDAY=31 in February |

**DST Handling During Expansion**:

| Scenario | RFC 5545 Rule |
|----------|---------------|
| Local time occurs twice (fall-back) | Use first occurrence (before transition) |
| Local time doesn't exist (spring-forward) | Use offset before gap; effective time shifts |

### 8.3 Recurrence Override Handling

A recurrence set consists of:

| Component Type | Characteristics |
|----------------|-----------------|
| **Master** | Has UID; has RRULE/RDATE; no RECURRENCE-ID |
| **Override** | Has UID matching master; has RECURRENCE-ID |
| **Exception** | Override with STATUS:CANCELLED or detached instance |

**RECURRENCE-ID Value**:
- Must match the original occurrence date-time (before override)
- Type (DATE vs DATE-TIME) MUST match DTSTART type
- TZID should match DTSTART TZID

**RANGE Parameter**:
- `THISANDFUTURE`: Override applies to this and all subsequent instances
- `THISANDPRIOR`: **Deprecated**, MUST NOT be generated

**Expansion with Overrides**:

```rust
fn expand_with_overrides(master: &Component, overrides: &[Component], range: TimeRange) -> Vec<Instance> {
    let base_occurrences = expand_rrule(&master);
    let mut result = vec![];
    
    for occ in base_occurrences {
        if let Some(override_comp) = find_override(overrides, occ.recurrence_id) {
            if override_comp.status != Some("CANCELLED") {
                // Use override properties
                result.push(Instance::from_override(override_comp, occ));
            }
            // CANCELLED overrides become exceptions (not included)
        } else {
            // No override; use master properties
            result.push(Instance::from_master(master, occ));
        }
    }
    
    result
}
```

### 8.4 Time-Range Query with Recurrence

For `calendar-query` with `time-range`:

**Algorithm**:

```
1. For each calendar resource:
   a. If non-recurring:
      - Compute [start, end] from DTSTART/DTEND/DURATION
      - Test overlap with query time-range
   b. If recurring:
      - Get max event duration (for start boundary adjustment)
      - Expand occurrences in [query_start - max_duration, query_end]
      - Test each occurrence for overlap
      - Include master + any overrides that affect returned instances
```

**Time-Range Overlap Test** (RFC 4791 §9.9):

| Component | Start | End |
|-----------|-------|-----|
| VEVENT with DTEND | DTSTART | DTEND |
| VEVENT with DURATION | DTSTART | DTSTART + DURATION |
| VEVENT DATE, no end | DTSTART | DTSTART + P1D |
| VEVENT DATE-TIME, no end | DTSTART | DTSTART (instant) |
| VTODO with DUE | min(DTSTART, DUE) | max(DTSTART, DUE) |
| VTODO with DURATION | DTSTART | DTSTART + DURATION |
| VFREEBUSY FREEBUSY | start of period | end of period |
| VALARM | trigger time | trigger time |

**Overlap formula**: `(start < range_end) AND (end > range_start)`

### 8.5 Limit and Expand Options (RFC 4791 §9.6)

| Element | Behavior |
|---------|----------|
| `<limit-recurrence-set start="..." end="..."/>` | Return master + overrides, but only those affecting the range; RRULE preserved |
| `<expand start="..." end="..."/>` | Return individual instances as standalone VEVENTs; RRULE removed; RECURRENCE-ID added |

**Expand Output**:
- Each returned VEVENT has its own DTSTART/DTEND
- RRULE, RDATE, EXDATE removed from each instance
- RECURRENCE-ID added to identify which occurrence

### 8.6 Pre-Expansion Cache (cal_occurrence)

For performance, optionally pre-expand recurring events:

```sql
CREATE TABLE cal_occurrence (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    entity_id UUID NOT NULL REFERENCES dav_entity(id) ON DELETE CASCADE,
    component_id UUID NOT NULL REFERENCES dav_component(id) ON DELETE CASCADE,
    dtstart_utc TIMESTAMPTZ NOT NULL,
    dtend_utc TIMESTAMPTZ NOT NULL,
    is_override BOOLEAN NOT NULL DEFAULT FALSE,
    -- Index for time-range queries
);

CREATE INDEX ON cal_occurrence (entity_id, dtstart_utc, dtend_utc);
```

**Cache Invalidation**:
- On PUT: Regenerate occurrences for affected UID
- On DELETE: Remove all occurrences for entity
- Expand only within reasonable window (e.g., ±2 years)

**Unbounded Recurrence**: For rules without UNTIL/COUNT, expand to a configurable horizon and re-expand as needed when queries exceed the cached range.

---

## 9. Time Zone Handling

### 9.1 VTIMEZONE Components

Each unique TZID referenced in properties MUST have a corresponding VTIMEZONE. Structure per RFC 5545 §3.6.5:

```
BEGIN:VTIMEZONE
TZID:America/New_York               ; REQUIRED, unique within object
LAST-MODIFIED:20050809T050000Z      ; Optional
TZURL:http://tzurl.org/zoneinfo/America/New_York ; Optional

BEGIN:STANDARD                       ; At least one STANDARD or DAYLIGHT required
DTSTART:20071104T020000              ; Local time (no TZID!)
TZOFFSETFROM:-0400                   ; Offset before this transition
TZOFFSETTO:-0500                     ; Offset after this transition
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
TZNAME:EST                           ; Optional display name
END:STANDARD

BEGIN:DAYLIGHT
DTSTART:20070311T020000
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
TZNAME:EDT
END:DAYLIGHT

END:VTIMEZONE
```

**VTIMEZONE Rules**:
- DTSTART in STANDARD/DAYLIGHT is **local time without TZID**
- TZOFFSETFROM + DTSTART determines the instant of transition
- RRULE within VTIMEZONE: UNTIL must be UTC (with Z suffix)
- Multiple STANDARD/DAYLIGHT sub-components for historical changes

### 9.2 UTC Conversion

**Strategy**: Store both original and UTC-normalized values.

```rust
struct StoredDateTime {
    /// Original value for round-trip fidelity
    original: DateTimeValue,
    /// UTC-normalized for queries
    utc: DateTime<Utc>,
}

fn normalize_to_utc(dt: &DateTimeValue, vtimezones: &HashMap<String, VTimezone>) -> DateTime<Utc> {
    match dt {
        DateTimeValue::Utc(utc) => *utc,
        DateTimeValue::Date(date) => {
            // Treat as start of day in floating context
            // For queries, may need special handling
        }
        DateTimeValue::Floating(naive) => {
            // Cannot convert without context timezone
            // Use collection's calendar-timezone if set
        }
        DateTimeValue::Zoned { datetime, tzid } => {
            let tz = vtimezones.get(tzid)
                .or_else(|| chrono_tz::Tz::from_str(tzid).ok());
            resolve_local_time(*datetime, tz)
        }
    }
}
```

**Offset Resolution**:
1. Find the most recent transition before the target datetime
2. Use that transition's TZOFFSETTO as the offset
3. Handle ambiguous times (DST fall-back): use first occurrence
4. Handle non-existent times (DST spring-forward): use offset before gap

### 9.3 IANA vs Windows Timezone IDs

| Source | Format | Example |
|--------|--------|---------|
| IANA (Olson) | Area/Location | `America/New_York`, `Europe/London` |
| Windows | Display name | `Eastern Standard Time` |
| Proprietary | Vendor prefix | `/Apple/iCal/...` |

**Recommendation**:
- Use IANA IDs internally and in output
- Accept Windows IDs with mapping table for interop
- Store original TZID for round-trip when unknown
- Use `chrono-tz` crate which includes IANA database

### 9.4 CALDAV:calendar-timezone Property

Collection-level property specifying default timezone for:
- Floating time interpretation in queries
- New events without explicit timezone

```xml
<C:calendar-timezone>BEGIN:VCALENDAR...END:VCALENDAR</C:calendar-timezone>
```

---

## 10. Free-Busy Queries

### 10.1 CALDAV:free-busy-query Report

**Processing**:

1. Identify all VEVENTs overlapping time range
2. Check TRANSP property (OPAQUE vs TRANSPARENT)
3. Check STATUS (CANCELLED events don't block)
4. Aggregate into FREEBUSY periods with FBTYPE
5. Merge adjacent/overlapping periods

**FBTYPE Values**:
- `FREE`: Available
- `BUSY`: Blocked
- `BUSY-TENTATIVE`: Tentatively blocked
- `BUSY-UNAVAILABLE`: Unavailable

### 10.2 Response Format

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Shuriken//CalDAV//EN
METHOD:REPLY
BEGIN:VFREEBUSY
DTSTAMP:20060104T120000Z
DTSTART:20060104T000000Z
DTEND:20060105T000000Z
FREEBUSY;FBTYPE=BUSY:20060104T090000Z/20060104T100000Z
FREEBUSY;FBTYPE=BUSY-TENTATIVE:20060104T140000Z/20060104T150000Z
END:VFREEBUSY
END:VCALENDAR
```

---

## 11. Scheduling (iTIP)

### 11.1 RFC 6638 Overview

CalDAV Scheduling automates iTIP (RFC 5546) message delivery.

**Collections**:
- `schedule-inbox`: Receives incoming scheduling messages
- `schedule-outbox`: Target for busy-time requests (POST)

**Scheduling Object Resources**: Calendar resources where server performs scheduling.

### 11.2 Organizer Operations

When organizer creates/modifies/deletes scheduling object:

1. Server detects ATTENDEE changes
2. Generates iTIP REQUEST/CANCEL messages
3. Delivers to attendee inboxes (internal) or outbound (iMIP)
4. Updates SCHEDULE-STATUS on ATTENDEE properties

### 11.3 Attendee Operations

When attendee modifies participation:

1. Server detects PARTSTAT change
2. Generates iTIP REPLY message
3. Delivers to organizer inbox
4. Organizer's resource updated with reply

### 11.4 Schedule-Related Properties

| Property | Purpose |
|----------|---------|
| `CALDAV:schedule-inbox-URL` | Principal's inbox collection |
| `CALDAV:schedule-outbox-URL` | Principal's outbox collection |
| `CALDAV:calendar-user-address-set` | Principal's calendar addresses |
| `CALDAV:schedule-default-calendar-URL` | Default calendar for new events |

### 11.5 SCHEDULE-AGENT Parameter

Controls who handles scheduling:
- `SERVER`: Server handles (default)
- `CLIENT`: Client handles
- `NONE`: No scheduling

---

## 12. Authorization & Access Control

### 12.1 WebDAV ACL (RFC 3744)

Shuriken uses Casbin for authorization with a ReBAC model.

**Privilege Hierarchy**:
```
DAV:all
├── DAV:read
│   ├── DAV:read-acl
│   └── DAV:read-current-user-privilege-set
├── DAV:write
│   ├── DAV:write-acl
│   ├── DAV:write-properties
│   ├── DAV:write-content
│   ├── DAV:bind (add child)
│   └── DAV:unbind (remove child)
└── DAV:unlock
```

### 12.2 CalDAV Privileges

- `CALDAV:read-free-busy`: Can query free-busy (even without full read)

### 12.3 Shuriken ACL Model

**Principal Types** (from `principal.principal_type`):
- `user`: Individual user
- `group`: User group
- `public`: Anonymous/public access
- `resource`: Room or resource

#### 12.3.1 Permission Levels

Shuriken uses a small set of **permission levels** that apply to either:
- a **collection** (calendar/addressbook), or
- an **individual item** (calendar object resource / vCard resource).

Permissions are **additive** across scopes: a user’s effective permission for an item is never lower than their effective permission on its parent collection.

**Levels** (lowest → highest):
- `read-freebusy`
- `read`
- `read-share` (can share at `read`)
- `edit`
- `edit-share` (can share at `read` or `edit`)
- `admin` (can share at `read`, `read-share`, `edit`, `edit-share`)
- `owner`

**Operational meaning**:
- `read-freebusy`: Can execute free-busy queries for the calendar user/collection (`CALDAV:free-busy-query`) but cannot read event bodies.
- `read`: Can read items and metadata (e.g., `PROPFIND`, `REPORT` queries, `GET` on items).
- `edit`: Can create/update/delete items (e.g., `PUT`, `DELETE`, `MOVE` for rename where supported) subject to collection constraints.
- `*-share` / `admin` / `owner`: Can grant access to others within the allowed share ceiling described above.

Sharing is modeled as the ability to create/update ACL/share policy entries for a target principal.

**Enforcement Flow**:
1. Extract user principal from authentication
2. Expand to `{user} ∪ groups(user) ∪ {public}`
3. Check Casbin policy for action on resource
4. Allow or deny

#### 12.3.2 Collection vs Item Permission Resolution (Additive)

To enforce “cannot have lower access to a member than the collection”, compute an **effective permission** for each request:

- Let `p_collection` be the user’s effective permission on the parent collection (calendar/addressbook).
- Let `p_item` be the user’s direct/effective permission on the item (if the request targets a specific item).
- Define `p_effective = max(p_collection, p_item)` in the total ordering shown above.

Use `p_effective` for all authorization checks on that item.

Practical implications:
- If a user has `edit` on a calendar, a per-event entry of `read` does not reduce what they can do; they still have `edit`.
- If you expose ACLs, avoid emitting contradictory lower per-item entries that confuse clients; prefer representing the effective result.

#### 12.3.3 Suggested Mapping to WebDAV/CalDAV/CardDAV Operations

This is a pragmatic mapping used for enforcement and for deriving `DAV:current-user-privilege-set`:

- `read-freebusy`: allow `REPORT` free-busy only (`CALDAV:free-busy-query`), and minimal property discovery needed for clients to locate free-busy targets.
- `read`: allow read operations (`PROPFIND`, `REPORT` queries, `GET` on items).
- `edit` (and above): allow write-content operations (`PUT`, `DELETE`, and rename via `MOVE` where supported) and writable `PROPPATCH` on supported properties.
- Share-capable levels: allow the specific “share/ACL mutation” endpoints your app exposes; do not equate this to unconstrained `DAV:write-acl` unless you actually implement generic WebDAV ACL mutation.

#### 12.3.4 Permission Matrix (Practical)

Use this as the implementation checklist. Apply it to `p_effective` (after the additive resolution rule above).

**Collection-targeted operations** (calendar/addressbook collection):

| Level | Read discovery (`OPTIONS`, `PROPFIND`) | Query (`REPORT`) | Sync (`sync-collection`) | Create child items | Rename/move items | Delete items | Modify collection properties | Share to others |
|------:|----------------------------------------|------------------|--------------------------|-------------------|------------------|-------------|-----------------------------|----------------|
| `read-freebusy` | limited (only what’s needed for discovery) | **CalDAV only**: `free-busy-query` | optional (if you allow) | ✗ | ✗ | ✗ | ✗ | ✗ |
| `read` | ✓ | CalDAV: `calendar-query`, `calendar-multiget`, `free-busy-query` (if applicable); CardDAV: `addressbook-query`, `addressbook-multiget` | ✓ (read-only) | ✗ | ✗ | ✗ | ✗ | ✗ |
| `read-share` | ✓ | same as `read` | ✓ | ✗ | ✗ | ✗ | ✗ | grant up to `read` |
| `edit` | ✓ | same as `read` | ✓ | ✓ (PUT to create) | ✓ (MOVE where supported) | ✓ (DELETE) | limited (e.g., displayname/description) | ✗ |
| `edit-share` | ✓ | same as `read` | ✓ | ✓ | ✓ | ✓ | limited | grant up to `read` or `edit` |
| `admin` | ✓ | same as `read` | ✓ | ✓ | ✓ | ✓ | ✓ (within product policy) | grant up to `read`, `read-share`, `edit`, `edit-share` |
| `owner` | ✓ | same as `read` | ✓ | ✓ | ✓ | ✓ | ✓ | grant any (including `admin`); treat `owner` as the resource owner |

Notes:
- “Modify collection properties” should typically be restricted to a safe subset (`DAV:displayname`, description properties). If you support more, gate them at `admin`/`owner`.
- “Create child items” means creating/updating individual resources within the collection (CalDAV: calendar object resources; CardDAV: vCard resources). It does not imply creating new collections.

**Item-targeted operations** (event/vCard resource):

| Level | Read item (`GET`) | Read metadata (`PROPFIND` item) | Update (`PUT`) | Delete (`DELETE`) | Read freebusy |
|------:|-------------------|-------------------------------|----------------|------------------|--------------|
| `read-freebusy` | ✗ | limited | ✗ | ✗ | ✓ (via collection free-busy mechanisms) |
| `read` | ✓ | ✓ | ✗ | ✗ | ✓ (if applicable) |
| `read-share` | ✓ | ✓ | ✗ | ✗ | ✓ |
| `edit` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `edit-share` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `admin` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `owner` | ✓ | ✓ | ✓ | ✓ | ✓ |

**Share operations**:
- Sharing is product-defined (not a standardized WebDAV method in most client stacks). Implement it via app-specific endpoints and/or internal policy management.
- A share action should be authorized against the **collection** (or item, if you support per-item shares), and MUST respect the level’s “share ceiling” from the table above.

#### 12.3.5 Casbin Policy Shape (Recommended)

The bundled Casbin model (`src/component/auth/casbin_model.conf`) is designed so:
- **Additivity is automatic**: a grant on a collection applies to its members via containment (`g4`).
- **Higher levels imply lower levels**: modeled via a role hierarchy (`g5`) so you don’t have to duplicate policies.
- **Sharing ceilings are enforceable**: modeled as explicit “grant actions” (e.g., `share_grant:edit-share`).

**Casbin request**:
- `sub`: principal (`user:...`, `group:...`, `public`)
- `obj`: resource instance (`cal:...`, `evt:...`, `ab:...`, `card:...`)
- `act`: action string (see below)

**Policy rows** (conceptual; stored in `casbin_rule`):

- `p, <min_role>, <obj_type>, <act>`
    - Example: `p, read, calendar, read`
    - Example: `p, edit, calendar, write`
    - Example: `p, read-freebusy, calendar, read_freebusy`

- `g, <principal>, <resource>, <granted_role>`
    - Example: `g, user:alice, cal:team, edit-share`
    - Example: `g, group:eng, cal:team, read`

- `g2, <resource>, <obj_type>` (typing)
    - Example: `g2, cal:team, calendar`
    - Example: `g2, evt:team:123, calendar_event`

- `g4, <child>, <parent>` (containment)
    - Example: `g4, evt:team:123, cal:team`
    - Example: `g4, card:alice:456, ab:alice`

- `g5, <higher_role>, <lower_role>` (role implication)
    - Seed these once:
        - `g5, owner, admin`
        - `g5, admin, edit-share`
        - `g5, edit-share, edit`
        - `g5, edit, read-share`
        - `g5, read-share, read`
        - `g5, read, read-freebusy`

**Action vocabulary (minimal)**:
- `read_freebusy`: free-busy disclosure without event details (CalDAV)
- `read`: read items + metadata (PROPFIND/REPORT/GET)
- `write`: create/update/delete items (PUT/DELETE/MOVE rename)
- `share_grant:<level>`: grant a target principal up to `<level>`
    - Examples: `share_grant:read`, `share_grant:edit`, `share_grant:edit-share`

**Share ceiling via policy**:
- Allowing `share_grant:read` at `read-share`:
    - `p, read-share, calendar, share_grant:read`
- Allowing `share_grant:read` and `share_grant:edit` at `edit-share`:
    - `p, edit-share, calendar, share_grant:read`
    - `p, edit-share, calendar, share_grant:edit`
- Allowing `share_grant:read`, `read-share`, `edit`, `edit-share` at `admin`:
    - `p, admin, calendar, share_grant:read`
    - `p, admin, calendar, share_grant:read-share`
    - `p, admin, calendar, share_grant:edit`
    - `p, admin, calendar, share_grant:edit-share`

Repeat the `p, ...` entries for `addressbook` / `vcard` as needed.

#### 12.3.6 Seed Rules (SQL)

The Diesel Casbin adapter stores rules in the `casbin_rule` table.

- `ptype` is one of `p`, `g`, `g2`, `g3`, `g4`, `g5`.
- This schema uses `v0..v5` as required columns; when you only need `v0..v2`, store empty strings in the rest.

**Seed the permission hierarchy (`g5`) once**:

```sql
INSERT INTO casbin_rule (ptype, v0, v1, v2, v3, v4, v5) VALUES
    ('g5', 'owner',      'admin',      '', '', '', ''),
    ('g5', 'admin',      'edit-share', '', '', '', ''),
    ('g5', 'edit-share', 'edit',       '', '', '', ''),
    ('g5', 'edit',       'read-share', '', '', '', ''),
    ('g5', 'read-share', 'read',       '', '', '', ''),
    ('g5', 'read',       'read-freebusy', '', '', '', '');
```

**Baseline capability policies (`p`)**

These define what each *minimum role* allows on each *object type*.

Calendar types:

```sql
INSERT INTO casbin_rule (ptype, v0, v1, v2, v3, v4, v5) VALUES
    -- Calendar collections
    ('p', 'read-freebusy', 'calendar',       'read_freebusy', '', '', ''),
    ('p', 'read',          'calendar',       'read',          '', '', ''),
    ('p', 'edit',          'calendar',       'write',         '', '', ''),

    -- Calendar items (events)
    ('p', 'read',          'calendar_event', 'read',          '', '', ''),
    ('p', 'edit',          'calendar_event', 'write',         '', '', '');
```

Address book types:

```sql
INSERT INTO casbin_rule (ptype, v0, v1, v2, v3, v4, v5) VALUES
    -- Addressbook collections
    ('p', 'read',          'addressbook', 'read',  '', '', ''),
    ('p', 'edit',          'addressbook', 'write', '', '', ''),

    -- vCard items
    ('p', 'read',          'vcard',       'read',  '', '', ''),
    ('p', 'edit',          'vcard',       'write', '', '', '');
```

**Share ceilings (`share_grant:<level>`)**

These policies enforce what a share-capable user is allowed to grant to someone else.

Calendars:

```sql
INSERT INTO casbin_rule (ptype, v0, v1, v2, v3, v4, v5) VALUES
    ('p', 'read-share', 'calendar', 'share_grant:read',       '', '', ''),
    ('p', 'edit-share', 'calendar', 'share_grant:read',       '', '', ''),
    ('p', 'edit-share', 'calendar', 'share_grant:edit',       '', '', ''),
    ('p', 'admin',      'calendar', 'share_grant:read',       '', '', ''),
    ('p', 'admin',      'calendar', 'share_grant:read-share', '', '', ''),
    ('p', 'admin',      'calendar', 'share_grant:edit',       '', '', ''),
    ('p', 'admin',      'calendar', 'share_grant:edit-share', '', '', ''),
    ('p', 'owner',      'calendar', 'share_grant:admin',      '', '', '');
```

Addressbooks (mirror the same ceiling behavior):

```sql
INSERT INTO casbin_rule (ptype, v0, v1, v2, v3, v4, v5) VALUES
    ('p', 'read-share', 'addressbook', 'share_grant:read',       '', '', ''),
    ('p', 'edit-share', 'addressbook', 'share_grant:read',       '', '', ''),
    ('p', 'edit-share', 'addressbook', 'share_grant:edit',       '', '', ''),
    ('p', 'admin',      'addressbook', 'share_grant:read',       '', '', ''),
    ('p', 'admin',      'addressbook', 'share_grant:read-share', '', '', ''),
    ('p', 'admin',      'addressbook', 'share_grant:edit',       '', '', ''),
    ('p', 'admin',      'addressbook', 'share_grant:edit-share', '', '', ''),
    ('p', 'owner',      'addressbook', 'share_grant:admin',      '', '', '');
```

You still need to populate:
- `g2` edges to type each resource instance,
- `g4` edges for item → collection containment,
- `g` edges for actual grants (who has what role on which resource),
- and `g3` edges for user → group membership (if you use groups).

### 12.4 ACL Discovery Properties

Many clients PROPFIND these properties to decide which actions are permitted and to discover principals.

- `DAV:current-user-privilege-set`
- `DAV:supported-privilege-set` (clients use this to understand the privilege model)
- `DAV:acl` (if you expose ACLs)
- `DAV:acl-restrictions`
- `DAV:inherited-acl-set`
- `DAV:principal-collection-set`
- `DAV:principal-URL`
- `DAV:current-user-principal` (often requested alongside ACL properties)

At minimum, return consistent values for `DAV:current-user-privilege-set` and enforce the same privileges across all methods.

For properties you do not support, return a `207 Multi-Status` with a `404 Not Found` `propstat` for those properties rather than failing the entire PROPFIND.

---

## 13. Service Discovery

### 13.1 Well-Known URIs (RFC 6764)

| URI | Target |
|-----|--------|
| `/.well-known/caldav` | CalDAV context path |
| `/.well-known/carddav` | CardDAV context path |

Server MUST redirect (e.g., 301/303/307) to the actual service root.

### 13.2 Principal Discovery

**Flow**:
1. Client accesses well-known URI → redirect to context path
2. PROPFIND on context path for `DAV:current-user-principal`
3. PROPFIND on principal for `CALDAV:calendar-home-set` / `CARDDAV:addressbook-home-set`
4. PROPFIND on home set for calendar/addressbook collections

### 13.3 DNS SRV Records (RFC 6764)

```
_caldavs._tcp.example.com. SRV 0 1 443 caldav.example.com.
_carddavs._tcp.example.com. SRV 0 1 443 carddav.example.com.
```

TXT record for context path:
```
_caldavs._tcp.example.com. TXT "path=/caldav"
```

---

## 14. Database Schema Mapping

### 14.1 Entity-Instance Model

Shuriken separates canonical content from collection membership:

| Table | Purpose |
|-------|---------|
| `dav_collection` | Calendar/addressbook collections |
| `dav_entity` | Canonical content (icalendar/vcard) |
| `dav_instance` | Per-collection resource with URI and ETag |
| `dav_component` | Component tree (VCALENDAR→VEVENT→VALARM) |
| `dav_property` | Property storage with typed values |
| `dav_parameter` | Property parameters |

### 14.2 Storage Flow

**PUT Request**:
1. Parse and validate content
2. Create/update `dav_entity` with logical UID
3. Create/update `dav_instance` with URI and ETag
4. Upsert component tree into `dav_component`
5. Upsert properties into `dav_property`
6. Update derived indexes (`cal_index`, `card_index`)
7. Increment collection `synctoken`

### 14.3 Derived Indexes

#### 14.3.1 Calendar Indexes

| Table | Purpose |
|-------|---------|
| `cal_index` | Query optimization: UID, time range, summary |
| `cal_occurrence` | Pre-expanded recurrence instances |

#### 14.3.2 Address Book Indexes

| Table | Purpose |
|-------|---------|
| `card_index` | Primary vCard query index |
| `card_email` | Email address lookup |
| `card_phone` | Phone number lookup |

**card_index Schema**:

```sql
CREATE TABLE card_index (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    entity_id UUID NOT NULL REFERENCES dav_entity(id) ON DELETE CASCADE,
    
    -- Core identification
    uid TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'individual',  -- individual/group/org/location
    
    -- Primary display/search fields
    fn TEXT NOT NULL,                          -- Formatted name (required)
    fn_sort TEXT,                              -- SORT-AS value for FN
    
    -- Structured name components (flattened for search)
    n_family TEXT,
    n_given TEXT,
    n_additional TEXT,
    n_sort TEXT,                               -- SORT-AS value for N
    
    -- Organization info
    org_name TEXT,
    org_unit TEXT,                             -- First unit only
    title TEXT,
    role TEXT,
    
    -- Full-text search
    search_vector TSVECTOR,                    -- For PostgreSQL full-text
    
    -- Normalized text for collation-based matching
    fn_normalized TEXT,                        -- Lowercased/normalized for i;unicode-casemap
    
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON card_index (entity_id);
CREATE INDEX ON card_index (uid);
CREATE INDEX ON card_index (fn_normalized);
CREATE INDEX ON card_index (org_name);
CREATE INDEX ON card_index USING GIN (search_vector);
```

**card_email Schema**:

```sql
CREATE TABLE card_email (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    entity_id UUID NOT NULL REFERENCES dav_entity(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    email_normalized TEXT NOT NULL,            -- Lowercased
    type_work BOOLEAN NOT NULL DEFAULT FALSE,
    type_home BOOLEAN NOT NULL DEFAULT FALSE,
    pref INTEGER                               -- PREF parameter value (1-100)
);

CREATE INDEX ON card_email (entity_id);
CREATE INDEX ON card_email (email_normalized);
CREATE INDEX ON card_email (email_normalized text_pattern_ops);  -- For prefix search
```

**card_phone Schema**:

```sql
CREATE TABLE card_phone (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    entity_id UUID NOT NULL REFERENCES dav_entity(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    phone_normalized TEXT NOT NULL,            -- Digits only
    type_voice BOOLEAN NOT NULL DEFAULT FALSE,
    type_cell BOOLEAN NOT NULL DEFAULT FALSE,
    type_fax BOOLEAN NOT NULL DEFAULT FALSE,
    type_work BOOLEAN NOT NULL DEFAULT FALSE,
    type_home BOOLEAN NOT NULL DEFAULT FALSE,
    pref INTEGER
);

CREATE INDEX ON card_phone (entity_id);
CREATE INDEX ON card_phone (phone_normalized);
```

**Populating card_index**:

```rust
fn extract_card_index(vcard: &VCard) -> CardIndex {
    CardIndex {
        uid: vcard.get_property("UID").map(|p| p.value_text()).unwrap_or_default(),
        kind: vcard.get_property("KIND").map(|p| p.value_text()).unwrap_or("individual"),
        fn_value: vcard.get_required_property("FN").value_text(),
        fn_sort: vcard.get_property("FN").and_then(|p| p.get_param("SORT-AS")),
        n_family: extract_n_component(vcard, 0),
        n_given: extract_n_component(vcard, 1),
        n_additional: extract_n_component(vcard, 2),
        n_sort: vcard.get_property("N").and_then(|p| p.get_param("SORT-AS")),
        org_name: extract_org_name(vcard),
        org_unit: extract_org_unit(vcard),
        title: vcard.get_property("TITLE").map(|p| p.value_text()),
        role: vcard.get_property("ROLE").map(|p| p.value_text()),
        search_vector: build_search_vector(vcard),
        fn_normalized: normalize_unicode_casemap(&fn_value),
    }
}

fn normalize_unicode_casemap(s: &str) -> String {
    // Unicode Default Case Algorithm (simple case folding)
    s.chars()
        .flat_map(|c| c.to_lowercase())
        .collect()
}
```

**Query Execution Using Indexes**:

```rust
fn execute_addressbook_query(
    collection_id: Uuid,
    filter: &Filter,
    conn: &mut DbConnection<'_>,
) -> Result<Vec<AddressObjectResource>> {
    let mut query = card_index::table
        .inner_join(dav_instance::table.on(
            card_index::entity_id.eq(dav_instance::entity_id)
        ))
        .filter(dav_instance::collection_id.eq(collection_id))
        .into_boxed();

    // Apply filter conditions
    for prop_filter in &filter.prop_filters {
        query = apply_prop_filter(query, prop_filter);
    }

    query.load(conn)
}

fn apply_prop_filter(
    query: BoxedQuery,
    pf: &PropFilter,
) -> BoxedQuery {
    match pf.name.to_uppercase().as_str() {
        "FN" => apply_text_match(query, card_index::fn_normalized, &pf.text_match),
        "EMAIL" => {
            // Join to card_email table
            // Apply text-match to email_normalized
        }
        "TEL" => {
            // Join to card_phone table
        }
        "ORG" => apply_text_match(query, card_index::org_name, &pf.text_match),
        "NICKNAME" | "NOTE" | "CATEGORIES" => {
            // Fall back to full-text search or raw property scan
        }
        _ => {
            // Unsupported filter: return CARDDAV:supported-filter error
            // Or fall back to scanning dav_property table
        }
    }
}
```

### 14.4 Tombstones

`dav_tombstone` tracks deleted resources for sync:
- `collection_id`, `uri`: Identify deleted resource
- `synctoken`, `sync_revision`: For sync-collection queries
- `deleted_at`: Cleanup scheduling

---

## 15. Error Handling & Preconditions

### 15.1 DAV Error Response Format

```xml
<?xml version="1.0" encoding="utf-8"?>
<D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <C:valid-calendar-data/>
</D:error>
```

### 15.2 Status Codes

| Code | Meaning |
|------|---------|
| 201 | Created |
| 204 | No Content (successful update) |
| 207 | Multi-Status (PROPFIND/REPORT responses) |
| 400 | Bad Request (parse error) |
| 403 | Forbidden (precondition/postcondition failed; repeating will not help) |
| 404 | Not Found |
| 409 | Conflict (precondition/postcondition failed; may be resolvable) |
| 412 | Precondition Failed (If-Match failed) |
| 415 | Unsupported Media Type |
| 507 | Insufficient Storage |

### 15.3 Precondition Elements

**CalDAV (RFC 4791)**:
- `valid-calendar-data`
- `valid-calendar-object-resource`
- `supported-calendar-component`
- `supported-calendar-data`
- `no-uid-conflict`
- `supported-filter`
- `valid-filter`
- `supported-collation`
- `number-of-matches-within-limits`
- `max-resource-size`
- `min-date-time` / `max-date-time`
- `max-instances`
- `max-attendees-per-instance`

**CardDAV (RFC 6352)**:

| Precondition | Triggered When |
|--------------|----------------|
| `CARDDAV:valid-address-data` | vCard syntax is invalid |
| `CARDDAV:supported-address-data` | Unsupported media type or vCard version |
| `CARDDAV:no-uid-conflict` | UID already in collection (or changed on update) |
| `CARDDAV:addressbook-collection-location-ok` | Invalid destination for COPY/MOVE |
| `CARDDAV:max-resource-size` | vCard exceeds size limit |
| `CARDDAV:supported-filter` | Query uses unsupported property/parameter |
| `CARDDAV:supported-collation` | Query uses unsupported collation |
| `CARDDAV:supported-address-data-conversion` | Cannot convert to requested format (GET Accept) |
| `DAV:number-of-matches-within-limits` | Query results exceed server limit |

**CardDAV Precondition Examples**:

```xml
<!-- Invalid vCard syntax -->
<D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <C:valid-address-data/>
</D:error>

<!-- UID conflict -->
<D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <C:no-uid-conflict>
    <D:href>/addressbooks/user/contacts/existing-contact.vcf</D:href>
  </C:no-uid-conflict>
</D:error>

<!-- Unsupported filter -->
<D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <C:supported-filter>
    <C:prop-filter name="X-CUSTOM-PROPERTY"/>
  </C:supported-filter>
</D:error>

<!-- Unsupported collation -->
<D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <C:supported-collation/>
</D:error>
```

Note: Some servers include extra, non-standard elements for debugging in error bodies. Clients should not depend on them.

---

## 16. Implementation Phases

### Phase 0: Database Schema and Architecture

Create database migrations to bring the database up to the level needed for full implementation.

Build out the skeleton file structure and traits that will be used going forward.

### Phase 1: Core Parsing & Serialization

**Goal**: Round-trip iCalendar and vCard data without loss.

1. Implement iCalendar lexer and parser (`src/component/rfc/ical/`)
   - Content line parsing with unfolding
   - Parameter parsing with quoting
   - Value type parsing (DATE, DATE-TIME, DURATION, etc.)
   - RRULE parsing
   
2. Implement iCalendar serializer
   - Content line formatting with folding
   - Canonical ordering for deterministic output

3. Implement vCard parser and serializer (`src/component/rfc/vcard/`)
   - Similar structure to iCalendar
   - Handle vCard-specific escaping

4. Implement WebDAV XML parsing (`src/component/rfc/dav/`)
   - PROPFIND/PROPPATCH/REPORT request parsing
   - Multistatus response generation

**Deliverables**: 
- `ICalParser`, `ICalSerializer` types
- `VCardParser`, `VCardSerializer` types  
- `DavXmlParser`, `DavXmlSerializer` types
- Comprehensive test suites with RFC examples

#### Phase 1 Testing Notes

These tests should be mostly pure unit tests with fixture inputs (string in → AST out), plus golden tests for serializer output (AST in → bytes out).

1. **Plan 1.1 — iCalendar lexer and parser**
     - Content line parsing + unfolding
         - `ical_unfold_simple`: folded line with a single leading space unfolds correctly.
         - `ical_unfold_multiple`: multiple folds unfold correctly and preserve bytes.
         - `ical_unfold_invalid`: fold without a preceding line rejects cleanly.
         - `ical_unfold_crlf_only`: accepts CRLF line endings (reject bare LF if you decide to be strict).
     - Parameter parsing with quoting
         - `ical_param_quoted_semicolon`: `CN="Doe\; Jane"` parses to `Doe; Jane`.
         - `ical_param_quoted_comma`: quoted values do not split as multi-valued.
         - `ical_param_multivalue_unquoted`: `ROLE=REQ-PARTICIPANT,OPT-PARTICIPANT` yields two values.
         - `ical_param_bad_quote`: missing closing quote yields parse error with location.
     - Value type parsing
         - `ical_date_basic`: `VALUE=DATE:20260123` parses as date.
         - `ical_datetime_utc`: `20260123T120000Z` parses as UTC.
         - `ical_datetime_tzid`: `TZID=Europe/Berlin:20260123T120000` retains TZID association.
         - `ical_duration`: `PT15M` parses as duration.
         - `ical_text_escaping`: `SUMMARY:hello\, world\nline2` unescapes correctly.
     - RRULE parsing
         - `ical_rrule_basic`: `FREQ=DAILY;COUNT=10`.
         - `ical_rrule_until_vs_count`: reject RRULE that violates your chosen constraints (or accept if you support).
         - `ical_rrule_bysetpos`: parse BYSETPOS with negative values.
         - `ical_rrule_invalid_freq`: invalid FREQ rejects.
     - Structural parsing
         - `ical_component_tree`: VCALENDAR→VEVENT nesting parses correctly.
         - `ical_multi_vevent`: multiple VEVENTs parse and preserve each UID.
         - `ical_unknown_x_props_roundtrip`: unknown `X-` props are preserved.

2. **Plan 1.2 — iCalendar serializer**
     - Content line formatting + folding
         - `ical_fold_boundary_75_octets`: folds at the correct boundary (octets, not chars).
         - `ical_fold_utf8`: does not split multi-byte UTF-8 sequences.
         - `ical_fold_long_param`: long parameter values fold correctly.
     - Canonical ordering / deterministic output
         - `ical_canonical_prop_order`: properties output in your canonical order.
         - `ical_canonical_param_order`: params output in canonical order.
         - `ical_canonical_normalize_lf`: normalizes line endings to CRLF.
     - Round-trip invariants
         - `ical_roundtrip_equivalence`: parse→serialize→parse yields semantically equivalent structure.
         - `ical_normalize_etag_stability`: semantically equivalent inputs produce identical serialized bytes (if you do canonicalization).

3. **Plan 1.3 — vCard parser and serializer**
     - vCard 3.0 + 4.0 input compatibility
         - `vcard_v3_basic`: `BEGIN:VCARD` / `VERSION:3.0` parses.
         - `vcard_v4_basic`: `VERSION:4.0` parses.
         - `vcard_grouped_props`: `item1.EMAIL:...` group name preserved.
     - vCard escaping + folding
         - `vcard_text_escapes_v3`: `\,` and `\n` unescape as expected.
         - `vcard_fold_unfold`: folding/unfolding works like iCalendar.
     - Parameter parsing
         - `vcard_param_type_multi`: `TYPE=HOME,INTERNET` yields two types.
         - `vcard_param_bad_quote`: malformed param quoting rejects.
     - Interop conversion
         - `vcard_emit_v3_for_carddav`: if you choose to emit v3 for compatibility, ensure emitted `VERSION` is v3 and all required mappings are applied.
     - Robustness
         - `vcard_unknown_props_roundtrip`: unknown props preserved.
         - `vcard_invalid_structure`: missing END:VCARD rejects.

4. **Plan 1.4 — WebDAV XML parsing and multistatus generation**
     - Request XML parsing
         - `dav_parse_propfind_allprop`: parse `DAV:propfind` with `allprop`.
         - `dav_parse_propfind_prop`: parse `prop` listing with multiple namespaces.
         - `dav_parse_proppatch_set_remove`: parse set/remove blocks and preserve ordering.
         - `dav_parse_report_unknown`: unknown report name is detected and mapped to correct error path.
         - `dav_parse_report_namespaces`: unknown prefixes / namespace mappings handled correctly.
     - Multistatus serialization (golden tests)
         - `dav_207_propstat_200_404`: same response contains 200 for supported props and 404 for unknown props.
         - `dav_href_encoding`: hrefs are correctly escaped/normalized.
         - `dav_status_line_format`: `HTTP/1.1 200 OK` formatting exactly as expected by strict clients.
     - Robustness
         - `dav_unknown_prop_does_not_fail`: unknown properties do not cause request failure; they just get 404 propstat.

### Phase 2: Database Operations

**Goal**: Store and retrieve DAV resources correctly.

1. Implement entity storage layer (`src/component/db/query/dav/`)
   - `create_entity`, `update_entity`, `get_entity`
   - Component tree CRUD
   - Property/parameter CRUD

2. Implement collection operations
   - `create_collection`, `get_collection`, `list_collections`
   - `update_synctoken`

3. Implement instance operations
   - `create_instance`, `update_instance`, `delete_instance`
   - ETag generation
   - Tombstone creation

4. Implement derived index updates
   - Trigger updates on entity changes
   - `cal_index` population from parsed iCalendar
   - `card_index` population from parsed vCard

**Deliverables**:
- Database query modules
- Mapping functions between parsed types and DB models
- Transaction handling for atomic operations

#### Phase 2 Testing Notes

These should be Postgres integration tests. Prefer running migrations into an isolated schema/database and truncating between tests.

1. **Plan 2.1 — Entity storage layer (`create_entity`, `update_entity`, `get_entity`)**
     - Persistence
         - `db_entity_roundtrip_ical`: insert an iCalendar entity and read it back; component tree shape matches.
         - `db_entity_roundtrip_vcard`: insert a vCard entity and read it back.
         - `db_entity_properties_parameters`: properties and parameters are persisted and reloaded exactly.
     - Update semantics
         - `db_entity_update_replaces_tree`: update swaps the component/property tree as intended (replace vs patch).
         - `db_entity_update_idempotent`: applying the same update twice yields identical DB state.
     - Transactionality
         - `db_entity_insert_rollback_on_error`: induce a constraint violation mid-write and assert no partial rows exist.
         - `db_entity_update_rollback_on_error`: same for update paths.

2. **Plan 2.2 — Collection operations (`create_collection`, `get_collection`, `list_collections`, `update_synctoken`)**
     - CRUD + ownership
         - `db_collection_create_get`: created collection returns correct owner principal.
         - `db_collection_list_filters_deleted`: soft-deleted collections are excluded (if applicable).
     - Sync token monotonicity
         - `db_synctoken_increments_on_member_change`: any membership change increments.
         - `db_synctoken_increments_on_content_change`: PUT update increments.
         - `db_synctoken_not_incremented_on_read`: PROPFIND/GET do not increment.

3. **Plan 2.3 — Instance operations (`create_instance`, `update_instance`, `delete_instance`)**
     - Basic CRUD
         - `db_instance_create_then_get`: instance references entity and collection.
         - `db_instance_update_changes_etag`: content update changes etag (if you generate from canonical bytes).
     - Deletion + tombstones
         - `db_instance_delete_creates_tombstone`: tombstone contains href/resource-id and revision.
         - `db_instance_delete_idempotent`: deleting already-deleted resource produces stable outcome.
     - ETag behavior
         - `db_etag_stable_on_read`: multiple reads return same ETag.
         - `db_etag_changes_on_semantic_change`: actual content change changes ETag.

4. **Plan 2.4 — Derived index updates (`cal_index`, `card_index`)**
     - Calendar indexing
         - `db_cal_index_uid_lookup`: UID stored and queryable.
         - `db_cal_index_timerange_query`: DTSTART/DTEND and recurrence-derived bounds support range queries.
     - Card indexing
         - `db_card_index_fn_search`: FN stored and queryable.
         - `db_card_index_email_phone`: emails/phones extracted into index tables.
     - Update propagation
         - `db_index_updates_on_entity_update`: update entity triggers index update.
         - `db_index_cleanup_on_delete`: delete removes/marks index entries consistently.

### Phase 3: Basic HTTP Methods

**Goal**: Support OPTIONS, PROPFIND/PROPPATCH, GET/HEAD, PUT, DELETE, COPY, MOVE.

1. Implement OPTIONS handler
2. Implement PROPFIND handler
    - Property retrieval from DB
    - Depth handling
    - Ensure `DAV:supported-report-set` is returned for collections and reflects the REPORTs you actually implement (and reject unsupported REPORTs with the appropriate error)
    - Multistatus response generation

3. Implement PROPPATCH handler
    - Validate protected properties (reject attempts to set them)
    - Apply writable properties like `DAV:displayname` and DAV/CalDAV/CardDAV descriptions where permitted
    - Return per-property status via `207 Multi-Status`

4. Implement GET/HEAD handler
    - Resource retrieval
    - ETag and Last-Modified headers
    - Content-Type handling

5. Implement PUT handler
    - Parse and validate content
    - Precondition checking
    - If-Match/If-None-Match handling
    - Entity storage

6. Implement DELETE handler
    - Tombstone creation
    - Collection recursive delete

7. Implement COPY/MOVE handlers
    - Enforce destination rules (e.g., CardDAV `addressbook-collection-location-ok`)
    - Preserve/adjust ETags, sync tokens, and tombstones appropriately

8. Implement MKCALENDAR/MKCOL handlers
    - For address books, implement Extended MKCOL request parsing/validation (RFC 5689) so clients can set displayname/description at creation time

**Deliverables**:
- Salvo route handlers in `src/app/api/caldav/` and `src/app/api/carddav/`
- Property resolution logic
- Request validation middleware

#### Phase 3 Testing Notes

General approach:
- These are protocol-level integration tests: run the Salvo app against a test Postgres and issue real HTTP requests.
- For each test, assert both:
    - **HTTP correctness**: status code, required headers, and XML/bytes body.
    - **DB correctness**: resource rows, ETag changes, sync-token bumps, and tombstones.

1. **Plan 3.1 — OPTIONS handler**
     - `options_allow_methods_collection`: `Allow` contains expected verbs on a calendar/addressbook collection.
     - `options_allow_methods_item`: `Allow` contains expected verbs on a single `.ics`/`.vcf` resource.
     - `options_dav_header_minimal`: `DAV` header advertises only what’s implemented.
     - `options_no_locking_advertised_without_lock`: do not include class `2` unless LOCK/UNLOCK exists.
     - `options_no_auto_schedule_without_rfc6638`: do not advertise scheduling features unless present.

2. **Plan 3.2 — PROPFIND handler**
     - Depth handling
         - `propfind_depth0_collection`: returns only the collection.
         - `propfind_depth1_collection`: returns collection + immediate members.
         - `propfind_depth_infinity_rejected_or_supported`: whatever you choose, it is consistent and documented.
     - Property resolution
         - `propfind_known_props_200`: common DAV/CalDAV/CardDAV properties return 200 propstat.
         - `propfind_unknown_props_404`: unknown properties return 404 propstat.
         - `propfind_mixed_props_207`: mixed statuses in one multistatus are correct.
     - `DAV:supported-report-set`
         - `propfind_supported_report_set_calendar`: calendar collection advertises calendar reports you implement.
         - `propfind_supported_report_set_addressbook`: addressbook collection advertises carddav reports you implement.
         - `propfind_supported_report_set_consistency`: every advertised report is actually accepted by REPORT; no “lies.”
     - Auth interactions
         - `propfind_unauthenticated_401`: protected collections return 401 (if auth is required).
         - `propfind_unauthorized_403`: authenticated but denied returns 403.

3. **Plan 3.3 — PROPPATCH handler**
     - Protected properties
         - `proppatch_set_protected_prop_403`: protected prop returns 403 in propstat and does not mutate DB.
         - `proppatch_remove_protected_prop_403`: same for remove.
     - Writable properties
         - `proppatch_set_displayname_200`: `DAV:displayname` persists and returns 200.
         - `proppatch_set_description_200`: caldav/carddav description persists (where supported).
         - `proppatch_partial_success_207`: some props succeed while others fail; per-prop statuses correct.
     - Authorization
         - `proppatch_denied_no_mutation`: a denied request yields 403 and does not change writable props.

4. **Plan 3.4 — GET/HEAD handler**
     - Content + metadata
         - `get_calendar_object_content_type`: `.ics` returns correct content-type.
         - `get_vcard_content_type`: `.vcf` returns correct content-type.
         - `head_matches_get_headers`: HEAD matches GET headers.
         - `get_etag_present_and_strong`: ETag exists and is strong (if that’s your design).
     - Conditional requests
         - `get_if_none_match_304`: matching ETag yields 304.
         - `get_if_match_412`: If-Match mismatch yields 412 where applicable.

5. **Plan 3.5 — PUT handler**
     - Precondition handling
         - `put_create_if_none_match_star_ok`: create with `If-None-Match: *` when missing succeeds.
         - `put_create_if_none_match_star_fails_when_exists`: returns 412.
         - `put_update_if_match_required`: if you require If-Match for updates, missing header yields 412/428 (pick one strategy and test it).
         - `put_update_if_match_mismatch_412`: mismatch yields 412.
     - Data validation
         - `put_invalid_ical_valid_calendar_data_precondition`: returns proper CalDAV error element.
         - `put_invalid_vcard_valid_address_data_precondition`: returns proper CardDAV error element.
         - `put_uid_conflict_no_uid_conflict_precondition`: returns `no-uid-conflict` with href.
     - Side effects
         - `put_bumps_synctoken`: collection token increments.
         - `put_updates_etag`: ETag changes on content change.
         - `put_updates_indexes`: derived index rows match new content.

6. **Plan 3.6 — DELETE handler**
     - Resource deletion
         - `delete_item_creates_tombstone`: tombstone created and sync token increments.
         - `delete_item_idempotent`: repeated delete yields stable result (404/204 depending on chosen behavior).
     - Collection deletion
         - `delete_collection_recursive_or_rejected`: whichever you choose, test it explicitly.
         - `delete_collection_does_not_leave_orphans`: no orphaned instances/entities remain.

7. **Plan 3.7 — COPY/MOVE handlers**
     - MOVE as rename
         - `move_rename_item_updates_href`: resource appears at destination.
         - `move_rename_updates_sync_token`: both source and dest collection tokens updated if they differ.
     - Destination rules + conflicts
         - `copy_addressbook_collection_location_ok`: CardDAV destination precondition enforced.
         - `move_destination_exists_conflict`: overwrite/409/412 behavior matches your implementation.
     - Tombstones
         - `move_generates_tombstone_on_source_delete`: old href deletion is visible to sync.

8. **Plan 3.8 — MKCALENDAR/MKCOL (Extended MKCOL) handlers**
     - MKCALENDAR
         - `mkcalendar_creates_calendar_collection`: resourcetype includes calendar.
         - `mkcalendar_initial_props_applied`: displayname/description set at creation time.
     - Extended MKCOL
         - `mkcol_extended_creates_addressbook`: resourcetype includes addressbook.
         - `mkcol_extended_rejects_bad_body`: invalid XML yields 400 with useful error.
         - `mkcol_extended_applies_initial_props`: displayname/description applied.

### Phase 4: Query Reports

**Goal**: Support calendar-query, addressbook-query, multiget.

1. Implement `calendar-query` report
   - Filter parsing
   - Component filtering
   - Property filtering
   - Time-range filtering (with recurrence)

2. Implement `calendar-multiget` report

3. Implement `addressbook-query` report
   - Text matching with collations
   - Property filtering

4. Implement `addressbook-multiget` report

5. Implement `DAV:expand-property` report (RFC 3253)
    - Required by CardDAV for common principal/ACL discovery workflows

6. Implement partial retrieval
   - `calendar-data` component/property selection
   - `address-data` property selection

**Deliverables**:
- Report handler implementations
- Filter evaluation engine
- Collation implementations

#### Phase 4 Testing Notes

These should be integration tests that seed data then run REPORT requests, asserting 207 bodies are correct.

1. **Plan 4.1 — `calendar-query` report**
     - Filter parsing
         - `cal_query_rejects_invalid_xml`: malformed XML yields 400.
         - `cal_query_rejects_unknown_elements`: unknown elements handled per your strictness rules.
     - Component + property filtering
         - `cal_query_comp_filter_vevent_only`: returns only VEVENTs.
         - `cal_query_prop_filter_uid`: filter by UID returns correct resources.
     - Time-range filtering
         - `cal_query_timerange_simple`: single event in range included.
         - `cal_query_timerange_exclusive_edges`: boundary conditions match spec/your interpretation.
         - `cal_query_timerange_timezone`: TZID-bearing DTSTART behaves correctly.
     - Recurrence interactions
         - `cal_query_recurring_overlaps_range`: recurring event included when any instance overlaps.
         - `cal_query_override_recurrence_id`: overridden instance behavior is correct.
     - Negative / unsupported
         - `cal_query_unsupported_filter_supported_filter_error`: returns `supported-filter` precondition.

2. **Plan 4.2 — `calendar-multiget` report**
     - `cal_multiget_returns_requested_hrefs`: returns exactly the requested set.
     - `cal_multiget_missing_href_404_in_multistatus`: missing resource yields per-href 404.
     - `cal_multiget_mixed_collections_forbidden`: hrefs outside collection are rejected (403/404 per your policy).

3. **Plan 4.3 — `addressbook-query` report**
     - Text matching + collations
         - `card_query_default_collation_unicode_casemap`: case-insensitive behavior matches chosen default.
         - `card_query_unsupported_collation_supported_collation_error`: returns `supported-collation` error.
         - `card_query_text_match_no_wildcards`: ensure `*` is rejected/treated per RFC constraints.
     - Property filtering
         - `card_query_prop_filter_fn`: returns matching contacts by FN.
         - `card_query_prop_filter_email`: returns matching contacts by email.
         - `card_query_prop_filter_uid`: returns matching contacts by UID.
     - Negative / unsupported
         - `card_query_unsupported_filter_supported_filter_error`.

4. **Plan 4.4 — `addressbook-multiget` report**
     - `card_multiget_returns_vcards`: returns `address-data` with correct version/media type.
     - `card_multiget_missing_href_404_in_multistatus`.

5. **Plan 4.5 — `DAV:expand-property` report**
     - `expand_property_principal_url`: expands `principal-URL`.
     - `expand_property_current_user_privilege_set`: expands ACL-related props used by clients.
     - `expand_property_unknown_prop_404_propstat`: unknown expanded prop yields 404 propstat.
     - `expand_property_cycle_bounded`: cycles or excessive depth are rejected or bounded deterministically.

6. **Plan 4.6 — Partial retrieval (`calendar-data`, `address-data`)**
     - `calendar_data_comp_selection`: request VEVENT only vs full VCALENDAR.
     - `calendar_data_prop_selection`: include/exclude specific properties.
     - `address_data_prop_selection`: include/exclude specific vCard properties.
     - `partial_retrieval_invalid_request_400`: invalid selectors rejected.

### Phase 5: Recurrence & Time Zones

**Goal**: Correct recurrence expansion and time zone handling.

1. Implement RRULE expander
   - Frequency iteration
   - BYxxx rule application
   - UNTIL/COUNT limiting
   - EXDATE exclusion
   - RDATE inclusion

2. Implement VTIMEZONE parser
3. Implement UTC conversion utilities
4. Implement `cal_occurrence` population (optional optimization)

5. Implement `expand` and `limit-recurrence-set` handling

**Deliverables**:
- Recurrence expansion library
- Time zone resolution utilities
- Occurrence cache management

#### Phase 5 Testing Notes

1. **Plan 5.1 — RRULE expander**
     - Frequency iteration
         - `rrule_daily_simple`: daily for N occurrences.
         - `rrule_weekly_byday`: weekly BYDAY selection.
         - `rrule_monthly_bymonthday`: monthly BYMONTHDAY.
         - `rrule_yearly_bymonth_byday`: yearly patterns.
     - BYxxx rule application
         - `rrule_bysetpos_positive`: BYSETPOS=1 selects first.
         - `rrule_bysetpos_negative`: BYSETPOS=-1 selects last.
         - `rrule_byeaster_or_unsupported`: explicitly reject unsupported extensions.
     - UNTIL/COUNT limiting
         - `rrule_count_wins`: COUNT stops even if UNTIL later.
         - `rrule_until_inclusive_rules`: boundary behavior consistent.
     - EXDATE exclusion / RDATE inclusion
         - `rrule_exdate_removes_instance`.
         - `rrule_rdate_adds_instance`.
     - Limits
         - `rrule_max_instances_enforced`: beyond max triggers the chosen failure mode.

2. **Plan 5.2 — VTIMEZONE parser**
     - `vtimezone_parse_standard_daylight`: parses standard/daylight blocks.
     - `vtimezone_parse_multiple_transitions`: multiple rules.
     - `vtimezone_unknown_tzid`: unknown TZIDs handled per your policy (reject vs allow as opaque).

3. **Plan 5.3 — UTC conversion utilities**
     - `tz_convert_dst_gap`: non-existent local times handled deterministically.
     - `tz_convert_dst_fold`: ambiguous local times handled deterministically.
     - `tz_convert_roundtrip_instant`: instant preserved for representable times.

4. **Plan 5.4 — `cal_occurrence` population (optional)**
     - `occ_cache_matches_expansion`: cache equals on-the-fly results.
     - `occ_cache_invalidation_on_update`: updates invalidate prior occurrences.
     - `occ_cache_invalidation_on_timezone_change`: timezone updates trigger rebuild.

5. **Plan 5.5 — `expand` + `limit-recurrence-set` handling**
     - `report_expand_returns_instances`: expanded output contains instances.
     - `report_limit_recurrence_set_bounds`: bounded output respects requested limits.
     - `report_expand_limit_interaction`: combined behavior is consistent.

### Phase 6: Synchronization

**Goal**: Support sync-collection report and efficient polling.

1. Implement `sync-collection` report
   - Token validation
   - Change detection
   - Tombstone inclusion
   - New token generation

2. Implement CTag property

3. Implement ETag-based conditional operations

**Deliverables**:
- Sync report handler
- Token management utilities

#### Phase 6 Testing Notes

1. **Plan 6.1 — `sync-collection` report**
     - Token validation
         - `sync_invalid_token_valid_sync_token_error`: invalid token yields `valid-sync-token` error element.
         - `sync_token_not_leaked_across_users`: token is scoped to collection + auth context.
     - Change detection
         - `sync_initial_returns_all_members`: empty token returns full membership.
         - `sync_incremental_create`: created resource appears as changed with propstat.
         - `sync_incremental_update`: updated resource appears as changed with propstat.
         - `sync_incremental_delete`: deleted resource appears with 404 status-only response.
         - `sync_no_changes_returns_empty_set`: stable token returns empty changes but new token (if you issue new).
     - Depth constraints
         - `sync_depth_not_zero_400`: Depth != 0 yields 400.
     - Truncation / paging
         - `sync_truncation_507_on_request_uri`: server indicates truncation with 507 for request-URI.
         - `sync_truncation_next_token_progresses`: paging token progresses and eventually completes.
         - `sync_truncation_deterministic_ordering`: repeated sync yields stable ordering to avoid duplicates.

2. **Plan 6.2 — CTag property**
     - `ctag_changes_on_member_add`: add member changes CTag.
     - `ctag_changes_on_member_delete`: delete member changes CTag.
     - `ctag_changes_on_content_update`: update changes CTag.
     - `ctag_stable_on_read_only`: PROPFIND/GET does not change CTag.

3. **Plan 6.3 — ETag-based conditional operations**
     - `put_if_match_concurrent_writers`: two writers; second with stale ETag gets 412.
     - `delete_if_match_mismatch_412`: conditional delete rejected.
     - `copy_move_preserves_or_updates_etag`: behavior is consistent and documented.

### Phase 7: Free-Busy & Scheduling

**Goal**: Support free-busy queries and basic scheduling.

1. Implement `free-busy-query` report
   - Event aggregation
   - Period merging
   - VFREEBUSY generation

2. Implement scheduling collections (inbox/outbox)

3. Implement scheduling detection on PUT
   - ATTENDEE change detection
   - PARTSTAT change detection

4. Implement internal scheduling message delivery

5. (Future) Implement iMIP gateway for external scheduling

**Deliverables**:
- Free-busy aggregation logic
- Scheduling workflow handlers

#### Phase 7 Testing Notes

1. **Plan 7.1 — `free-busy-query` report**
     - Aggregation + merging
         - `freebusy_merges_overlaps`: overlapping events merge into one busy period.
         - `freebusy_keeps_gaps`: separate events produce separate periods.
         - `freebusy_boundary_inclusive_rules`: edges behave consistently.
     - Status semantics
         - `freebusy_cancelled_ignored`: CANCELLED does not contribute.
         - `freebusy_transparent_ignored`: TRANSPARENT does not contribute.
     - Authorization semantics
         - `freebusy_allowed_read_freebusy`: allowed at `read-freebusy`.
         - `freebusy_denied_below_read_freebusy`: denied below.
         - `freebusy_does_not_leak_summaries`: response contains only busy time, not event details.

2. **Plan 7.2 — Scheduling collections (inbox/outbox)**
     - `schedule_inbox_outbox_discoverable`: PROPFIND returns inbox/outbox URLs.
     - `schedule_inbox_access_control`: only owner/delegates can read.
     - `schedule_outbox_write_control`: only authorized senders can write.

3. **Plan 7.3 — Scheduling detection on PUT**
     - Organizer/attendee flows
         - `schedule_put_organizer_change_generates_request`: organizer updates generate a REQUEST.
         - `schedule_put_cancel_generates_cancel`: cancellation generates CANCEL.
         - `schedule_put_partstat_change_generates_reply`: attendee PARTSTAT change generates REPLY.
     - Idempotency
         - `schedule_put_same_content_no_duplicates`: identical PUT does not enqueue duplicates.
         - `schedule_put_etag_guarded`: If-Match/ETag prevents accidental double-processing.

4. **Plan 7.4 — Internal scheduling message delivery**
     - `schedule_delivers_to_inbox`: recipient inbox receives correct iTIP.
     - `schedule_delivery_content_type`: correct iCalendar scheduling media type.
     - `schedule_delivery_failure_atomicity`: failure does not corrupt event state.

5. **Plan 7.5 — (Future) iMIP gateway**
     - `imip_outbound_formats_mail`: outbound email formatting contract.
     - `imip_inbound_reply_maps_to_itip`: inbound reply updates event appropriately.

### Phase 8: Authorization Integration

**Goal**: Enforce ACL throughout.

1. Integrate Casbin checks into all handlers
2. Implement privilege discovery properties
    - `DAV:current-user-privilege-set`, `DAV:acl`, `DAV:principal-collection-set`, and related ACL properties expected by WebDAV ACL clients
3. Implement shared calendar/addressbook support
4. Implement `read-free-busy` privilege


**Deliverables**:
- Authorization middleware
- ACL property handlers

#### Phase 8 Testing Notes

1. **Plan 8.1 — Integrate Casbin checks into all handlers**
     - Permission matrix (table-driven tests)
         - `auth_matrix_collection_methods`: for each role, assert allowed/denied for PROPFIND/REPORT/PROPPATCH/MKCOL/etc.
         - `auth_matrix_item_methods`: for each role, assert allowed/denied for GET/PUT/DELETE.
     - Additivity rule
         - `auth_additive_collection_grant_applies_to_item`: granting at collection gives same-or-higher on item.
         - `auth_no_lower_item_than_collection`: an explicit lower item grant cannot reduce effective permission.
     - Public principal behavior
         - `auth_public_read_ics_only`: public `.ics` access respects policy.
         - `auth_public_denied_on_private`: public denied where not shared.

2. **Plan 8.2 — Privilege discovery properties**
     - Consistency between PROPFIND and enforcement
         - `acl_current_user_privilege_set_matches_auth`: privileges returned match what endpoints actually permit.
         - `acl_acl_property_visibility`: ACL property returned only when allowed.
     - Authentication vs authorization
         - `acl_unauthenticated_401`: unauthenticated yields 401.
         - `acl_unauthorized_403`: authenticated but denied yields 403.

3. **Plan 8.3 — Shared calendar/addressbook support**
     - Share creation ceilings
         - `share_read_share_can_grant_read_only`: read-share ceiling enforced.
         - `share_edit_share_can_grant_edit_or_lower`: edit-share ceiling enforced.
         - `share_admin_can_grant_admin_or_lower`: admin ceiling enforced.
     - Propagation via containment
         - `share_collection_grant_applies_to_members`: members inherit effective access.
         - `share_revocation_removes_member_access`: revocation removes effective access.

4. **Plan 8.4 — `read-free-busy` privilege**
     - `auth_freebusy_allowed_read_freebusy`: freebusy allowed.
     - `auth_freebusy_denied_read`: ensure below read-freebusy denied.
     - `auth_freebusy_no_event_leak`: ensure no event payload leaks.

### Phase 9: Discovery & Polish

**Goal**: Complete client compatibility.

1. Implement well-known URI handling
2. Implement principal properties
3. Add Apple/Google client compatibility fixes
4. Performance optimization
5. Comprehensive integration tests

**Deliverables**:
- Production-ready CalDAV/CardDAV server

#### Phase 9 Testing Notes

1. **Plan 9.1 — Well-known URI handling**
     - `wellknown_caldav_redirect`: correct status and `Location` header.
     - `wellknown_carddav_redirect`: correct status and `Location` header.
     - `wellknown_methods_allowed`: OPTIONS/GET behavior is consistent with your routing.

2. **Plan 9.2 — Principal properties**
     - End-to-end discovery flow
         - `discovery_current_user_principal`: returns a usable principal URL.
         - `discovery_home_set_caldav`: returns calendar-home-set.
         - `discovery_home_set_carddav`: returns addressbook-home-set.
         - `discovery_list_collections_depth1`: client can list calendars/addressbooks.
     - Expand-property discovery
         - `discovery_expand_property_flow`: same discovery works via expand-property.

3. **Plan 9.3 — Apple/Google client compatibility fixes**
     - “Quirk suite” regression tests
         - `quirk_replay_ios_propfind`: replay captured iOS/macOS discovery request.
         - `quirk_replay_ios_report`: replay iOS REPORT request.
         - `quirk_replay_google_sync_polling`: replay token polling patterns.
     - Contract
         - Every quirk fix adds at least one replay test that fails before and passes after.

4. **Plan 9.4 — Performance optimization**
     - Budget/regression tests
         - `perf_report_budget_calendar_query`: calendar-query stays under your target budget on sample dataset.
         - `perf_sync_budget`: sync-collection stays under budget.
     - N+1 protection
         - `perf_no_n_plus_one_on_report`: assert bounded query counts for key endpoints.

5. **Plan 9.5 — Comprehensive integration tests**
     - End-to-end scenario suite
         - `e2e_create_calendar_put_event_query_sync`: create calendar, PUT event, REPORT query, sync.
         - `e2e_create_addressbook_put_vcard_query_sync`: same for CardDAV.
         - `e2e_acl_enforcement_matrix_smoke`: a small matrix smoke test across roles.
     - Failure-path suite
         - `e2e_invalid_calendar_data_errors`: invalid iCal yields correct error.
         - `e2e_invalid_address_data_errors`: invalid vCard yields correct error.
         - `e2e_unsupported_report_error`: unsupported REPORT yields correct error.
         - `e2e_unsupported_filter_error`: unsupported filter yields correct precondition.
         - `e2e_unsupported_collation_error`: unsupported collation yields correct precondition.

---

## 17. RFC-by-RFC Coverage Checklist

This section is a “one-by-one” sanity checklist against the major RFCs that matter for interoperability. Each item points to the exact guide section(s) that describe the behavior and the phase(s) that implement it.

### RFC 4918 — WebDAV

- **Core methods**: `OPTIONS`, `PROPFIND`, `PROPPATCH`, `GET`, `HEAD`, `PUT`, `DELETE`, `COPY`, `MOVE`, `MKCOL` (Guide: [5.1 Method Routing](#51-method-routing), [5.7 PROPPATCH Handling](#57-proppatch-handling), [5.9 COPY and MOVE Handling](#59-copy-and-move-handling); Plan: Phase 3).
- **Collections vs resources**: correct `DAV:resourcetype`, `DAV:collection` semantics, and consistent `href` handling (Guide: [5.3 PROPFIND Handling](#53-propfind-handling); Plan: Phase 3).
- **Multi-Status correctness**: `207 Multi-Status`, per-resource `propstat`, accurate `status` per property (Guide: [5.3 PROPFIND Handling](#53-propfind-handling), [15.1 DAV Error Response Format](#151-dav-error-response-format); Plan: Phase 3).
- **Depth handling**: support `Depth: 0` and `Depth: 1`; explicitly document/implement behavior for `infinity` (Guide: [5.3 PROPFIND Handling](#53-propfind-handling); Plan: Phase 3).
- **ETags and conditional requests**: strong ETags; `If-Match` / `If-None-Match: *` semantics for optimistic locking and safe create (Guide: [5.4 PUT Handling](#54-put-handling), [7.3 ETag Handling](#73-etag-handling); Plan: Phase 3).

### RFC 3253 — WebDAV Versioning (REPORT framework)

- **REPORT method**: parse/dispatch REPORT bodies; return proper errors on unknown/unsupported reports (Guide: [6. REPORT Operations](#6-report-operations); Plan: Phase 4).
- **`DAV:supported-report-set`**: advertise supported reports per collection/resource type and keep it consistent with what REPORT handlers exist (Guide: [5.3 PROPFIND Handling](#53-propfind-handling); Plan: Phase 3 + Phase 4).
- **`DAV:expand-property` report**: required by CardDAV clients for common discovery paths (Guide: [6.6 DAV expand-property Report](#66-dav-expand-property-report-rfc-3253-38); Plan: Phase 4).

### RFC 3744 — WebDAV ACL

- **Privileges**: enforce read/write/owner-like permissions consistently across WebDAV and DAV-specific operations (Guide: [12.1 WebDAV ACL](#121-webdav-acl-rfc-3744), [12.3 Shuriken ACL Model](#123-shuriken-acl-model); Plan: Phase 8).
- **Discovery properties**: return `DAV:current-user-privilege-set` and related ACL discovery properties so clients can determine what UI/actions to enable (Guide: [12.4 ACL Discovery Properties](#124-acl-discovery-properties), [5.3 PROPFIND Handling](#53-propfind-handling); Plan: Phase 8).
- **401 vs 403 discipline**: authentication failures vs authorization failures, and consistent behavior across methods (Guide: [15.2 Status Codes](#152-status-codes), [12. Authorization & Access Control](#12-authorization--access-control); Plan: Phase 3 + Phase 8).

### RFC 4791 — CalDAV

- **Discovery**: `CALDAV:calendar-home-set` and calendar collection properties used by clients (Guide: [5.3 PROPFIND Handling](#53-propfind-handling), [13.2 Principal Discovery](#132-principal-discovery); Plan: Phase 3).
- **Calendar object semantics**: one iCalendar object per resource; enforce UID rules and preconditions (`no-uid-conflict`, etc.) (Guide: [2. Data Formats](#2-data-formats), [5.4 PUT Handling](#54-put-handling), [15.3 Precondition Elements](#153-precondition-elements); Plan: Phase 1 + Phase 3).
- **Required REPORTs**: `calendar-query`, `calendar-multiget`, `free-busy-query` (Guide: [6.1 CALDAV:calendar-query](#61-caldavcalendar-query-rfc-4791-78), [6.2 CALDAV:calendar-multiget](#62-caldavcalendar-multiget-rfc-4791-79), [6.5 CALDAV:free-busy-query](#65-caldavfree-busy-query-rfc-4791-710), [10. Free-Busy Queries](#10-free-busy-queries); Plan: Phase 4 + Phase 7).
- **MKCALENDAR**: support calendar creation (SHOULD) and property setting at create time (Guide: [5.6 MKCALENDAR Handling](#56-mkcalendar-handling-rfc-4791-531); Plan: Phase 3).
- **Filter behavior**: time-range filtering + recurrence interaction; return `supported-filter` when you intentionally do not implement a filter feature (Guide: [6.1 CALDAV:calendar-query](#61-caldavcalendar-query-rfc-4791-78), [8.4 Time-Range Query with Recurrence](#84-time-range-query-with-recurrence), [15.3 Precondition Elements](#153-precondition-elements); Plan: Phase 4 + Phase 5).

### RFC 5545 — iCalendar

- **Parsing/serialization correctness**: unfolding/folding, parameter quoting/escaping, and deterministic serialization for stable ETags (Guide: [3. Parsing & Deserialization](#3-parsing--deserialization), [4. Serialization](#4-serialization); Plan: Phase 1).
- **Validation semantics**: enforce required properties (e.g., VEVENT `DTSTART`), handle overrides (`RECURRENCE-ID`), and keep UID stable (Guide: [3. Parsing & Deserialization](#3-parsing--deserialization), [5.4 PUT Handling](#54-put-handling); Plan: Phase 1 + Phase 3).
- **Recurrence expansion**: RRULE/RDATE/EXDATE correctness and limits (`max-instances`) (Guide: [8. Recurrence Expansion](#8-recurrence-expansion), [8.1 RRULE Evaluation Algorithm](#81-rrule-evaluation-algorithm-rfc-5545-3310); Plan: Phase 5).

### RFC 7986 — iCalendar Extensions

- **Non-fatal extension handling**: preserve unknown `X-` and IANA-registered properties/params without dropping them (Guide: [3. Parsing & Deserialization](#3-parsing--deserialization), [4. Serialization](#4-serialization); Plan: Phase 1).
- **Common modern fields**: round-trip `COLOR`, `REFRESH-INTERVAL`, `SOURCE`, etc., since clients use them even when servers don’t “understand” them (Guide: [3. Parsing & Deserialization](#3-parsing--deserialization); Plan: Phase 1).

### RFC 6578 — WebDAV Sync

- **`DAV:sync-token`**: expose on sync-enabled collections; document how clients discover and cache it (Guide: [7.1 WebDAV Sync](#71-webdav-sync-rfc-6578), [5.3 PROPFIND Handling](#53-propfind-handling); Plan: Phase 6).
- **`sync-collection` REPORT**: token validation, incremental change listing, tombstones, and new token issuance (Guide: [7.1 WebDAV Sync](#71-webdav-sync-rfc-6578); Plan: Phase 6).
- **Change accounting**: ensure every mutating operation bumps the collection token and produces correct tombstones for deletes (Guide: [5.5 DELETE Handling](#55-delete-handling), [7.1 WebDAV Sync](#71-webdav-sync-rfc-6578); Plan: Phase 2 + Phase 3 + Phase 6).

### RFC 6352 — CardDAV

- **Discovery**: `CARDDAV:addressbook-home-set`, `CARDDAV:supported-address-data`, and addressbook collection constraints (Guide: [1.2 CardDAV](#12-carddav-rfc-6352), [5.3 PROPFIND Handling](#53-propfind-handling), [13.2 Principal Discovery](#132-principal-discovery); Plan: Phase 3).
- **Required REPORTs**: `addressbook-query` and `addressbook-multiget` (Guide: [6.3 CARDDAV:addressbook-query](#63-carddavaddressbook-query-rfc-6352-86), [6.4 CARDDAV:addressbook-multiget](#64-carddavaddressbook-multiget-rfc-6352-87); Plan: Phase 4).
- **UID uniqueness + `no-uid-conflict`**: enforce UID constraints on create/update and return the correct precondition XML on conflicts (Guide: [5.4 PUT Handling](#54-put-handling), [15.3 Precondition Elements](#153-precondition-elements); Plan: Phase 3).
- **Query behavior**: implement property filters + text matching, and return `supported-filter` / `supported-collation` when you intentionally do not support a feature (Guide: [6.3 CARDDAV:addressbook-query](#63-carddavaddressbook-query-rfc-6352-86), [15.3 Precondition Elements](#153-precondition-elements); Plan: Phase 4).
- **`DAV:expand-property`**: required for client discovery flows (Guide: [6.6 DAV expand-property Report](#66-dav-expand-property-report-rfc-3253-38); Plan: Phase 4).
- **Extended MKCOL**: accept Extended MKCOL bodies to create address books with initial properties (Guide: [5.8 Extended MKCOL for Address Books](#58-extended-mkcol-for-address-books-rfc-5689); Plan: Phase 3).

### RFC 6350 — vCard 4.0 (plus vCard 3 interoperability)

- **Media type/version support**: MUST support vCard 3.0 for CardDAV interop; SHOULD support vCard 4.0; be explicit about which you store/emit (Guide: [1.2 CardDAV](#12-carddav-rfc-6352), [2. Data Formats](#2-data-formats), [3. Parsing & Deserialization](#3-parsing--deserialization); Plan: Phase 1 + Phase 3).
- **Round-trip safety**: preserve unknown properties/params; handle line folding/unfolding and escaping correctly (Guide: [3. Parsing & Deserialization](#3-parsing--deserialization), [4. Serialization](#4-serialization); Plan: Phase 1).
- **Timestamp/value rules**: accept truncation where allowed and normalize output for stable ETags when possible (Guide: [3. Parsing & Deserialization](#3-parsing--deserialization), [4. Serialization](#4-serialization), [5.4 PUT Handling](#54-put-handling); Plan: Phase 1 + Phase 3).

### RFC 6868 — Parameter Value Encoding

- **Caret encoding**: handle `^n`, `^'`, and `^^` in parameter values (Guide: [3. Parsing & Deserialization](#3-parsing--deserialization); Plan: Phase 1).

### RFC 5689 — Extended MKCOL

- **Address book creation**: accept Extended MKCOL bodies and apply `displayname`/`addressbook-description` at creation time (Guide: [5.8 Extended MKCOL for Address Books](#58-extended-mkcol-for-address-books-rfc-5689); Plan: Phase 3).

### RFC 6764 / RFC 5785 — Service Discovery / Well-Known URIs

- **`/.well-known/caldav` and `/.well-known/carddav`**: implement redirects and/or direct responses in a way common clients accept (Guide: [13.1 Well-Known URIs](#131-well-known-uris-rfc-6764); Plan: Phase 9).
- **Consistent principal discovery**: ensure well-known ultimately leads clients to `current-user-principal` and home sets reliably (Guide: [13.2 Principal Discovery](#132-principal-discovery), [5.3 PROPFIND Handling](#53-propfind-handling); Plan: Phase 9 + Phase 3).

## References

### Core Specifications

- **RFC 4791** — Calendaring Extensions to WebDAV (CalDAV)
- **RFC 6352** — vCard Extensions to WebDAV (CardDAV)
- **RFC 5545** — Internet Calendaring and Scheduling Core Object Specification (iCalendar)
- **RFC 6350** — vCard Format Specification (vCard 4.0)
- **RFC 4918** — HTTP Extensions for Web Distributed Authoring and Versioning (WebDAV)
- **RFC 3744** — Web Distributed Authoring and Versioning (WebDAV) Access Control Protocol

### Scheduling & Extensions

- **RFC 6638** — Scheduling Extensions to CalDAV
- **RFC 5546** — iCalendar Transport-Independent Interoperability Protocol (iTIP)
- **RFC 6047** — iCalendar Message-Based Interoperability Protocol (iMIP)
- **RFC 5689** — Extended MKCOL for WebDAV
- **RFC 6578** — Collection Synchronization for WebDAV

### Discovery

- **RFC 6764** — Locating Services for CalDAV and CardDAV
- **RFC 5785** — Defining Well-Known Uniform Resource Identifiers

### iCalendar Extensions

- **RFC 7529** — Non-Gregorian Recurrence Rules in iCalendar
- **RFC 7809** — Calendaring Extensions to WebDAV (CalDAV): Time Zones by Reference
- **RFC 7953** — Calendar Availability
- **RFC 7986** — New Properties for iCalendar
- **RFC 9073** — Event Publishing Extensions to iCalendar
- **RFC 9074** — VALARM Extensions for iCalendar
- **RFC 9253** — Support for iCalendar Relationships

### vCard Extensions

- **RFC 6868** — Parameter Value Encoding in iCalendar and vCard
- **RFC 9554** — vCard Format Extensions for JSContact

### Encoding

- **RFC 4790** — Internet Application Protocol Collation Registry
- **RFC 5051** — i;unicode-casemap Collation

---

## 18. Implementation Status (As of 2026-01-25)

**Note**: For a comprehensive audit with detailed RFC compliance analysis, see [Implementation-Status.md](./Implementation-Status.md).

### Quick Status Overview

| Phase | Status | Completion | Key Items |
|-------|--------|------------|-----------|
| **Phase 0**: Database Schema | ✅ **Complete** | 100% | All tables created, UUID v7 PKs, soft deletes |
| **Phase 1**: Core Parsing & Serialization | ✅ **Complete** | 98% | iCalendar, vCard, WebDAV XML parsers/serializers |
| **Phase 2**: Database Operations | ⚠️ **Mostly Complete** | 85% | Entity/instance CRUD; **Missing**: `cal_occurrence` table, RRULE expansion |
| **Phase 3**: Basic HTTP Methods | ⚠️ **Mostly Complete** | 90% | OPTIONS, PROPFIND, GET, PUT, DELETE, COPY working; **Missing**: MOVE, MKCALENDAR/MKCOL body parsing |
| **Phase 4**: Query Reports | ✅ **Complete** | 95% | calendar-query, calendar-multiget, addressbook-query, addressbook-multiget; **Stub**: expand-property |
| **Phase 5**: Recurrence & Time Zones | ❌ **Not Implemented** | 0% | **CRITICAL BLOCKER**: No RRULE expansion, no timezone handling |
| **Phase 6**: Synchronization | ❌ **Stub Only** | 10% | sync-collection stub, no incremental sync logic |
| **Phase 7**: Free-Busy & Scheduling | ❌ **Not Started** | 0% | No free-busy, no scheduling collections |
| **Phase 8**: Authorization Integration | ⚠️ **Partial** | 40% | Casbin enforcer integrated; **Missing**: ACL discovery properties |
| **Phase 9**: Discovery & Polish | ❌ **Not Started** | 0% | No well-known URIs, no principal discovery |

### Critical Blockers for Production Use

**Phase 5 is a CRITICAL BLOCKER** for production CalDAV. Without recurrence expansion:
- Recurring events do not work at all
- Time-range queries fail for recurring events
- Clients cannot properly display recurring calendar entries

**Required to unblock**:
1. Create `cal_occurrence` table migration
2. Implement RRULE expansion engine (use existing Rust crate like `rrule`)
3. Implement VTIMEZONE parsing and UTC conversion
4. Wire expansion into PUT handler and calendar-query report
5. Add recurrence-id matching for exception handling

**Estimated effort**: 2-3 weeks for full Phase 5 implementation.

### Next Priorities After Phase 5

1. **Phase 6: Synchronization** — Enable efficient incremental sync
2. **Phase 9: Discovery** — Well-known URIs and principal discovery for auto-configuration
3. **Phase 3 Completion** — Finish MOVE, MKCALENDAR, MKCOL
4. **Phase 4 Completion** — Implement expand-property report
5. **Phase 7: Free-Busy** — Support availability queries
6. **Phase 8: ACL Properties** — Expose current-user-privilege-set for better UX
7. **Phase 7: Scheduling** — iTIP message handling

### Test Coverage Status

**Strong**:
- ✅ Parser/serializer unit tests (120+ tests)
- ✅ PUT integration tests (20+ tests)
- ✅ PROPFIND integration tests (8 tests)

**Weak**:
- ⚠️ Report integration tests (none yet)
- ⚠️ Authorization matrix tests (none yet)
- ⚠️ Database transaction tests (limited)

**Missing**:
- ❌ Recurrence expansion tests (not implemented)
- ❌ Timezone conversion tests (not implemented)
- ❌ Sync-collection tests (not implemented)
- ❌ End-to-end discovery flow tests (not implemented)

### RFC Compliance Summary

**Fully Compliant**: RFC 5545 (iCalendar), RFC 6350 (vCard), RFC 6352 (CardDAV queries)

**Partially Compliant**: RFC 4791 (CalDAV - missing recurrence), RFC 6578 (WebDAV Sync - stub only), RFC 3744 (WebDAV ACL - missing discovery)

**Not Compliant**: RFC 6638 (Scheduling), RFC 5546 (iTIP), RFC 6764 (Service Discovery)

See [Implementation-Status.md](./Implementation-Status.md) for detailed RFC-by-RFC compliance analysis.
