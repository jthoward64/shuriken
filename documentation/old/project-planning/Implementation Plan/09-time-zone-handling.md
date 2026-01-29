# 9. Time Zone Handling

## 9.1 VTIMEZONE Components

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

## 9.2 UTC Conversion

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

## 9.3 IANA vs Windows Timezone IDs

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

## 9.4 CALDAV:calendar-timezone Property

Collection-level property specifying default timezone for:
- Floating time interpretation in queries
- New events without explicit timezone

```xml
<C:calendar-timezone>BEGIN:VCALENDAR...END:VCALENDAR</C:calendar-timezone>
```

---
