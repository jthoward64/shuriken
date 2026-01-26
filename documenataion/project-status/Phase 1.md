# Phase 1: Core Parsing & Serialization

**Status**: ⚠️ **MOSTLY COMPLETE (~99%)** — See Known Gaps below  
**Last Updated**: 2026-01-25 (RFC Compliance Review; verified against current code)

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

### Medium Priority (Missing Features)

1. **iCalendar VALARM dedicated tests/fixtures**
   - Parser/serializer supports `VALARM`, but there are no focused fixtures/tests yet

### Low Priority (Edge Cases)

---

## Test Coverage

**Unit tests**: 490+ tests across parsing/serialization and filter modules

**Strengths**:
- Value type parsing well tested
- Round-trip tests for iCalendar and vCard
- XML parsing tests
- VTIMEZONE parsing and offset calculation
- Text-match collation and pattern matching

**Gaps**:
- Dedicated iCalendar `VALARM` fixtures/tests

---

## RFC Compliance

| RFC | Status | Notes |
|-----|--------|-------|
| RFC 5545 (iCalendar) | ✅ ~99% | BINARY base64 decoding supported |
| RFC 6350 (vCard 4.0) | ✅ ~98% | RELATED/REV typed parsing and truncated date/time forms supported |
| RFC 2426 (vCard 3.0) | ✅ ~98% | Full support |
| RFC 6868 (Caret Encoding) | ✅ 100% | Fully implemented |
| RFC 4918 (WebDAV XML) | ✅ 100% | All relevant elements parsed |
| RFC 4791 (CalDAV XML) | ⚠️ ~98% | Remaining: VALARM fixtures/tests |
| RFC 6352 (CardDAV XML) | ✅ ~98% | REPORT limit parsing supported |
| RFC 4790 (Collation) | ✅ ~98% | Collations supported; CalDAV defaults to `i;ascii-casemap` in filter evaluation |

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

---

## RFC Compliance Status

| RFC | Status | Notes |
|-----|--------|-------|
| RFC 5545 (iCalendar) | ✅ ~99% | BINARY base64 decoding supported |
| RFC 6350 (vCard 4.0) | ✅ ~98% | RELATED/REV typed parsing; truncated date/time supported |
| RFC 2426 (vCard 3.0) | ✅ ~98% | Full support |
| RFC 6868 (Parameter Encoding) | ✅ 100% | Caret encoding implemented |
| RFC 4918 (WebDAV) | ✅ 100% | XML parsing complete |
| RFC 4791 (CalDAV) | ⚠️ ~98% | Remaining: VALARM fixtures/tests |
| RFC 6352 (CardDAV) | ✅ ~98% | REPORT limit parsing supported |
| RFC 4790 (Collation) | ✅ ~98% | Supported collations; CalDAV defaults to `i;ascii-casemap` |

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
