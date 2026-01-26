# Phase 5: Recurrence & Time Zones

**Status**: ⚠️ **PARTIAL (~70%)**  
**Last Updated**: 2026-01-25 (Corrected Assessment)

---

## Summary

Phase 5 is **partially implemented** with the following status:

- ✅ **RRULE Expansion**: Working via `rrule` crate
- ✅ **IANA Timezone Resolution**: UTC conversion using `chrono-tz` with IANA names
- ✅ **Database Integration**: `cal_occurrence` table populated on PUT
- ✅ **EXDATE/RDATE**: Handled during expansion
- ❌ **VTIMEZONE Parsing**: NOT implemented — only IANA timezone strings work
- ⚠️ **RECURRENCE-ID Exceptions**: Parsing exists, full replacement logic unclear

**Key Gap**: Custom VTIMEZONE components sent by clients are NOT parsed. Only IANA timezone identifiers (e.g., `America/New_York`) work via `chrono-tz` lookup.

---

## Overview

Phase 5 implements RRULE (recurrence rule) expansion, timezone resolution, and UTC conversion for timezone-aware events. This phase enables recurring calendar events and proper timezone handling, which are essential for production CalDAV functionality.

**CRITICAL**: This phase is essential for production CalDAV. Recurring events are ubiquitous in real-world calendar usage.

---

## Implementation Status

### ✅ Implemented

#### 1. RRULE Expansion Engine

**Location**: `src/component/rfc/ical/expand/rrule.rs`

**Current State**: Full RRULE expansion implemented using the `rrule` crate (v0.14.0).

**Features Working**:
- ✅ Frequency iteration: DAILY, WEEKLY, MONTHLY, YEARLY
- ✅ BYxxx rule application: BYDAY, BYMONTH, BYMONTHDAY, etc.
- ✅ COUNT limiting: Stop after N occurrences
- ✅ UNTIL limiting: Stop after specific date
- ✅ EXDATE exclusion: Remove specific dates
- ✅ RDATE inclusion: Add specific dates
- ✅ Performance limiting: 1000 occurrences max per event

#### 2. `cal_occurrence` Table

**Location**: Schema exists in `src/component/db/schema.rs` (lines 143-157)

**Current State**: Table created and populated on PUT.

**Evidence**: `expand_and_store_occurrences()` called in `src/component/caldav/service/object.rs`

#### 3. IANA Timezone Resolution

**Location**: `src/component/rfc/ical/expand/timezone.rs`

**Current State**: `TimeZoneResolver` uses `chrono-tz` crate for IANA timezone lookup.

**How It Works**:
```rust
let tz: Tz = "America/New_York".parse()?;
let utc_time = local_time.with_timezone(&tz);
```

**Limitation**: Only works when TZID exactly matches an IANA name. Does NOT parse VTIMEZONE blocks.

---

### ❌ NOT Implemented

#### VTIMEZONE Component Parsing — **HIGH PRIORITY**

**Current State**: No parsing of VTIMEZONE components.

**What's Missing**:
- [ ] STANDARD/DAYLIGHT block parsing
- [ ] TZOFFSETFROM/TZOFFSETTO extraction
- [ ] DST transition date calculation
- [ ] RRULE support within VTIMEZONE blocks
- [ ] Mapping custom TZID to parsed timezone

**Impact**: Events with custom VTIMEZONE definitions (common from Outlook, older clients) have incorrect UTC times in `cal_index.dtstart_utc`.

**RFC Violation**: RFC 5545 §3.6.5 requires VTIMEZONE processing for referenced TZIDs.

**Example Failure Case**:
```ical
BEGIN:VTIMEZONE
TZID:Custom Eastern Time
BEGIN:STANDARD
DTSTART:20071104T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
TZNAME:EST
END:STANDARD
...
END:VTIMEZONE

BEGIN:VEVENT
DTSTART;TZID=Custom Eastern Time:20250120T090000
...
END:VEVENT
```

This event would fail to resolve the timezone because "Custom Eastern Time" is not an IANA name.

---

### ⚠️ Partially Implemented

#### RECURRENCE-ID Exception Handling

**Current State**: Parsing exists but full replacement logic needs verification.

**What Works**:
- RECURRENCE-ID property is parsed
- Exception instances identified

**Unclear**:
- Whether exception replaces the occurrence in query results
- Whether `cal_occurrence` properly reflects exceptions

---

## RFC Compliance

| RFC Requirement | Status | Notes |
|-----------------|--------|-------|
| RFC 5545 §3.3.10: RRULE property | ✅ | Via rrule crate |
| RFC 5545 §3.8.5.3: EXDATE | ✅ | Exclusions applied |
| RFC 5545 §3.8.5.2: RDATE | ✅ | Additions included |
| RFC 5545 §3.6.5: VTIMEZONE | ❌ | NOT parsed |
| RFC 5545 §3.8.4.4: RECURRENCE-ID | ⚠️ | Parsed, full logic unclear |
| RFC 4791 §9.6: Time-range queries | ✅ | Uses cal_occurrence |

---

## Effort Estimate

| Task | Effort |
|------|--------|
| Implement VTIMEZONE parser | 5-7 days |
| VTIMEZONE RRULE DST transitions | 2-3 days |
| Verify RECURRENCE-ID exception flow | 1-2 days |
| Add comprehensive recurrence tests | 2-3 days |

**Total**: ~2 weeks to complete Phase 5 properly
        let shifted = local_time + Duration::hours(1);
        tz.from_local_datetime(&shifted).single().ok_or(Error::InvalidTime)?
    }
    LocalResult::Single(dt) => dt,
    LocalResult::Ambiguous(dt1, dt2) => {
        // DST fold: time occurs twice
        // Use TZOFFSETFROM/TZOFFSETTO to disambiguate
        // Default to first occurrence (before DST shift)
        dt1
    }
}
```

**Estimated Effort**: 2-3 days

---

#### 5. `expand` and `limit-recurrence-set` Handling — ✅ **IMPLEMENTED**

**Current State**: Fully implemented in calendar-query report handler.

**Implementation Details** (RFC 4791 §9.6.4 and §9.6.5):
- ✅ `<C:expand start="..." end="..."/>`: Returns expanded instances instead of master event
  - Each occurrence becomes a separate `<D:response>` with unique href (master + occurrence timestamp)
  - RRULE/EXDATE/RDATE properties removed from expanded instances
  - DTSTART/DTEND adjusted to occurrence times
  - RECURRENCE-ID added for exception instances
- ✅ `<C:limit-recurrence-set start="..." end="..."/>`: Limits recurrence range
  - Only generates occurrences within specified range
  - Returns master event (not expanded)
  - Reduces payload size for large recurrence sets

**Files**:
- `src/component/rfc/dav/core/report.rs`: Added `RecurrenceExpansion` enum
- `src/component/rfc/dav/parse/report.rs`: Parse `<C:expand>` and `<C:limit-recurrence-set>`
- `src/component/caldav/service/report.rs`: Expansion logic in `execute_calendar_query`

**RFC Compliance**: Full compliance with RFC 4791 §9.6.4-5.

---

#### 6. Recurrence-ID Matching — **MEDIUM PRIORITY**

**Current State**: No logic to match override instances to master events.

**What's Missing**:
- RECURRENCE-ID property parsing
- Master event lookup for overrides
- Occurrence replacement logic (override replaces specific occurrence)
- `cal_index.recurrence_id_utc` column usage

**Impact**: Exception instances (modified single occurrences) are not associated with their master event. Queries may return duplicate or missing occurrences.

**Recommended Implementation**:
1. When PUT receives an event with RECURRENCE-ID:
   - Parse RECURRENCE-ID value (date-time of original occurrence)
   - Lookup master event by UID
   - Store in `cal_occurrence` with `is_exception=TRUE`
   - Set `recurrence_id_utc` to RECURRENCE-ID value
2. When querying:
   - Generate occurrences from master event
   - Replace occurrences where `recurrence_id_utc` matches exception instance
   - Remove replaced occurrence from master set

**Estimated Effort**: 2-3 days

---

## Recommended Implementation Path

### Step 1: Create `cal_occurrence` table (1 day)
- Write migration
- Update schema
- Add models and query functions

### Step 2: Integrate RRULE expansion library (1-2 weeks)
- Evaluate `rrule` crate
- Implement `expand_rrule()` function
- Add comprehensive unit tests (RFC 5545 examples)

### Step 3: Implement timezone resolution (3-5 days)
- Integrate `chrono-tz` for IANA timezones
- Implement `convert_to_utc()` with DST handling
- Add timezone cache

### Step 4: Wire expansion into PUT handler (2-3 days)
- On PUT:
  1. Parse iCalendar
  2. Extract RRULE, EXDATE, RDATE
  3. Expand occurrences (with max limit, e.g., 1000)
  4. Populate `cal_occurrence` table
  5. Set `cal_index.dtstart_utc` to UTC-converted time

### Step 5: Update calendar-query filter (2-3 days)
- Use `cal_occurrence` table for time-range queries on recurring events
- Fallback to `cal_index` for non-recurring events

### Step 6: Implement expand/limit-recurrence-set (3-4 days)
- Parse modifiers from calendar-query
- Generate expanded responses

### Step 7: Implement RECURRENCE-ID matching (2-3 days)
- Handle exception instances
- Replace occurrences in query results

**Total Estimated Effort**: 4-6 weeks

---

## RFC Compliance

| RFC Requirement | Status | Impact |
|-----------------|--------|--------|
| RFC 5545 §3.8.5: RRULE | ❌ Missing | Recurring events non-functional |
| RFC 5545 §3.3.10: RECUR value | ❌ Missing | No expansion logic |
| RFC 4791 §9.9: Time-range + recurrence | ❌ Missing | Queries fail for recurring events |
| RFC 5545 §3.6.5: VTIMEZONE | ❌ Missing | Timezone-aware events broken |
| RFC 4791 §4.1: VTIMEZONE inclusion | ❌ Missing | No TZID validation |
| RFC 7986 §5.7: RRULE extensions | ❌ Missing | No extension support (RSCALE, etc.) |
| RFC 4791 §9.6.4: expand modifier | ❌ Missing | Clients must expand locally |
| RFC 4791 §9.6.5: limit-recurrence-set | ❌ Missing | No recurrence limiting |

**Compliance Score**: 0/8 required features (0%)

---

## Next Steps

### Critical Path (Start Immediately)

1. **Create `cal_occurrence` table** — 1 day
2. **Integrate `rrule` crate** — 1-2 weeks
3. **Implement timezone resolution** — 3-5 days
4. **Wire expansion into PUT handler** — 2-3 days
5. **Update calendar-query filters** — 2-3 days

### Follow-Up

6. **Implement expand/limit-recurrence-set** — 3-4 days
7. **Implement RECURRENCE-ID matching** — 2-3 days

---

## Dependencies

**Blocks**: 
- Phase 4 (Query Reports) — Time-range filtering incomplete without recurrence
- Phase 7 (Free-Busy) — Requires recurring event expansion

**Depends On**: Phase 2 (Database Operations) — Fully implemented

---

## Next Phase: Phase 6

**Focus**: Synchronization (sync-collection report, change detection, tombstones)

**Status**: ❌ **STUB ONLY (10%)**
