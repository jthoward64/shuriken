# 8. Recurrence Expansion

## 8.1 RRULE Evaluation Algorithm (RFC 5545 §3.3.10)

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

## 8.2 Invalid Instance Handling

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

## 8.3 Recurrence Override Handling

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

## 8.4 Time-Range Query with Recurrence

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

## 8.5 Limit and Expand Options (RFC 4791 §9.6)

| Element | Behavior |
|---------|----------|
| `<limit-recurrence-set start="..." end="..."/>` | Return master + overrides, but only those affecting the range; RRULE preserved |
| `<expand start="..." end="..."/>` | Return individual instances as standalone VEVENTs; RRULE removed; RECURRENCE-ID added |

**Expand Output**:
- Each returned VEVENT has its own DTSTART/DTEND
- RRULE, RDATE, EXDATE removed from each instance
- RECURRENCE-ID added to identify which occurrence

## 8.6 Pre-Expansion Cache (cal_occurrence)

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
