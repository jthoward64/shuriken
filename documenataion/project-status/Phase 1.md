# Phase 1: Core Parsing & Serialization

**Status**: ⚠️ **MOSTLY COMPLETE (~95%)** — See Known Gaps below  
**Last Updated**: 2026-01-25 (RFC Compliance Review)

---

## Overview

Phase 1 provides RFC-compliant parsers and serializers for:
- **iCalendar** (RFC 5545) — Calendar events, todos, journals
- **vCard** (RFC 6350, RFC 2426) — Contact information (v3.0 and v4.0)
- **WebDAV XML** (RFC 4918, RFC 4791, RFC 6352) — CalDAV/CardDAV protocol messages

---

## Implementation Status

### ✅ iCalendar Parser (`src/component/rfc/ical/parse/`)

- [x] Line unfolding with CRLF+SPACE handling
- [x] Property name, parameters, and value extraction
- [x] Quoted-string support and multi-value parameters
- [x] RFC 6868 caret encoding
- [x] All value types: DATE, DATE-TIME, DURATION, PERIOD, RRULE, etc.
- [x] Complete RRULE parsing (FREQ, COUNT, UNTIL, BYxxx rules)
- [x] Component hierarchy (VCALENDAR, VEVENT, VTODO, VJOURNAL, VALARM, etc.)
- [x] Text escaping/unescaping

### ✅ iCalendar Serializer (`src/component/rfc/ical/build/`)

- [x] Line folding at 75 octets with UTF-8 safety
- [x] Text and parameter escaping
- [x] Canonical property ordering
- [x] Round-trip fidelity

### ✅ vCard Parser & Serializer (`src/component/rfc/vcard/`)

- [x] vCard 3.0 and 4.0 support
- [x] All property types (FN, N, ADR, TEL, EMAIL, etc.)
- [x] RFC 6868 caret encoding
- [x] Round-trip fidelity

### ✅ WebDAV XML Parser (`src/component/rfc/dav/parse/`)

- [x] PROPFIND parsing (allprop, propname, prop)
- [x] PROPPATCH parsing (set, remove)
- [x] REPORT parsing (calendar-query, calendar-multiget, addressbook-query, addressbook-multiget, sync-collection, expand-property)
- [x] Filter parsing (component, property, time-range, text-match)
- [x] Namespace handling (DAV:, CALDAV:, CARDDAV:, CS:)

### ✅ WebDAV XML Serializer (`src/component/rfc/dav/build/`)

- [x] Multistatus generation
- [x] PropStat serialization with status codes
- [x] Error element generation

---

## ✅ Recently Completed

### 1. VTIMEZONE Component Parsing — **COMPLETED**

**Status**: ✅ Implemented

**What exists**:
- `VTimezone` struct in `src/component/rfc/ical/expand/vtimezone.rs`
- Parses VTIMEZONE components from iCalendar data
- Extracts STANDARD/DAYLIGHT observances with TZOFFSETFROM/TZOFFSETTO
- RRULE-based DST transition calculation for recurring rules
- `TimeZoneResolver` integration for custom/proprietary TZID handling
- Uses `chrono-tz` for IANA timezone lookup as fallback
- Uses ICU4X for Windows timezone ID → IANA mapping (`WindowsParser`)
- Uses ICU4X for IANA alias canonicalization (`IanaParserExtended`)

**Capabilities**:
- [x] VTIMEZONE STANDARD/DAYLIGHT block parsing
- [x] TZOFFSETFROM/TZOFFSETTO extraction
- [x] RRULE-based DST transition calculation (FREQ=YEARLY;BYMONTH;BYDAY)
- [x] Custom/proprietary TZID handling via VTIMEZONE registration
- [x] UTC offset calculation at any datetime
- [x] Local-to-UTC and UTC-to-local conversion

### 2. Text-Match on Arbitrary Properties — **COMPLETED**

**Status**: ✅ Implemented

**What exists**:
- Shared `text_match` module in `src/component/db/query/text_match.rs`
- ICU4X `CaseMapper::fold_string()` for RFC 4790 `i;unicode-casemap` collation
- CardDAV now queries `dav_property` table for non-indexed properties (ADR, NOTE, BDAY, etc.)
- CalDAV already had `dav_property` support, now uses shared collation module
- Support for `i;unicode-casemap`, `i;ascii-casemap`, and `i;octet` collations
- `is-not-defined` support for checking property absence

**Capabilities**:
- [x] Text-match on indexed properties (FN, EMAIL, TEL, UID, ORG, TITLE)
- [x] Text-match on arbitrary vCard properties via `dav_property` table
- [x] Text-match on arbitrary iCalendar properties via `dav_property` table
- [x] RFC 4790 collation support (unicode-casemap, ascii-casemap, octet)
- [x] Match types: equals, contains, starts-with, ends-with
- [x] Property existence and is-not-defined checks

---

## ⚠️ Known Gaps (RFC Compliance Review 2026-01-25)

### High Priority (Affects Filter Correctness)

1. **text-match `negate` attribute not evaluated** — RFC 4791 §9.7.5, RFC 6352 §10.5.4
   - The `negate` field is parsed but never used in query evaluation
   - Location: `src/component/db/query/{caldav,carddav}/filter.rs`

2. **CalDAV default collation should be `i;ascii-casemap`** — RFC 4791 §9.7.5
   - Currently defaults to `i;unicode-casemap` for both CalDAV and CardDAV
   - CardDAV correctly defaults to `i;unicode-casemap` per RFC 6352 §10.5.4
   - Location: `src/component/db/query/text_match.rs`

3. **time-range parses RFC 3339 instead of iCalendar format** — RFC 4791 §9.9
   - RFC requires `20060104T000000Z` format, code uses `2006-01-04T00:00:00Z`
   - Location: `src/component/rfc/dav/parse/report.rs` line 858

### Medium Priority (Missing Features)

4. **param-filter not evaluated** — RFC 4791 §9.7.3, RFC 6352 §10.5.2
   - Parsed correctly but `param_filters` field is ignored in query execution
   - Requires querying `dav_parameter` table

5. **CardDAV prop-filter missing `test` attribute** — RFC 6352 §10.5.1
   - The `test="anyof|allof"` attribute on `prop-filter` is not parsed
   - Currently assumes `anyof` behavior

6. **vCard RELATED property not parsed to typed value** — RFC 6350 §6.6.6
   - Falls through to default text handling instead of `VCardValue::Related`
   - Location: `src/component/rfc/vcard/parse/parser.rs`

7. **vCard REV property not parsed to Timestamp** — RFC 6350 §6.7.4
   - Falls through to default text handling instead of `VCardValue::Timestamp`

### Low Priority (Edge Cases)

8. **vCard truncated time formats** — RFC 6350 §4.3.2
   - Missing `-MMSS` (minute-second only) and `--SS` (second only) formats
   - Location: `src/component/rfc/vcard/parse/values.rs`

9. **vCard month-only date** — RFC 6350 §4.3.1
   - `--MM` format (month without day) not supported

10. **CalDAV prop-filter time-range not evaluated** — RFC 4791 §9.7.2
    - time-range on properties like COMPLETED, CREATED is parsed but not evaluated

11. **iCalendar BINARY value not Base64 decoded** — RFC 5545 §3.3.1
    - Stored as raw text instead of being decoded to bytes

---

## Test Coverage

**Unit tests**: ~100+ tests for parsing/serialization

**Strengths**:
- Value type parsing well tested
- Round-trip tests for iCalendar and vCard
- XML parsing tests
- VTIMEZONE parsing and offset calculation
- Text-match collation and pattern matching

**Gaps**:
- text-match negate attribute handling
- param-filter evaluation
- vCard RELATED/REV typed parsing
- Truncated time/date edge cases

---

## RFC Compliance

| RFC | Status | Notes |
|-----|--------|-------|
| RFC 5545 (iCalendar) | ✅ ~98% | Minor: BINARY base64 decoding |
| RFC 6350 (vCard 4.0) | ⚠️ ~95% | RELATED/REV not typed, truncated time gaps |
| RFC 2426 (vCard 3.0) | ✅ ~98% | Full support |
| RFC 6868 (Caret Encoding) | ✅ 100% | Fully implemented |
| RFC 4918 (WebDAV XML) | ✅ 100% | All relevant elements parsed |
| RFC 4791 (CalDAV XML) | ⚠️ ~90% | negate, param-filter, time-range format, default collation |
| RFC 6352 (CardDAV XML) | ⚠️ ~92% | negate, param-filter, prop-filter test attr |
| RFC 4790 (Collation) | ⚠️ ~95% | CalDAV should default to ascii-casemap |

**Issue**: DATE-TIME, DATE, and PERIOD lists were only parsing the first value  
**Fixed**: Implemented DateTimeList, DateList, and PeriodList value types with proper parsing and serialization  
**Properties affected**: EXDATE, RDATE, FREEBUSY  
**Tests added**: parse_datetime_list, parse_date_list, parse_period_list, roundtrip tests

### Line Unfolding Bug (Fixed 2026-01-25)

**Issue**: Line unfolding was removing ALL leading whitespace instead of just the single fold marker  
**Impact**: Long values that were folded could be incorrectly parsed (e.g., trailing "Z" separated from datetime)  
**Fixed**: Now correctly removes only single leading space/tab per RFC 5545 §3.1

---

## ❌ Not Implemented

- [ ] iCalendar VALARM dedicated tests/fixtures
- [ ] Partial date/time format validation in vCard
- [ ] text-match `negate` attribute evaluation
- [ ] `param-filter` query evaluation
- [ ] CalDAV time-range iCalendar date format

---

## RFC Compliance Status

| RFC | Status | Notes |
|-----|--------|-------|
| RFC 5545 (iCalendar) | ✅ ~98% | Minor: BINARY base64 |
| RFC 6350 (vCard 4.0) | ⚠️ ~95% | RELATED/REV typed parsing, truncated time |
| RFC 2426 (vCard 3.0) | ✅ ~98% | Full support |
| RFC 6868 (Parameter Encoding) | ✅ 100% | Caret encoding implemented |
| RFC 4918 (WebDAV) | ✅ 100% | XML parsing complete |
| RFC 4791 (CalDAV) | ⚠️ ~90% | negate, param-filter, time-range format |
| RFC 6352 (CardDAV) | ⚠️ ~92% | negate, param-filter |
| RFC 4790 (Collation) | ⚠️ ~95% | CalDAV default collation |

---

## Code Organization

- `src/component/rfc/ical/parse/` — iCalendar parsing
- `src/component/rfc/ical/build/` — iCalendar serialization
- `src/component/rfc/vcard/parse/` — vCard parsing
- `src/component/rfc/vcard/build/` — vCard serialization
- `src/component/rfc/dav/parse/` — WebDAV XML parsing
- `src/component/rfc/dav/build/` — WebDAV XML serialization

---

## Testing Strategy

All parsers have extensive unit tests covering:
- ✅ RFC example data
- ✅ Edge cases (empty values, special characters, folding)
- ✅ Error conditions (malformed input)
- ✅ Round-trip fidelity
- ✅ List value parsing (EXDATE, RDATE, FREEBUSY)
- ✅ Line folding and unfolding edge cases
- ✅ Unicode case folding (German ß→ss, Greek σ/ς normalization)
- ✅ Windows timezone ID → IANA mapping
- ✅ IANA timezone alias canonicalization
- ✅ VTIMEZONE parsing and offset calculation
- ✅ Arbitrary property text-match filtering

**Test Count**: 490+ unit tests across all parsers and filter modules

---

## Next Phase: Phase 2

Phase 2 focuses on database operations to store and retrieve parsed iCalendar/vCard data.

**Status**: ⚠️ Mostly Complete (85%)
