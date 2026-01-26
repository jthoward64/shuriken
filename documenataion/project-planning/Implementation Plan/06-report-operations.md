# 6. REPORT Operations

## 6.0 REPORT Method Basics (RFC 3253 §3.6)

- The REPORT request body’s root element selects the report type (e.g., `CALDAV:calendar-query`, `CARDDAV:addressbook-query`).
- If the request omits the `Depth` header, treat it as `Depth: 0`.
- For reports evaluated over a collection (common for CalDAV/CardDAV), clients typically send `Depth: 1` and servers respond with `207 Multi-Status` containing one `DAV:response` per matched member.
- If the specified report is not supported by the request-URL, return `403 Forbidden` with a `DAV:error` body containing `DAV:supported-report`.

## 6.1 CALDAV:calendar-query (RFC 4791 §7.8)

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

### 6.1.1 Filter Elements

| Element | Description |
|---------|-------------|
| `comp-filter` | Filter by component name; can nest |
| `prop-filter` | Filter by property existence/value |
| `param-filter` | Filter by parameter existence/value |
| `time-range` | Filter by temporal overlap |
| `text-match` | Text comparison with collation |
| `is-not-defined` | Property/param must NOT exist |

### 6.1.2 Time-Range Semantics (RFC 4791 §9.9)

For VEVENT:
- Start defaults to DTSTART
- End defaults to DTEND, or DTSTART + DURATION, or DTSTART + P1D (all-day), or DTSTART (instantaneous)

Overlap test: `(start < time-range.end) AND (end > time-range.start)`

For recurring events, expand occurrences and test each.

## 6.2 CALDAV:calendar-multiget (RFC 4791 §7.9)

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

## 6.3 CARDDAV:addressbook-query (RFC 6352 §8.6)

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

### 6.3.1 Filter Structure (RFC 6352 §10.5)

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

### 6.3.2 text-match Element (RFC 6352 §10.5.4)

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

### 6.3.3 Match Types

| match-type | Description | Example |
|------------|-------------|---------|
| `equals` | Exact match (per collation) | "John Doe" matches "john doe" |
| `contains` | Substring anywhere | "ohn" matches "John Doe" |
| `starts-with` | Prefix match | "John" matches "John Doe" |
| `ends-with` | Suffix match | "Doe" matches "John Doe" |

### 6.3.4 Collations (RFC 4790)

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

### 6.3.5 Property Filtering Examples

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

### 6.3.6 Partial vCard Retrieval (address-data)

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

### 6.3.7 Result Limiting (RFC 6352 §10.6)

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

### 6.3.8 Preconditions

| Precondition | Condition |
|--------------|-----------|
| CARDDAV:supported-address-data | Requested content-type/version is supported |
| CARDDAV:supported-filter | Filter uses only supported properties/parameters |
| CARDDAV:supported-collation | Requested collation is supported |
| DAV:number-of-matches-within-limits | Result count within server limits |

## 6.4 CARDDAV:addressbook-multiget (RFC 6352 §8.7)

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

## 6.5 CALDAV:free-busy-query (RFC 4791 §7.10)

Returns VFREEBUSY component for time range:

```xml
<C:free-busy-query xmlns:C="urn:ietf:params:xml:ns:caldav">
  <C:time-range start="20060104T000000Z" end="20060105T000000Z"/>
</C:free-busy-query>
```

## 6.6 DAV expand-property Report (RFC 3253 §3.8)

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
