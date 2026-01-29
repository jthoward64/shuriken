//! Round-trip parsing and serialization tests for iCalendar.
//!
//! These tests verify that iCalendar documents can be parsed and serialized back
//! without losing structural information.

use super::fixtures::*;
use crate::rfc::ical::build::serialize;
use crate::rfc::ical::parse::parse;

/// Parse an iCalendar, serialize it, then parse again and compare.
fn round_trip(input: &str) -> Result<(), String> {
    // First parse
    let ical1 = parse(input).map_err(|e| format!("First parse failed: {e}"))?;

    // Serialize
    let serialized = serialize(&ical1);

    // Second parse
    let ical2 =
        parse(&serialized).map_err(|e| format!("Second parse failed: {e}\n{serialized}"))?;

    // Compare versions
    if ical1.version() != ical2.version() {
        return Err(format!(
            "Version mismatch: {:?} vs {:?}",
            ical1.version(),
            ical2.version()
        ));
    }

    // Compare component counts
    if ical1.events().len() != ical2.events().len() {
        return Err(format!(
            "Event count mismatch: {} vs {}",
            ical1.events().len(),
            ical2.events().len()
        ));
    }

    if ical1.todos().len() != ical2.todos().len() {
        return Err(format!(
            "Todo count mismatch: {} vs {}",
            ical1.todos().len(),
            ical2.todos().len()
        ));
    }

    if ical1.journals().len() != ical2.journals().len() {
        return Err(format!(
            "Journal count mismatch: {} vs {}",
            ical1.journals().len(),
            ical2.journals().len()
        ));
    }

    if ical1.freebusy().len() != ical2.freebusy().len() {
        return Err(format!(
            "Freebusy count mismatch: {} vs {}",
            ical1.freebusy().len(),
            ical2.freebusy().len()
        ));
    }

    if ical1.timezones().len() != ical2.timezones().len() {
        return Err(format!(
            "Timezone count mismatch: {} vs {}",
            ical1.timezones().len(),
            ical2.timezones().len()
        ));
    }

    Ok(())
}

#[test]
fn round_trip_vevent_minimal() {
    round_trip(VEVENT_MINIMAL).expect("round trip should succeed");
}

#[test]
fn round_trip_vevent_recurring() {
    round_trip(VEVENT_RECURRING).expect("round trip should succeed");
}

#[test]
fn round_trip_vtodo_basic() {
    round_trip(VTODO_BASIC).expect("round trip should succeed");
}

#[test]
fn round_trip_vjournal_basic() {
    round_trip(VJOURNAL_BASIC).expect("round trip should succeed");
}

#[test]
fn round_trip_vfreebusy_request() {
    round_trip(VFREEBUSY_REQUEST).expect("round trip should succeed");
}

#[test]
fn round_trip_vevent_with_alarm() {
    round_trip(VEVENT_WITH_ALARM).expect("round trip should succeed");
}

#[test]
fn round_trip_vevent_with_alarm_repeat() {
    round_trip(VEVENT_WITH_ALARM_REPEAT).expect("round trip should succeed");
}

#[test]
fn round_trip_vtodo_with_alarm_audio() {
    round_trip(VTODO_WITH_ALARM_AUDIO).expect("round trip should succeed");
}

#[test]
fn round_trip_vevent_with_timezone() {
    round_trip(VEVENT_WITH_TIMEZONE).expect("round trip should succeed");
}

#[test]
fn round_trip_vevent_with_attendees() {
    round_trip(VEVENT_WITH_ATTENDEES).expect("round trip should succeed");
}

#[test]
fn round_trip_vevent_all_day() {
    round_trip(VEVENT_ALL_DAY).expect("round trip should succeed");
}

#[test]
fn round_trip_vevent_with_geo() {
    round_trip(VEVENT_WITH_GEO).expect("round trip should succeed");
}

#[test]
fn round_trip_vevent_with_exdate() {
    round_trip(VEVENT_WITH_EXDATE).expect("round trip should succeed");
}

#[test]
fn round_trip_long_description() {
    let ical = format!(
        "\
BEGIN:VCALENDAR\r\n\
VERSION:2.0\r\n\
PRODID:-//Test//Test//EN\r\n\
BEGIN:VEVENT\r\n\
UID:test-long-desc@example.com\r\n\
DTSTAMP:19970901T130000Z\r\n\
DTSTART:19970903T163000Z\r\n\
SUMMARY:Long description test\r\n\
DESCRIPTION:{}\r\n\
END:VEVENT\r\n\
END:VCALENDAR\r\n",
        "A".repeat(200)
    );
    round_trip(&ical).expect("round trip should succeed");
}

#[test]
fn round_trip_escaped_characters() {
    let ical = "\
BEGIN:VCALENDAR\r\n\
VERSION:2.0\r\n\
PRODID:-//Test//Test//EN\r\n\
BEGIN:VEVENT\r\n\
UID:test-escape@example.com\r\n\
DTSTAMP:19970901T130000Z\r\n\
DTSTART:19970903T163000Z\r\n\
SUMMARY:Test\\, with\\; special\\nchars\r\n\
END:VEVENT\r\n\
END:VCALENDAR\r\n";
    round_trip(ical).expect("round trip should succeed");
}
