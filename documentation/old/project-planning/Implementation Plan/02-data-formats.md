# 2. Data Formats

## 2.1 iCalendar (RFC 5545)

### 2.1.1 Content Line Grammar

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

### 2.1.2 Component Hierarchy

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

### 2.1.3 Value Types

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

### 2.1.4 Text Escaping

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

### 2.1.5 DATE-TIME Forms (RFC 5545 §3.3.5)

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

### 2.1.6 Recurrence Rules (RRULE) — RFC 5545 §3.3.10

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

### 2.1.7 VALARM Component

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

### 2.1.8 Extended Properties (RFC 7986)

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

### 2.1.9 Client Compatibility & Provider Quirks

#### Apple Calendar (macOS/iOS)

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

#### Google Calendar

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

#### Microsoft Outlook/Exchange

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

#### General Interoperability Guidelines

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

#### DAVx5 (Android)

| Behavior | Notes |
|----------|-------|
| Collection discovery | Commonly does a Depth: 1 PROPFIND on home-sets and expects `DAV:resourcetype`, `DAV:displayname`, and `DAV:getetag` consistently |
| Sync behavior | Uses `DAV:sync-token` when present; otherwise falls back to listing + multiget patterns |

#### Thunderbird (Calendar clients)

| Behavior | Notes |
|----------|-------|
| Strict XML parsing | Less forgiving of malformed XML namespaces/prefixes in PROPFIND/REPORT responses |
| ETag reliance | Relies heavily on `DAV:getetag` plus `If-Match`; weak/unstable ETags cause noisy resyncs |

## 2.2 vCard (RFC 6350)

### 2.2.1 vCard 4.0 Structure

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

### 2.2.2 Property Cardinality Notation

| Symbol | Meaning |
|--------|---------|
| 1 | Exactly one instance MUST be present |
| *1 | At most one instance MAY be present |
| 1* | One or more instances MUST be present |
| * | Zero or more instances MAY be present |

### 2.2.3 Complete Property Reference

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

### 2.2.4 Value Types (RFC 6350 §4)

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

### 2.2.5 Value Escaping (RFC 6350 §3.4)

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

### 2.2.6 Parameters (RFC 6350 §5)

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

### 2.2.7 KIND Property Values

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

### 2.2.8 TEL TYPE Values

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

### 2.2.9 RELATED TYPE Values

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

### 2.2.10 Client Compatibility & Provider Quirks

#### Apple Contacts (macOS/iOS)

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

#### Google Contacts

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

#### Microsoft Outlook/Exchange

| Behavior | Notes |
|----------|-------|
| **vCard version** | Primarily vCard 2.1, limited 3.0/4.0 support |
| **X-MS-* properties** | Various proprietary extensions |
| **PHOTO encoding** | Often uses ENCODING=B (vCard 2.1 style) |
| **Character encoding** | May use CHARSET parameter (deprecated in 4.0) |
| **ADR format** | May not preserve all 7 components |
| **Line folding** | Older versions may break UTF-8 |
| **TYPE values** | May use non-standard TYPE values |

#### General Interoperability Guidelines

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

#### DAVx5 (Android)

| Behavior | Notes |
|----------|-------|
| Group prefixes | Preserves `itemX.` group prefixes; losing them can break label associations in some contact apps |
| Photo payloads | Stable ETags matter for PHOTO-heavy address books to avoid repeated downloads |

#### Thunderbird (Address Book clients)

| Behavior | Notes |
|----------|-------|
| Partial retrieval | Often requests a limited set of properties via `CARDDAV:address-data`; ensure server honors partial retrieval |
| Filter support | Expects `CARDDAV:supported-filter` errors for unsupported filters rather than silently returning empty results |

---
