# 3. Parsing & Deserialization

## 3.1 iCalendar Parser

**Implementation Path**: `src/component/rfc/ical/`

### 3.1.1 Lexer Stage

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

### 3.1.2 Parser Stage

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

### 3.1.3 RRULE Parser

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

### 3.1.4 Date/Time Parsing

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

### 3.1.5 Text Unescaping

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

### 3.1.6 Validation Rules

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

## 3.2 vCard Parser

**Implementation Path**: `src/component/rfc/vcard/`

### 3.2.1 Lexer Stage

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

### 3.2.2 Parser Stage

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

### 3.2.3 Structured Value Parsing

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

### 3.2.4 Date/Time Parsing (RFC 6350 §4.3)

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

### 3.2.5 Text Unescaping

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

### 3.2.6 Validation Rules

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

### 3.2.7 vCard 3.0 to 4.0 Conversion

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

## 3.3 WebDAV XML Parser

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
