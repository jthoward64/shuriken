# Types Reference

Compiled from RFC specifications relevant to CalDAV, CardDAV, WebDAV, iCalendar, and vCard.

---

## RFC 2739 — Calendar Attributes for vCard and LDAP

### vCard Property Types
| Property | Value Type | Notes |
|---|---|---|
| `FBURL` | URI | Points to user's free/busy time (iCalendar VFREEBUSY). File ext: `.ifb` |
| `CALADRURI` | URI | Address to send event requests to (e.g. `mailto:`) |
| `CAPURI` | URI | Protocol-independent calendar access location |
| `CALURI` | URI | Points to snapshot of user's calendar (iCalendar). File ext: `.ics` |

All four support the `PREF` parameter to indicate default. Encoding: 8bit.

### LDAP Attribute Types (calEntry object class)
| Attribute | Syntax | Cardinality |
|---|---|---|
| `calCalURI` | IA5String | single-value |
| `calFBURL` | IA5String | single-value |
| `calCAPURI` | IA5String | single-value |
| `calCalAdrURI` | IA5String | single-value |
| `calOtherCalURIs` | IA5String | multi-value |
| `calOtherFBURLs` | IA5String | multi-value |
| `calOtherCAPURIs` | IA5String | multi-value |
| `calOtherCalAdrURIs` | IA5String | multi-value |

### File Formats / MIME Types
- `text/calendar` — iCalendar MIME body part
- `.ics` — iCalendar file extension
- `.ifb` — free/busy iCalendar file extension

---

## RFC 3253 — Versioning Extensions to WebDAV (DeltaV)

### DAV Property Types
| Property | Value Type | Notes |
|---|---|---|
| `DAV:comment` | text | Human-readable string |
| `DAV:creator-displayname` | text | Human-readable string |
| `DAV:checked-in` | `DAV:href` | URI to version resource (protected) |
| `DAV:checked-out` | `DAV:href` | URI to version resource (protected) |
| `DAV:auto-version` | enumerated | See values below |
| `DAV:predecessor-set` | set of `DAV:href` | Set of predecessor version URIs |
| `DAV:successor-set` | set of `DAV:href` | Computed set of successor version URIs |
| `DAV:checkout-set` | set of `DAV:href` | Computed |
| `DAV:version-name` | string | Server-assigned version name (protected) |
| `DAV:label-name-set` | set of strings | Label names (protected) |
| `DAV:unreserved` | boolean | Whether checkout is unreserved |
| `DAV:version-set` | set of `DAV:href` | All versions in history (protected) |
| `DAV:root-version` | `DAV:href` | Computed |
| `DAV:version-history` | `DAV:href` | Computed |
| `DAV:merge-set` | set of `DAV:href` | |
| `DAV:auto-merge-set` | set of `DAV:href` | |
| `DAV:activity-set` | set of `DAV:href` | |
| `DAV:subactivity-set` | set of `DAV:href` | |
| `DAV:workspace` | `DAV:href` | Protected |
| `DAV:baseline-collection` | `DAV:href` | Protected |

### DAV:auto-version Enumerated Values
- `DAV:checkout-checkin`
- `DAV:checkout-unlocked-checkin`
- `DAV:checkout`
- `DAV:locked-checkout`

### HTTP Methods (new in this RFC)
`VERSION-CONTROL`, `CHECKOUT`, `CHECKIN`, `UNCHECKOUT`, `MKWORKSPACE`, `UPDATE`, `LABEL`, `MKACTIVITY`, `MERGE`, `BASELINE-CONTROL`, `REPORT`

### Primitive Types
- **Boolean** — used for `DAV:unreserved`
- **`DAV:href`** — XML element containing a URI (from RFC 2518)
- **String** — for `DAV:version-name`, `DAV:label-name-set`

---

## RFC 3744 — WebDAV Access Control Protocol (ACL)

### Principal XML Types
| Element | Content Model | Notes |
|---|---|---|
| `DAV:principal` | EMPTY | Resource type marker |
| `DAV:alternate-URI-set` | `(href*)` | Additional URIs for principal |
| `DAV:principal-URL` | `(href)` | Canonical principal URL |
| `DAV:group-member-set` | `(href*)` | Direct group members |
| `DAV:group-membership` | `(href*)` | Groups this principal belongs to (protected) |

### Access Control Properties
| Property/Element | Content Model | Notes |
|---|---|---|
| `DAV:owner` | `(href?)` | Resource owner |
| `DAV:group` | `(href?)` | Resource group |
| `DAV:supported-privilege-set` | `(supported-privilege*)` | Protected |
| `DAV:current-user-privilege-set` | `(privilege*)` | |
| `DAV:acl` | `(ace*)` | Access control list |
| `DAV:acl-restrictions` | see below | Constraints on ACL |
| `DAV:inherited-acl-set` | `(href*)` | |
| `DAV:principal-collection-set` | `(href*)` | |

### ACE Structure
```
ace = (principal | invert), (grant | deny), protected?, inherited?
principal = href | all | authenticated | unauthenticated | property | self
grant = (privilege+)
deny = (privilege+)
```

### Privilege Types (DAV namespace, all EMPTY elements)
`read`, `write`, `write-properties`, `write-content`, `unlock`, `read-acl`, `read-current-user-privilege-set`, `write-acl`, `bind`, `unbind`, `all`

### Pseudo-Principal Types
- `DAV:all` — matches every principal
- `DAV:authenticated` — any authenticated principal
- `DAV:unauthenticated` — any unauthenticated principal
- `DAV:self` — the principal of the resource itself

### HTTP Method
`ACL`

---

## RFC 4790 — Internet Application Protocol Collation Registry

### Collation Identifier Syntax (ABNF)
```
collation-id    = collation-prefix ";" collation-core-name *collation-arg
collation-char  = ALPHA / DIGIT / "-" / ";" / "=" / "."
collation-core-name = ALPHA *( ALPHA / DIGIT / "-" )
collation-arg   = ";" ALPHA *( ALPHA / DIGIT ) "=" 1*( ALPHA / DIGIT / "." )
```
Max length: 254 characters. Wildcards (`*`) are supported in client requests.

### Collation URI
```
http://www.iana.org/assignments/collation/<collation-id>.xml
```

### Registered Collations
| Identifier | Operations | Input Type | Notes |
|---|---|---|---|
| `i;ascii-numeric` | equality, ordering | unsigned decimal integer strings | Strings not starting with digit = +∞ |
| `i;ascii-casemap` | equality, substring, ordering | octet strings | Case-insensitive for ASCII a-z only |
| `i;octet` | equality, substring, ordering | octet strings | Byte-by-byte comparison |

### Collation Registration XML Format
XML document with root `<collation>` element containing: `<identifier>`, `<title>`, `<operations>`, `<specification>`, `<owner>`, optionally `<submitter>`, `<version>`, `<variable>`

---

## RFC 4791 — Calendaring Extensions to WebDAV (CalDAV)

**Namespace:** `urn:ietf:params:xml:ns:caldav`

**HTTP Method:** `MKCALENDAR`

**DAV Feature Token:** `calendar-access`

### Calendar Collection Properties
| Property | Element Definition | Value Type |
|---|---|---|
| `CALDAV:calendar-description` | `(#PCDATA)` | String (with `xml:lang`) |
| `CALDAV:calendar-timezone` | `(#PCDATA)` | iCalendar object with exactly one `VTIMEZONE` component |
| `CALDAV:supported-calendar-component-set` | `(comp+)` | List of component names (e.g. `VEVENT`, `VTODO`) |
| `CALDAV:supported-calendar-data` | `(calendar-data+)` | Supported MIME types (e.g. `text/calendar` v2.0) |
| `CALDAV:max-resource-size` | `(#PCDATA)` | Positive integer (octets) |
| `CALDAV:min-date-time` | `(#PCDATA)` | iCalendar DATE-TIME in UTC (e.g. `19000101T000000Z`) |
| `CALDAV:max-date-time` | `(#PCDATA)` | iCalendar DATE-TIME in UTC |
| `CALDAV:max-instances` | `(#PCDATA)` | Positive integer |
| `CALDAV:max-attendees-per-instance` | `(#PCDATA)` | Positive integer |
| `CALDAV:supported-collation-set` | `(supported-collation*)` | List of collation identifiers |
| `CALDAV:calendar-home-set` | `(DAV:href*)` | Principal property; set of URIs to calendar homes |

### Calendar Query/Report XML Elements
| Element | Definition | Notes |
|---|---|---|
| `CALDAV:calendar-query` | `((allprop\|propname\|prop)?, filter, timezone?)` | REPORT request |
| `CALDAV:calendar-multiget` | `((allprop\|propname\|prop)?, DAV:href+)` | REPORT for specific URLs |
| `CALDAV:free-busy-query` | `(time-range)` | REPORT for free/busy |
| `CALDAV:calendar-data` | See notes | In requests: `(comp?, (expand\|limit-recurrence-set)?, limit-freebusy-set?)`; in responses: `(#PCDATA)` iCalendar object |
| `CALDAV:filter` | `(comp-filter)` | Query filter wrapper |
| `CALDAV:comp-filter` | `(is-not-defined \| (time-range?, prop-filter*, comp-filter*))` | `name` attr = component type |
| `CALDAV:prop-filter` | `(is-not-defined \| ((time-range\|text-match)?, param-filter*))` | `name` attr = property name |
| `CALDAV:param-filter` | `(is-not-defined \| text-match?)` | `name` attr = parameter name |
| `CALDAV:text-match` | `(#PCDATA)` | String; attrs: `collation` (default `i;ascii-casemap`), `negate-condition` (yes\|no) |
| `CALDAV:time-range` | EMPTY | Attrs: `start`, `end` — iCalendar "date with UTC time" |
| `CALDAV:expand` | EMPTY | Attrs: `start`, `end` — iCalendar "date with UTC time" |
| `CALDAV:limit-recurrence-set` | EMPTY | Attrs: `start`, `end` — iCalendar "date with UTC time" |
| `CALDAV:limit-freebusy-set` | EMPTY | Attrs: `start`, `end` — iCalendar "date with UTC time" |
| `CALDAV:timezone` | `(#PCDATA)` | iCalendar object with exactly one `VTIMEZONE` |
| `CALDAV:comp` | `((allprop\|prop*), (allcomp\|comp*))` | `name` attr = component name |
| `CALDAV:prop` | EMPTY | `name` attr = property name; `novalue` = yes\|no |

### Privilege
- `CALDAV:read-free-busy` — read only free/busy (no full event details)

### MIME Types
- `text/calendar` — CalDAV calendar object resource format
- `application/xml; charset="utf-8"` — request/response bodies

### Time Value Formats Used in CalDAV
- **iCalendar DATE-TIME in UTC** — e.g. `19971015T133000Z`
- **iCalendar DATE** — e.g. `19971015`
- **Date with local time (floating time)** — `19971015T133000` (no Z)

---

## RFC 4918 — Web Distributed Authoring and Versioning (WebDAV)

**Namespace:** `DAV:`

**HTTP Methods:** `PROPFIND`, `PROPPATCH`, `MKCOL`, `COPY`, `MOVE`, `LOCK`, `UNLOCK`

### Core DAV Properties
| Property | Element | Value Type |
|---|---|---|
| `DAV:creationdate` | `(#PCDATA)` | RFC 3339 date-time (ISO 8601) e.g. `1997-12-01T17:42:21-08:00` |
| `DAV:displayname` | `(#PCDATA)` | Any text |
| `DAV:getcontentlanguage` | `(#PCDATA)` | HTTP language-tag (RFC 2616 §3.10) |
| `DAV:getcontentlength` | `(#PCDATA)` | Integer (bytes) |
| `DAV:getcontenttype` | `(#PCDATA)` | MIME media-type (RFC 2616 §3.7) |
| `DAV:getetag` | `(#PCDATA)` | HTTP entity-tag (RFC 2616 §3.11) e.g. `"xyzzy"` or `W/"xyzzy"` |
| `DAV:getlastmodified` | `(#PCDATA)` | RFC 1123 date (HTTP-date) e.g. `Mon, 12 Jan 1998 09:25:56 GMT` |
| `DAV:lockdiscovery` | `(activelock)*` | |
| `DAV:resourcetype` | ANY | Child elements identify type; `DAV:collection` for collections |
| `DAV:supportedlock` | `(lockentry)*` | |

### DAV XML Elements
| Element | Content Model | Notes |
|---|---|---|
| `DAV:activelock` | `(lockscope, locktype, depth, owner?, timeout?, locktoken?, lockroot)` | |
| `DAV:depth` | `(#PCDATA)` | Value: `"0"` \| `"1"` \| `"infinity"` |
| `DAV:href` | `(#PCDATA)` | URI or relative reference |
| `DAV:lockscope` | `(exclusive \| shared)` | |
| `DAV:locktype` | `(write)` | Only `write` lock type defined |
| `DAV:locktoken` | `(href)` | Single lock token URI |
| `DAV:lockroot` | `(href)` | Root URL of lock |
| `DAV:lockentry` | `(lockscope, locktype)` | |
| `DAV:lockinfo` | `(lockscope, locktype, owner?)` | LOCK request body |
| `DAV:timeout` | `(#PCDATA)` | TimeType value |
| `DAV:owner` | ANY | Client-supplied lock creator info |
| `DAV:multistatus` | `(response*, responsedescription?)` | 207 response body |
| `DAV:response` | `(href, ((href*, status)\|(propstat+)), error?, responsedescription?, location?)` | |
| `DAV:propstat` | `(prop, status, error?, responsedescription?)` | |
| `DAV:status` | `(#PCDATA)` | HTTP status line e.g. `HTTP/1.1 200 OK` |
| `DAV:error` | ANY | Precondition/postcondition codes |
| `DAV:propfind` | `(propname \| (allprop, include?) \| prop)` | PROPFIND request body |
| `DAV:propertyupdate` | `(remove \| set)+` | PROPPATCH request body |
| `DAV:collection` | EMPTY | Marks resource as collection |

### HTTP Headers (WebDAV-specific)
| Header | Format | Notes |
|---|---|---|
| `Depth` | `"0" \| "1" \| "infinity"` | Request header |
| `Destination` | URI | Absolute URI |
| `Overwrite` | `"T" \| "F"` | Default "T" |
| `Timeout` | `1#TimeType` | `"Second-" DAVTimeOutVal \| "Infinite"` |
| `Lock-Token` | `Coded-URL` | `<urn:uuid:...>` format |
| `If` | conditional | Matches ETags and lock state tokens |
| `DAV` | compliance classes | e.g. `1, 2, access-control, calendar-access` |

### Lock Token Format
`urn:uuid:<UUID>` — e.g. `urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6`

### TimeType Format (ABNF)
```
TimeType = "Second-" DAVTimeOutVal | "Infinite"
DAVTimeOutVal = 1*DIGIT  (max 2^32-1)
```

### Status Codes (new in WebDAV)
- `207 Multi-Status`
- `422 Unprocessable Entity`
- `423 Locked`
- `424 Failed Dependency`
- `507 Insufficient Storage`

---

## RFC 5051 — i;unicode-casemap Collation

Adds one entry to the RFC 4790 collation registry:

| Identifier | Operations | Input Type | Notes |
|---|---|---|---|
| `i;unicode-casemap` | equality, substring, ordering | UTF-8 strings | Full Unicode case folding (preferred over `i;ascii-casemap`) |

---

## RFC 5545 — Internet Calendaring and Scheduling Core Object Specification (iCalendar)

**MIME Type:** `text/calendar`
**File Extension:** `.ics`
**Version:** `2.0`

### Content Line Format
```
contentline = name *(";" param) ":" value CRLF
name        = iana-token / x-name
```
Lines longer than 75 octets MUST be folded (wrapped with CRLF + whitespace).

### iCalendar Object Structure
```
VCALENDAR
├── PRODID (required, TEXT)
├── VERSION (required, TEXT, "2.0")
├── CALSCALE (optional, TEXT, default "GREGORIAN")
├── METHOD (optional, TEXT, IANA token)
└── Components: VEVENT | VTODO | VJOURNAL | VFREEBUSY | VTIMEZONE | VALARM
```

### Property Value Data Types (VALUE parameter)
| Value Type | Format | Example |
|---|---|---|
| `BINARY` | BASE64 encoded | Requires `ENCODING=BASE64` |
| `BOOLEAN` | `TRUE` / `FALSE` | Case-insensitive |
| `CAL-ADDRESS` | URI (typically `mailto:`) | `mailto:jane@example.com` |
| `DATE` | `YYYYMMDD` | `19970714` |
| `DATE-TIME` | `YYYYMMDDTHHMMSS` or `...Z` (UTC) | `19970714T133000Z` |
| `DURATION` | `[+/-]P[nW][nD][T[nH][nM][nS]]` | `P15DT5H0M20S`, `P7W` |
| `FLOAT` | `[+/-]1*DIGIT[.1*DIGIT]` | `1.333`, `-3.14` |
| `INTEGER` | `[+/-]1*DIGIT` | Range: -2147483648 to 2147483647 |
| `PERIOD` | `date-time/date-time` or `date-time/duration` | `19970101T180000Z/PT5H30M` |
| `RECUR` | `FREQ=...;KEY=value;...` | `FREQ=YEARLY;BYDAY=1SU;BYMONTH=4` |
| `TEXT` | String with BACKSLASH escaping | `\n`=newline, `\,`=comma, `\;`=semicolon |
| `TIME` | `HHMMSS[Z]` | `133000`, `133000Z` |
| `URI` | RFC 3986 URI | `http://example.com/report.txt` |
| `UTC-OFFSET` | `(+/-)HHMM[SS]` | `-0500`, `+0100` |

#### DATE-TIME Forms
1. **Local time (floating):** `19980118T230000` — no timezone
2. **UTC time:** `19980119T070000Z` — suffix `Z`
3. **Local + TZID:** `TZID=America/New_York:19980119T020000`

#### RECUR Parts
`FREQ` (required): `SECONDLY` | `MINUTELY` | `HOURLY` | `DAILY` | `WEEKLY` | `MONTHLY` | `YEARLY`
Optional: `UNTIL` (DATE/DATE-TIME), `COUNT` (integer), `INTERVAL` (integer), `BYSECOND`, `BYMINUTE`, `BYHOUR`, `BYDAY` (weekday), `BYMONTHDAY`, `BYYEARDAY`, `BYWEEKNO`, `BYMONTH`, `BYSETPOS`, `WKST`

Weekday values: `SU`, `MO`, `TU`, `WE`, `TH`, `FR`, `SA`

### Property Parameters
| Parameter | Format | Notes |
|---|---|---|
| `ALTREP` | `"uri"` | Alternate text representation URI |
| `CN` | text | Common name for CAL-ADDRESS |
| `CUTYPE` | `INDIVIDUAL`\|`GROUP`\|`RESOURCE`\|`ROOM`\|`UNKNOWN` | Calendar user type, default `INDIVIDUAL` |
| `DELEGATED-FROM` | `"cal-address",...` | Delegator addresses (quoted) |
| `DELEGATED-TO` | `"cal-address",...` | Delegatee addresses (quoted) |
| `DIR` | `"uri"` | Directory entry reference (quoted URI) |
| `ENCODING` | `8BIT`\|`BASE64` | Inline encoding, default `8BIT` |
| `FMTTYPE` | `type/subtype` | MIME media type |
| `FBTYPE` | `FREE`\|`BUSY`\|`BUSY-UNAVAILABLE`\|`BUSY-TENTATIVE` | Free/busy type, default `BUSY` |
| `LANGUAGE` | RFC 5646 language tag | e.g. `en-US` |
| `MEMBER` | `"cal-address",...` | Group memberships (quoted) |
| `PARTSTAT` | See below | Participation status |
| `RANGE` | `THISANDFUTURE` | Recurrence range |
| `RELATED` | `START`\|`END` | Alarm trigger relation, default `START` |
| `RELTYPE` | `PARENT`\|`CHILD`\|`SIBLING` | Relationship type, default `PARENT` |
| `ROLE` | `CHAIR`\|`REQ-PARTICIPANT`\|`OPT-PARTICIPANT`\|`NON-PARTICIPANT` | Participation role, default `REQ-PARTICIPANT` |
| `RSVP` | `TRUE`\|`FALSE` | RSVP expectation, default `FALSE` |
| `SENT-BY` | `"mailto:..."` | Acting-on-behalf address (quoted) |
| `TZID` | text (optionally `/`-prefixed) | Timezone identifier |
| `VALUE` | value type name | Explicit type override |

#### PARTSTAT Values
- VEVENT: `NEEDS-ACTION` (default), `ACCEPTED`, `DECLINED`, `TENTATIVE`, `DELEGATED`
- VTODO: above + `COMPLETED`, `IN-PROCESS`
- VJOURNAL: `NEEDS-ACTION` (default), `ACCEPTED`, `DECLINED`

### Calendar Components
| Component | Description |
|---|---|
| `VCALENDAR` | Root container |
| `VEVENT` | Event (meeting, appointment, etc.) |
| `VTODO` | To-do item |
| `VJOURNAL` | Journal entry |
| `VFREEBUSY` | Free/busy time information |
| `VTIMEZONE` | Timezone definition |
| `VALARM` | Alarm/reminder (nested inside VEVENT/VTODO) |
| `STANDARD` | Sub-component of VTIMEZONE |
| `DAYLIGHT` | Sub-component of VTIMEZONE |

### Component Properties and Value Types
| Property | Default Value Type | Alt Types | Components |
|---|---|---|---|
| `ATTACH` | URI | BINARY | VEVENT, VTODO, VJOURNAL, VALARM |
| `CATEGORIES` | TEXT | | VEVENT, VTODO, VJOURNAL |
| `CLASS` | TEXT | | VEVENT, VTODO, VJOURNAL |
| `COMMENT` | TEXT | | VEVENT, VTODO, VJOURNAL, VFREEBUSY, VTIMEZONE |
| `DESCRIPTION` | TEXT | | VEVENT, VTODO, VJOURNAL, VALARM |
| `GEO` | FLOAT (two semicolon-sep floats: lat;lon) | | VEVENT, VTODO |
| `LOCATION` | TEXT | | VEVENT, VTODO |
| `PERCENT-COMPLETE` | INTEGER (0-100) | | VTODO |
| `PRIORITY` | INTEGER (0=undefined, 1=highest, 9=lowest) | | VEVENT, VTODO |
| `RESOURCES` | TEXT | | VEVENT, VTODO |
| `STATUS` | TEXT (see below) | | VEVENT, VTODO, VJOURNAL |
| `SUMMARY` | TEXT | | VEVENT, VTODO, VJOURNAL, VALARM |
| `COMPLETED` | DATE-TIME | | VTODO |
| `DTEND` | DATE-TIME | DATE | VEVENT, VFREEBUSY |
| `DUE` | DATE-TIME | DATE | VTODO |
| `DTSTART` | DATE-TIME | DATE | VEVENT, VTODO, VJOURNAL, VFREEBUSY, VTIMEZONE/STANDARD/DAYLIGHT |
| `DURATION` | DURATION | | VEVENT, VTODO, VFREEBUSY, VALARM |
| `FREEBUSY` | PERIOD | | VFREEBUSY |
| `TRANSP` | TEXT (`OPAQUE`\|`TRANSPARENT`) | | VEVENT |
| `TZID` | TEXT | | VTIMEZONE |
| `TZNAME` | TEXT | | VTIMEZONE/STANDARD/DAYLIGHT |
| `TZOFFSETFROM` | UTC-OFFSET | | VTIMEZONE/STANDARD/DAYLIGHT |
| `TZOFFSETTO` | UTC-OFFSET | | VTIMEZONE/STANDARD/DAYLIGHT |
| `TZURL` | URI | | VTIMEZONE |
| `ATTENDEE` | CAL-ADDRESS | | VEVENT, VTODO, VJOURNAL, VFREEBUSY |
| `CONTACT` | TEXT | | VEVENT, VTODO, VJOURNAL, VFREEBUSY |
| `ORGANIZER` | CAL-ADDRESS | | VEVENT, VTODO, VJOURNAL, VFREEBUSY |
| `RECURRENCE-ID` | DATE-TIME | DATE | VEVENT, VTODO, VJOURNAL |
| `RELATED-TO` | TEXT | | VEVENT, VTODO, VJOURNAL |
| `URL` | URI | | VEVENT, VTODO, VJOURNAL, VFREEBUSY |
| `UID` | TEXT | | VEVENT, VTODO, VJOURNAL |
| `EXDATE` | DATE-TIME | DATE | VEVENT, VTODO, VJOURNAL |
| `RDATE` | DATE-TIME | DATE, PERIOD | VEVENT, VTODO, VJOURNAL, VTIMEZONE/STANDARD/DAYLIGHT |
| `RRULE` | RECUR | | VEVENT, VTODO, VJOURNAL, VTIMEZONE/STANDARD/DAYLIGHT |
| `ACTION` | TEXT (`AUDIO`\|`DISPLAY`\|`EMAIL`) | | VALARM |
| `REPEAT` | INTEGER | | VALARM |
| `TRIGGER` | DURATION | DATE-TIME | VALARM |
| `CREATED` | DATE-TIME | | VEVENT, VTODO, VJOURNAL |
| `DTSTAMP` | DATE-TIME | | VEVENT, VTODO, VJOURNAL, VFREEBUSY |
| `LAST-MODIFIED` | DATE-TIME | | VEVENT, VTODO, VJOURNAL, VTIMEZONE |
| `SEQUENCE` | INTEGER (default 0) | | VEVENT, VTODO, VJOURNAL |
| `REQUEST-STATUS` | TEXT | | All scheduling components |
| `CALSCALE` | TEXT (`GREGORIAN`) | | VCALENDAR |
| `METHOD` | TEXT (IANA token) | | VCALENDAR |
| `PRODID` | TEXT | | VCALENDAR |
| `VERSION` | TEXT (`2.0`) | | VCALENDAR |

#### CLASS Values
`PUBLIC` (default), `PRIVATE`, `CONFIDENTIAL`

#### STATUS Values
- VEVENT: `TENTATIVE`, `CONFIRMED`, `CANCELLED`
- VTODO: `NEEDS-ACTION`, `COMPLETED`, `IN-PROCESS`, `CANCELLED`
- VJOURNAL: `DRAFT`, `FINAL`, `CANCELLED`

---

## RFC 6350 — vCard Format Specification (Version 4.0)

**MIME Type:** `text/vcard`
**File Extension:** `.vcf` or `.vcard`
**Namespace:** none (plain text format)

### Value Types
| Type | Description | ABNF / Notes |
|---|---|---|
| `text` | UTF-8 text with backslash escaping (`\n`, `\,`, `\;`, `\\`) | Default for most properties |
| `uri` | URI as per RFC 3986 | e.g. `http:`, `mailto:`, `data:` |
| `date` | ISO 8601 date | `YYYY-MM-DD` or `YYYYMMDD`; `--MM-DD` (no year); `---DD` (day only) |
| `time` | ISO 8601 time | `HH[MM[SS]]` with optional UTC offset or Z |
| `date-time` | ISO 8601 combined | `YYYYMMDDTHHMMSS[Z]` |
| `date-and-or-time` | Union: date / time / date-time | Prefix time-only with `T` |
| `timestamp` | ISO 8601 UTC instant | `YYYYMMDDTHHMMSSZ` (preferred); local allowed |
| `boolean` | `TRUE` or `FALSE` | Case-insensitive |
| `integer` | 64-bit signed integer | Range: −9223372036854775808 to 9223372036854775807 |
| `float` | IEEE binary64 floating point | Decimal notation; multiple comma-separated for structured |
| `utc-offset` | UTC offset | `+HH[MM[SS]]` or `-HH[MM[SS]]` |
| `language-tag` | IETF BCP 47 tag | Per RFC 5646; e.g. `en`, `fr-CA` |

### Property Parameters
| Parameter | Value Type | Notes |
|---|---|---|
| `LANGUAGE` | language-tag | RFC 5646 language tag |
| `VALUE` | value-type keyword | Override default value type |
| `PREF` | integer 1–100 | 1 = highest preference |
| `ALTID` | opaque string | Groups alternate representations of same content |
| `PID` | integer or `integer.integer` | Property ID for sync (e.g. `1.1`) |
| `TYPE` | text | `work`, `home`, property-specific values |
| `MEDIATYPE` | MIME type | `type/subtype` (RFC 4288) |
| `CALSCALE` | `gregorian` | Calendar scale; only GREGORIAN registered |
| `SORT-AS` | comma-separated text | Alternate collation key values per component |
| `GEO` | quoted URI | `geo:` URI for property geographic context |
| `TZ` | param-value or quoted URI | Timezone name or TZID URI |

### Properties
| Property | Default Value Type | Alt Types | Notes |
|---|---|---|---|
| `BEGIN` | text | — | `VCARD`; marks start |
| `END` | text | — | `VCARD`; marks end |
| `VERSION` | text | — | Must be `4.0` |
| `SOURCE` | uri | — | Where to get updated vCard |
| `KIND` | text | — | `individual`, `group`, `org`, `location`, x-name, iana-token |
| `XML` | text | — | Embedded XML content |
| `FN` | text | — | Formatted name; required; multiple allowed |
| `N` | structured text | — | Family;Given;Additional;Prefix;Suffix |
| `NICKNAME` | text | — | Multiple values comma-separated |
| `PHOTO` | uri | — | Image URI (or data: URI) |
| `BDAY` | date-and-or-time | text | Birthday |
| `ANNIVERSARY` | date-and-or-time | text | Anniversary date |
| `GENDER` | structured text | — | `M`, `F`, `O`, `N`, `U`; optional identity text after `;` |
| `ADR` | structured text | — | PO Box;Ext;Street;City;Region;Postal;Country |
| `TEL` | text | uri | Telephone; `tel:` URI preferred |
| `EMAIL` | text | — | Email address |
| `IMPP` | uri | — | Instant messaging URI (e.g. `xmpp:`, `sip:`) |
| `LANG` | language-tag | — | Preferred language |
| `TZ` | text | uri, utc-offset | Timezone |
| `GEO` | uri | — | Geographic position (`geo:` URI) |
| `TITLE` | text | — | Job title |
| `ROLE` | text | — | Business role/function |
| `LOGO` | uri | — | Company logo URI |
| `ORG` | structured text | — | Org name;unit;sub-unit... (semicolon-separated) |
| `MEMBER` | uri | — | Member of GROUP kind vCard (URI to vCard) |
| `RELATED` | uri | text | Related person; `contact`, `acquaintance`, `friend`, `met`, `co-worker`, `colleague`, `co-resident`, `neighbor`, `child`, `parent`, `sibling`, `spouse`, `kin`, `muse`, `crush`, `date`, `sweetheart`, `me`, `agent`, `emergency` |
| `CATEGORIES` | text | — | Comma-separated tag list |
| `NOTE` | text | — | Freeform note |
| `PRODID` | text | — | Product identifier that created this vCard |
| `REV` | timestamp | — | Last revision timestamp |
| `SOUND` | uri | — | Audio clip URI |
| `UID` | uri | text | Unique identifier |
| `CLIENTPIDMAP` | structured text | — | `pid;uri` pair; maps PID to global URI |
| `URL` | uri | — | Home page URL |
| `KEY` | uri | text | Public encryption key |
| `FBURL` | uri | — | Free/busy URL (from RFC 2739) |
| `CALADRURI` | uri | — | Calendar scheduling address (from RFC 2739) |
| `CALURI` | uri | — | Calendar URI (from RFC 2739) |

### Structured Value Serialization
- Component separator: `;` (semicolon)
- List separator: `,` (comma)
- Escaping: `\;` `\,` `\n` `\\` (backslash escape in text values)
- Line folding: CRLF + single LWSP character (continuation line)
- Parameter value quoting: `"..."` required when value contains `:`, `;`, or `,`

---

## RFC 6352 — CardDAV: vCard Extensions to WebDAV

**Namespace:** `urn:ietf:params:xml:ns:carddav` (prefix `CARDDAV:`)
**DAV Feature Token:** `addressbook` (in `DAV:` response header)
**MIME Type:** `text/vcard` (version 3.0 default; 4.0 supported)

### Address Book Collection Properties
| Property | Value Type | Notes |
|---|---|---|
| `CARDDAV:addressbook-description` | text (`#PCDATA`) | Human-readable description; `xml:lang` attribute |
| `CARDDAV:supported-address-data` | `(address-data-type+)` | Lists content-type/version pairs the server accepts |
| `CARDDAV:max-resource-size` | unsigned integer (`#PCDATA`) | Max vCard size in octets |

### Principal Properties
| Property | Value Type | Notes |
|---|---|---|
| `CARDDAV:addressbook-home-set` | `(DAV:href*)` | Set of addressbook home collection URIs |
| `CARDDAV:principal-address` | `(DAV:href)` | URI of the principal's own vCard |

### Report/Query Properties
| Property | Value Type | Notes |
|---|---|---|
| `CARDDAV:supported-collation-set` | `(supported-collation+)` | Collations the server supports for text matching |
| `CARDDAV:supported-collation` | text (`#PCDATA`) | A single collation identifier |
| `CARDDAV:supported-filter` | `(prop-filter*, param-filter*)` | Supported filter conditions |

### XML Elements (CARDDAV namespace)
| Element | Content Model / Attributes | Notes |
|---|---|---|
| `addressbook` | EMPTY | `DAV:resourcetype` marker for address book collections |
| `addressbook-description` | `(#PCDATA)` | Has `xml:lang` attribute |
| `supported-address-data` | `(address-data-type+)` | — |
| `address-data-type` | EMPTY | Attrs: `content-type` (default `"text/vcard"`), `version` |
| `max-resource-size` | `(#PCDATA)` | Unsigned integer |
| `no-uid-conflict` | `(DAV:href)` | Precondition error: conflicting UID; href = conflicting resource |
| `addressbook-home-set` | `(DAV:href*)` | — |
| `principal-address` | `(DAV:href)` | — |
| `supported-collation` | `(#PCDATA)` | Collation identifier string |
| `addressbook-query` | `((DAV:allprop\|DAV:propname\|DAV:prop)?, filter, limit?)` | REPORT request element |
| `addressbook-multiget` | `((DAV:allprop\|DAV:propname\|DAV:prop)?, DAV:href+)` | REPORT request element |
| `address-data` | `(allprop \| prop*) \| (#PCDATA)` | In request: selector; in response: vCard content. Attrs: `content-type`, `version` |
| `allprop` | EMPTY | Return all vCard properties |
| `prop` | EMPTY | Attrs: `name` (required), `novalue` (yes/no, default no) |
| `filter` | `(prop-filter*)` | Attr: `test` (anyof/allof, default anyof) |
| `prop-filter` | `(is-not-defined \| (param-filter*, text-match*))` | Attr: `name` (required), `test` (anyof/allof) |
| `param-filter` | `(is-not-defined \| text-match)?` | Attr: `name` (required) |
| `is-not-defined` | EMPTY | Matches when property/parameter is absent |
| `text-match` | `(#PCDATA)` | Attrs: `collation` (default `i;unicode-casemap`), `negate-condition` (yes/no), `match-type` (equals/contains/starts-with/ends-with, default contains) |
| `limit` | `(nresults)` | Limits result set size |
| `nresults` | `(#PCDATA)` | Unsigned integer |

### DNS Service Discovery (SRV Records)
- `_carddavs._tcp` — CardDAV over HTTPS (port 443)
- `_carddav._tcp` — CardDAV over HTTP (port 80)

---

## RFC 6578 — Collection Synchronization for WebDAV

**DAV Feature Token:** `sync` (implied by presence of `DAV:sync-token` property)

### New DAV Properties
| Property | Value Type | Notes |
|---|---|---|
| `DAV:sync-token` | URI (`#PCDATA`) | Opaque sync-token; value MUST be a valid URI; protected |

### XML Elements (DAV namespace)
| Element | Content Model | Notes |
|---|---|---|
| `DAV:sync-collection` | `(sync-token, sync-level, limit?, prop)` | REPORT request body |
| `DAV:sync-token` | CDATA (URI) | In request: last-known token (empty string = initial); in response: new token |
| `DAV:sync-level` | CDATA | `"1"` (direct members) or `"infinite"` (recursive) |
| `DAV:multistatus` | `(response*, responsedescription?, sync-token?)` | Extended to include sync-token in response |

### Sync-Token Format
- Value is an opaque URI; servers may use any URI scheme
- Empty `sync-token` in request triggers initial full sync
- Truncated responses: server returns partial results + new `sync-token` for continuation

---

## RFC 6638 — Scheduling Extensions to CalDAV

**Namespace:** `urn:ietf:params:xml:ns:caldav` (shared with CalDAV RFC 4791)
**DAV Feature Token:** `calendar-auto-schedule`

### Resource Type Elements
| Element | Content Model | Notes |
|---|---|---|
| `CALDAV:schedule-outbox` | EMPTY | Marks collection as scheduling outbox (POST iMIP/iTIP here) |
| `CALDAV:schedule-inbox` | EMPTY | Marks collection as scheduling inbox |

### Principal Properties
| Property | Value Type | Notes |
|---|---|---|
| `CALDAV:schedule-outbox-URL` | `(DAV:href)` | URI of principal's scheduling outbox |
| `CALDAV:schedule-inbox-URL` | `(DAV:href)` | URI of principal's scheduling inbox |
| `CALDAV:calendar-user-address-set` | `(DAV:href*)` | Set of calendar user addresses for this principal |
| `CALDAV:calendar-user-type` | text (`#PCDATA`) | Same values as iCalendar `CUTYPE`: `INDIVIDUAL`, `GROUP`, `RESOURCE`, `ROOM`, `UNKNOWN` |

### Calendar Collection Properties
| Property | Value Type | Notes |
|---|---|---|
| `CALDAV:schedule-calendar-transp` | `(opaque \| transparent)` | Whether calendar contributes to free/busy |
| `CALDAV:schedule-default-calendar-URL` | `(DAV:href?)` | Default calendar for received scheduling messages |
| `CALDAV:schedule-tag` | text (`#PCDATA`) | ETag-like token for scheduling objects; changes on organizer-relevant updates |

### Response XML Elements (CALDAV namespace)
| Element | Content Model | Notes |
|---|---|---|
| `CALDAV:schedule-response` | `(response*)` | POST response body |
| `CALDAV:response` | `(recipient, request-status, calendar-data?, DAV:error?, DAV:responsedescription?)` | Single recipient's scheduling response |
| `CALDAV:recipient` | `(DAV:href)` | The target calendar user address |
| `CALDAV:request-status` | `(#PCDATA)` | iTIP REQUEST-STATUS value (e.g. `2.0;Success`) |
| `CALDAV:schedule-calendar-transp/opaque` | EMPTY | Calendar contributes to free/busy |
| `CALDAV:schedule-calendar-transp/transparent` | EMPTY | Calendar does not contribute to free/busy |

### Scheduling Privileges (CALDAV namespace)
| Privilege | Aggregate Of | Purpose |
|---|---|---|
| `CALDAV:schedule-deliver` | deliver-invite + deliver-reply + query-freebusy | Aggregate receive privilege |
| `CALDAV:schedule-deliver-invite` | — | Allow delivery of invite messages to inbox |
| `CALDAV:schedule-deliver-reply` | — | Allow delivery of reply messages to inbox |
| `CALDAV:schedule-query-freebusy` | — | Allow free/busy query against outbox |
| `CALDAV:schedule-send` | send-invite + send-reply + send-freebusy | Aggregate send privilege |
| `CALDAV:schedule-send-invite` | — | Allow sending invite from outbox |
| `CALDAV:schedule-send-reply` | — | Allow sending reply from outbox |
| `CALDAV:schedule-send-freebusy` | — | Allow sending free/busy query from outbox |

### Schedule-Tag Header
- `Schedule-Tag` response header: current value of `CALDAV:schedule-tag`
- `If-Schedule-Tag-Match` request header: precondition matching schedule-tag

---

## RFC 6764 — Locating CalDAV and CardDAV Services

Defines DNS-based service discovery for CalDAV and CardDAV.

### DNS SRV Service Labels
| Service Label | Protocol | Notes |
|---|---|---|
| `_caldav._tcp` | HTTP (port 80) | CalDAV without TLS |
| `_caldavs._tcp` | HTTPS (port 443) | CalDAV with TLS |
| `_carddav._tcp` | HTTP (port 80) | CardDAV without TLS (also in RFC 6352) |
| `_carddavs._tcp` | HTTPS (port 443) | CardDAV with TLS (also in RFC 6352) |

### DNS TXT Record
- Key: `path`
- Value: HTTP context path (e.g. `/caldav`, `/carddav`)
- Example: `_caldavs._tcp TXT path=/caldav`

### Well-Known URIs (RFC 5785)
| URI | Service |
|---|---|
| `/.well-known/caldav` | CalDAV context path redirect |
| `/.well-known/carddav` | CardDAV context path redirect |

---

## RFC 6868 — Parameter Value Encoding in iCalendar and vCard

Defines `^`-escaping (caret encoding) for iCalendar and vCard parameter values.

### Escape Sequences
| Encoded | Decoded | Notes |
|---|---|---|
| `^^` | `^` (U+005E) | Literal caret |
| `^n` | line break | CRLF or LF depending on system |
| `^'` | `"` (U+0022) | Double-quote |

**Scope:** Applies to the `param-value` syntax in RFC 5545 (iCalendar) and RFC 6350 (vCard).
Works in both quoted and unquoted parameter values.
Unknown `^X` sequences: both `^` and `X` are preserved as-is.

---

## RFC 7529 — Non-Gregorian Recurrence Rules in iCalendar and vCard

Extends the iCalendar `RRULE` property and `RECUR` value type.

### New RECUR Elements
| Element | Type | Values | Notes |
|---|---|---|---|
| `RSCALE` | text | CLDR calendar system name | e.g. `GREGORIAN`, `CHINESE`, `HEBREW`, `ETHIOPIC`, `ISLAMIC-CIVIL`, etc. |
| `SKIP` | enum | `OMIT` (default), `BACKWARD`, `FORWARD` | How to handle missing dates (month that doesn't exist in a year) |

### Updated ABNF
```
recur-rule-part =/  ("RSCALE" "=" rscale)
                 /  ("SKIP" "=" skip)
rscale          =  (iana-token / x-name)
skip            =  "OMIT" / "BACKWARD" / "FORWARD"
```

**Note:** `BYMONTH` gains support for leap-month notation: suffix `L` means "leap month" (e.g. `5L` = leap Adar in Hebrew calendar). `SKIP` MUST NOT be present unless `RSCALE` is present.

### New vCard Property Parameter
| Property | Parameter | Purpose |
|---|---|---|
| `BDAY`, `ANNIVERSARY` | `CALSCALE` | Specifies the calendar scale for the date value |

---

## RFC 7809 — CalDAV: Time Zones by Reference

Extends CalDAV to reference time zones by identifier rather than embedding VTIMEZONE components.

### New CalDAV Properties
| Property | Namespace | Value | Notes |
|---|---|---|---|
| `CALDAV:calendar-timezone-id` | `urn:ietf:params:xml:ns:caldav` | text (`#PCDATA`) | TZID of the default timezone; alternative to `calendar-timezone` |
| `CALDAV:timezone-service-set` | `urn:ietf:params:xml:ns:caldav` | `(DAV:href+)` | List of timezone service URLs the server uses |

### New CalDAV XML Elements (beyond properties)
| Element | Content Model | Notes |
|---|---|---|
| `CALDAV:calendar-timezone-id` | `(#PCDATA)` | Timezone identifier string (e.g. `America/New_York`) |
| `CALDAV:timezone-id` | `(#PCDATA)` | Used in `calendar-query` to filter by timezone ID |

### Request Header
- `CalDAV-Timezones: T` — client requests server to return VTIMEZONE components in responses
- `CalDAV-Timezones: F` — client indicates it does not need VTIMEZONE components

---

## RFC 7953 — Calendar Availability

Defines the `VAVAILABILITY` and `AVAILABLE` iCalendar components.

### New Components
| Component | Purpose |
|---|---|
| `VAVAILABILITY` | Container defining a time window; time inside is BUSY-UNAVAILABLE except where AVAILABLE says otherwise |
| `AVAILABLE` | Sub-component of VAVAILABILITY; defines periods when the user is available |

### Component ABNF
```
availabilityc  = "BEGIN" ":" "VAVAILABILITY" CRLF
                 ; availability properties, AVAILABLE subcomponents
                 "END" ":" "VAVAILABILITY" CRLF

availablec     = "BEGIN" ":" "AVAILABLE" CRLF
                 ; available properties
                 "END" ":" "AVAILABLE" CRLF
```

### New Property
| Property | Value Type | Notes |
|---|---|---|
| `BUSYTYPE` | TEXT | Free/busy type for the enclosing period. Values: `BUSY` (default), `BUSY-UNAVAILABLE`, `BUSY-TENTATIVE` |

---

## RFC 7986 — New Properties for iCalendar

Adds new properties to `VCALENDAR` and event/task components.

### New Properties
| Property | Default Value Type | Alt Types | Context | Notes |
|---|---|---|---|---|
| `NAME` | TEXT | — | `VCALENDAR` | Human-readable calendar name (multiple for i18n) |
| `DESCRIPTION` | TEXT | — | `VCALENDAR` | Calendar description (also extended to other components) |
| `UID` | TEXT | — | `VCALENDAR` | Global UID for the calendar object itself |
| `LAST-MODIFIED` | DATE-TIME | — | `VCALENDAR` | When the calendar object was last modified |
| `URL` | URI | — | `VCALENDAR` | Extended to be allowed on `VCALENDAR` |
| `CATEGORIES` | TEXT | — | `VCALENDAR` | Extended to `VCALENDAR` level |
| `REFRESH-INTERVAL` | DURATION | — | `VCALENDAR` | Suggested polling interval; no default; `VALUE=DURATION` required |
| `SOURCE` | URI | — | `VCALENDAR` | URI from which the calendar data should be refreshed |
| `COLOR` | TEXT | — | `VCALENDAR`, event/task | CSS3 color name (e.g. `turquoise`, `red`) |
| `IMAGE` | URI | BINARY | `VCALENDAR`, event/task | Image. Attrs: `DISPLAY` parameter (BADGE, GRAPHIC, FULLSIZE, THUMBNAIL) |
| `CONFERENCE` | URI | — | event/task | Conference call URI; `FEATURE` parameter: `AUDIO`, `VIDEO`, `PHONE`, `MODERATOR`, `CHAT`, `FEED`, `SCREEN` |

### New Property Parameters
| Parameter | Values | Used On |
|---|---|---|
| `DISPLAY` | `BADGE`, `GRAPHIC`, `FULLSIZE`, `THUMBNAIL` | `IMAGE` property |
| `FEATURE` | `AUDIO`, `VIDEO`, `PHONE`, `MODERATOR`, `CHAT`, `FEED`, `SCREEN` | `CONFERENCE` property |
| `LABEL` | text | `CONFERENCE` property — display label |

---

## RFC 9073 — Event Publishing Extensions to iCalendar

Adds new components and properties for rich event publishing.

### New Components
| Component | Purpose |
|---|---|
| `PARTICIPANT` | Describes a participant (attendee, speaker, performer, contact, etc.) in an event |
| `VLOCATION` | Rich location information for an event |
| `VRESOURCE` | Describes a resource associated with an event |

### New Properties
| Property | Value Type | Context | Notes |
|---|---|---|---|
| `LOCATION-TYPE` | TEXT | `VLOCATION` | Comma-separated location type values: `stadium`, `arts`, `educational`, `government`, `medical`, `meeting`, `transit`, etc. |
| `PARTICIPANT-TYPE` | TEXT | `PARTICIPANT` | `ACTIVE`, `INACTIVE`, `SPONSOR`, `CONTACT`, `BOOKING-CONTACT`, `EMERGENCY-CONTACT`, `PUBLICITY-CONTACT`, `PLANNER-CONTACT`, `PERFORMER`, `SPEAKER` |
| `RESOURCE-TYPE` | TEXT | `VRESOURCE` | Resource category text |
| `CALENDAR-ADDRESS` | CAL-ADDRESS | `PARTICIPANT` | Scheduling address of the participant |
| `STYLED-DESCRIPTION` | URI or TEXT | event/task/etc. | Rich text description; `FMTTYPE` param for content type (e.g. `text/html`) |
| `STRUCTURED-DATA` | URI, TEXT, or BINARY | event/task/etc. | Structured data attachment; `FMTTYPE` param required |

### New Property Parameters
| Parameter | Purpose |
|---|---|
| `ORDER` | Integer (1..maxint) ordering hint for multiple properties of same type |
| `SCHEMA` | URI pointing to the schema for a `STRUCTURED-DATA` value |

---

## RFC 9074 — VALARM Extensions for iCalendar

Extends `VALARM` with new properties and behaviors.

### Extended VALARM Syntax
`VALARM` components now accept:
- `UID` property — unique identifier for the alarm
- `RELATED-TO` property — link to another alarm (e.g. the original for a snooze)
- `ACKNOWLEDGED` property
- `PROXIMITY` property

### New Properties
| Property | Value Type | Notes |
|---|---|---|
| `ACKNOWLEDGED` | DATE-TIME | UTC timestamp when alarm was last acknowledged/dismissed by the user |
| `PROXIMITY` | TEXT | Triggers proximity alarm. Values: `ARRIVE`, `DEPART`, `X-ARRIVE` (arrival side), `X-DEPART` (departure side) |

---

## RFC 9253 — Support for iCalendar Relationships

Extends iCalendar relationship handling with new properties, parameters, and RELTYPE values.

### New Properties
| Property | Value Type | Notes |
|---|---|---|
| `CONCEPT` | URI | Formal category/classification (links to taxonomy resource) |
| `LINK` | URI, UID, or XML-REFERENCE | Typed external link; requires `LINKREL` parameter |
| `REFID` | TEXT | Free-text group key; components sharing the same REFID are associated |

### Updated Properties
| Property | Value Type Change | Notes |
|---|---|---|
| `RELATED-TO` | URI, UID, or TEXT (was TEXT only) | Extends to support URI and UID values; adds `GAP` parameter support |

### New Value Type
| Type | Description |
|---|---|
| `XML-REFERENCE` | URI with XPointer anchor (e.g. `https://example.com/doc.xml#xpointer(...)`) |

### New Property Parameters
| Parameter | Format | Notes |
|---|---|---|
| `LINKREL` | URI or IANA link relation name | Required on `LINK` property; defines the relation type (maps to RFC 8288) |
| `GAP` | duration (`dur-value`) | Lead/lag time for temporal RELTYPE relationships on `RELATED-TO` |

### New RELTYPE Values
**Temporal relationships:**
- `FINISHTOSTART` — referenced task must finish before this task starts
- `FINISHTOFINISH` — referenced task must finish before this task finishes
- `STARTTOFINISH` — start of referenced task triggers finish of this task
- `STARTTOSTART` — start of referenced task triggers start of this task

**Other new values:**
- `FIRST` — referenced component is the first in a series
- `NEXT` — referenced component is the next in the series
- `DEPENDS-ON` — this component depends on the referenced one
- `REFID` — associates this component with a REFID key value
- `CONCEPT` — associates this component with a CONCEPT URI value

---

## RFC 9554 — vCard Format Extensions for JSContact

Updates RFC 6350 (vCard 4.0) with new properties and parameters for JSContact alignment.

### Updated Properties
| Property | Change |
|---|---|
| `ADR` | Extended structured value: adds 11 new components (room, apartment, floor, street-number, street-name, building, block, subdistrict, district, landmark, direction) after original 7 |
| `N` | Extended: adds `secondary-surname` and `generation` as 6th and 7th components |

### New Properties
| Property | Value Type | Notes |
|---|---|---|
| `CREATED` | timestamp | When the vCard was created (not revised); `VALUE=TIMESTAMP` |
| `GRAMGENDER` | TEXT (enum) | Grammatical gender: `animate`, `common`, `feminine`, `inanimate`, `masculine`, `neuter` |
| `LANGUAGE` | language-tag | Default language for all TEXT properties in this vCard |
| `PRONOUNS` | TEXT | Preferred pronouns; multiple with `LANGUAGE`/`PREF` params |
| `SOCIALPROFILE` | URI (default) or TEXT | Social media profile; `SERVICE-TYPE` param required when TEXT |

### New Parameters
| Parameter | Value Type | Notes |
|---|---|---|
| `AUTHOR` | quoted URI | Identifies the author of a property value |
| `AUTHOR-NAME` | param-value text | Names the author as free text |
| `CREATED` | TIMESTAMP value | When the specific property was created |
| `DERIVED` | `true` / `false` (default false) | Value is derived from other properties; clients must not update |
| `LABEL` | param-value text | Formatted address label for `ADR` property |
| `PHONETIC` | `ipa` / `piny` / `jyut` / `script` | Phonetic system for property value; used with `ADR` and `N` |
| `PROP-ID` | 1–255 chars (`A-Za-z0-9-_`) | Unique sibling identifier within a vCard |
| `SCRIPT` | 4 ALPHA chars | ISO 15924 script subtag (e.g. `Latn`, `Hant`); use with `PHONETIC` |
| `SERVICE-TYPE` | param-value text | Online service name for `IMPP` and `SOCIALPROFILE` properties |
| `USERNAME` | param-value text | Username for `IMPP` and `SOCIALPROFILE` properties |

### New TYPE Parameter Values
| Value | Notes |
|---|---|
| `billing` | Billing address (for `ADR`) |
| `delivery` | Delivery address (for `ADR`) |

---

## RFC 5689 — Extended MKCOL for WebDAV

**DAV Feature Token:** `extended-mkcol`

Extends the `MKCOL` method to accept a request body for setting properties and resource type at collection creation time, replacing the need for separate `MKCALENDAR`/`MKXXX` methods.

### XML Elements (DAV namespace)
| Element | Content Model | Notes |
|---|---|---|
| `DAV:mkcol` | `(set+)` | Extended MKCOL request body |
| `DAV:mkcol-response` | `(propstat+)` | Response body |

---
