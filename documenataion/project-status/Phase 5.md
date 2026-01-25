# Phase 5: Recurrence & Time Zones

**Status**: ❌ **NOT IMPLEMENTED (0%)**  
**Last Updated**: 2026-01-25

---

## Overview

Phase 5 is the most critical missing piece for CalDAV functionality. It implements RRULE (recurrence rule) expansion, VTIMEZONE parsing, and UTC conversion for timezone-aware events. Without this phase, recurring calendar events are completely non-functional, and time-range queries on timezone-aware events return incorrect results.

**CRITICAL**: This phase is essential for production CalDAV. Recurring events are ubiquitous in real-world calendar usage (daily standups, weekly meetings, monthly reviews, etc.).

**Complexity**: HIGH — Recurrence expansion is algorithmically complex with many edge cases.

---

## Implementation Status

### ❌ Not Implemented

#### 1. RRULE Expansion Engine — **CRITICAL**

**Current State**: No algorithm to generate occurrence dates from RRULE.

**What's Missing**:
- [ ] **Frequency iteration**: DAILY, WEEKLY, MONTHLY, YEARLY
- [ ] **BYxxx rule application**: BYDAY, BYMONTH, BYMONTHDAY, BYHOUR, BYMINUTE, BYSECOND, etc.
  - Example: `BYDAY=MO,WE,FR` for Monday/Wednesday/Friday
  - Example: `BYMONTHDAY=1,15` for 1st and 15th of each month
- [ ] **BYSETPOS filtering**: Select specific occurrences from expanded set
  - Example: `BYSETPOS=-1` for last occurrence in set (last Friday of month)
- [ ] **COUNT limiting**: Stop after N occurrences
  - Example: `COUNT=10` generates 10 occurrences then stops
- [ ] **UNTIL limiting**: Stop after a specific date
  - Example: `UNTIL=20260630T000000Z` stops at end of June 2026
- [ ] **EXDATE exclusion**: Remove specific dates from recurrence set
  - Example: `EXDATE:20260104T100000Z` excludes Jan 4, 2026
- [ ] **RDATE inclusion**: Add specific dates to recurrence set
  - Example: `RDATE:20260104T100000Z` adds Jan 4, 2026
- [ ] **RECURRENCE-ID override matching**: Match exception instances to master
  - Modified single occurrence with different properties
- [ ] **WKST (week start) handling**: Configure week start day (default MO)
- [ ] **Leap year handling**: February 29 in non-leap years
- [ ] **DST transitions**: Handle time shifts during expansion

**Impact**: Recurring events are completely non-functional. Clients cannot create weekly meetings, daily reminders, or annual holidays.

**RFC Violation**: RFC 4791 §9.9 requires recurrence expansion for time-range queries. RFC 5545 §3.8.5 defines RRULE semantics.

**Recommended Implementation**:
1. **Use existing library**: Evaluate `rrule` or `icalendar-rrule` crates
   - `rrule` crate: More mature, widely used
   - `icalendar-rrule`: Integrated with `icalendar` crate
2. **Implement wrapper**: `src/component/rfc/ical/expand/mod.rs`
   ```rust
   pub fn expand_rrule(
       rrule: &str,
       dtstart: DateTime<Utc>,
       exdates: &[DateTime<Utc>],
       rdates: &[DateTime<Utc>],
       range_start: DateTime<Utc>,
       range_end: DateTime<Utc>,
       max_instances: usize,
   ) -> Result<Vec<DateTime<Utc>>, Error> {
       // Use rrule crate to expand
       // Apply EXDATE exclusions
       // Add RDATE inclusions
       // Filter to range
       // Limit to max_instances
   }
   ```
3. **Add comprehensive unit tests**:
   - RFC 5545 Appendix A examples
   - Edge cases: leap years, DST transitions, BYSETPOS
   - Invalid RRULE handling

**Estimated Effort**: 1-2 weeks

---

#### 2. `cal_occurrence` Table — **CRITICAL**

**Current State**: Table does not exist in schema.

**What's Missing**:
- Database table for caching expanded occurrences
- Indexes for efficient time-range queries
- Cascade delete on instance deletion

**Impact**: Without cached occurrences, queries must expand RRULE on every request, which is extremely expensive for large recurrence sets (e.g., daily for 10 years = 3650 occurrences).

**Recommended Table Structure**:
```sql
CREATE TABLE cal_occurrence (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    instance_id UUID NOT NULL REFERENCES dav_instance(id) ON DELETE CASCADE,
    dtstart_utc TIMESTAMPTZ NOT NULL,
    dtend_utc TIMESTAMPTZ NOT NULL,
    sequence INTEGER DEFAULT 0,  -- For iCalendar SEQUENCE property
    recurrence_id_utc TIMESTAMPTZ,  -- For exception instances
    is_exception BOOLEAN DEFAULT FALSE,  -- TRUE for RECURRENCE-ID instances
    INDEX idx_cal_occurrence_timerange (instance_id, dtstart_utc, dtend_utc),
    INDEX idx_cal_occurrence_instance (instance_id)
);

COMMENT ON TABLE cal_occurrence IS 'Expanded occurrences of recurring calendar events';
COMMENT ON COLUMN cal_occurrence.instance_id IS 'References the master event instance';
COMMENT ON COLUMN cal_occurrence.dtstart_utc IS 'Start time in UTC for this occurrence';
COMMENT ON COLUMN cal_occurrence.dtend_utc IS 'End time in UTC for this occurrence';
COMMENT ON COLUMN cal_occurrence.recurrence_id_utc IS 'RECURRENCE-ID for exception instances';
```

**Implementation Steps**:
1. Create migration: `migrations/YYYY-MM-DD-create-cal-occurrence/up.sql`
2. Update `src/component/db/schema.rs` (run `diesel migration run`)
3. Add model: `src/component/db/model/dav/occurrence.rs`
4. Add query functions: `src/component/db/query/dav/occurrence.rs`

**Estimated Effort**: 1 day

---

#### 3. VTIMEZONE Parser — **HIGH PRIORITY**

**Current State**: No parsing of VTIMEZONE components.

**What's Missing**:
- [ ] STANDARD/DAYLIGHT block parsing
- [ ] TZOFFSETFROM/TZOFFSETTO extraction
- [ ] DST transition date calculation
- [ ] RRULE support in VTIMEZONE (for recurring DST rules)
- [ ] Timezone cache (avoid re-parsing for every event)

**Impact**: Cannot convert local times to UTC for time-range queries. `cal_index.dtstart_utc` is populated incorrectly for TZID-bearing events.

**RFC Violation**: RFC 4791 §4.1 requires VTIMEZONE inclusion for every unique TZID in a calendar collection.

**Implementation Options**:

**Option A: Use `chrono-tz` crate** (RECOMMENDED)
- Pros: Uses IANA timezone database, handles DST automatically
- Cons: Doesn't parse VTIMEZONE components (must map TZID to IANA name)
- Example:
  ```rust
  use chrono_tz::Tz;
  let tz: Tz = "America/New_York".parse()?;
  let utc_time = local_time.with_timezone(&tz).with_timezone(&Utc);
  ```

**Option B: Parse VTIMEZONE components**
- Pros: RFC-compliant, supports custom timezones
- Cons: Complex DST calculation logic, must handle historical timezone changes
- Example:
  ```rust
  // Parse VTIMEZONE
  let vtimezone = parse_vtimezone(ical_str)?;
  // Extract STANDARD/DAYLIGHT rules
  let std_offset = vtimezone.standard_offset();
  let dst_offset = vtimezone.daylight_offset();
  // Calculate UTC time
  let utc_time = local_time + offset;
  ```

**Recommended Approach**: Use `chrono-tz` for IANA timezones, fall back to VTIMEZONE parsing for custom timezones.

**Implementation Files**:
- `src/component/rfc/ical/timezone/mod.rs`: Timezone resolution
- `src/component/rfc/ical/timezone/vtimezone.rs`: VTIMEZONE parser (if needed)
- `src/component/rfc/ical/timezone/cache.rs`: Timezone cache

**Estimated Effort**: 3-5 days

---

#### 4. UTC Conversion Utilities — **HIGH PRIORITY**

**Current State**: No logic to convert DATE-TIME values to UTC.

**What's Missing**:
- [ ] TZID → timezone definition lookup
- [ ] Local time → UTC conversion with DST handling
- [ ] DST gap handling (non-existent times)
  - Example: 2:30 AM on DST start day doesn't exist
  - Solution: Shift forward to 3:00 AM
- [ ] DST fold handling (ambiguous times)
  - Example: 1:30 AM on DST end day occurs twice
  - Solution: Use TZOFFSETFROM/TZOFFSETTO to disambiguate

**Impact**: `cal_index.dtstart_utc` is populated incorrectly for TZID-bearing events, causing time-range queries to fail.

**Recommended Function**:
```rust
pub fn convert_to_utc(
    local_time: NaiveDateTime,
    tzid: &str,
    vtimezones: &HashMap<String, VTimeZone>,
) -> Result<DateTime<Utc>, Error> {
    // Lookup timezone by TZID
    let tz = resolve_timezone(tzid, vtimezones)?;
    
    // Convert to UTC
    let utc_time = tz.from_local_datetime(&local_time)
        .single()  // Handle DST ambiguity
        .ok_or(Error::AmbiguousTime)?;
    
    Ok(utc_time.with_timezone(&Utc))
}
```

**DST Gap/Fold Handling**:
```rust
match tz.from_local_datetime(&local_time) {
    LocalResult::None => {
        // DST gap: time doesn't exist
        // Shift forward to next valid time
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

#### 5. `expand` and `limit-recurrence-set` Handling — **MEDIUM PRIORITY**

**Current State**: Calendar-query ignores `<C:expand>` and `<C:limit-recurrence-set>` modifiers.

**What's Missing** (RFC 4791 §9.6.4 and §9.6.5):
- `<C:expand start="..." end="..."/>`: Return expanded instances instead of master event
  - Each occurrence becomes a separate `<D:response>` with unique href (master + RECURRENCE-ID)
  - RRULE property removed from expanded instances
  - DTSTART adjusted to occurrence time
- `<C:limit-recurrence-set start="..." end="..."/>`: Limit recurrence range
  - Only generate occurrences within specified range
  - Reduces payload size for large recurrence sets

**Impact**: Clients requesting expanded output receive unexpanded master events, requiring client-side expansion.

**Recommended Implementation**:
1. Parse `<C:expand>` and `<C:limit-recurrence-set>` from calendar-query request
2. If `<C:expand>` present:
   - Generate occurrences for each matching event
   - Build separate `<D:response>` for each occurrence
   - Adjust DTSTART/DTEND to occurrence times
   - Remove RRULE/EXDATE/RDATE properties
3. If `<C:limit-recurrence-set>` present:
   - Filter occurrences to specified range
   - Return master event with limited RRULE

**Estimated Effort**: 3-4 days

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
