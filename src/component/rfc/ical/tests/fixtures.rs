//! RFC 5545 iCalendar test fixtures.
//!
//! Examples taken from RFC 5545 Appendix A and common use cases.

/// RFC 5545 §A.1 - Minimal VEVENT
pub const VEVENT_MINIMAL: &str = "\
BEGIN:VCALENDAR\r\n\
VERSION:2.0\r\n\
PRODID:-//Example//Example//EN\r\n\
BEGIN:VEVENT\r\n\
UID:19970901T130000Z-123401@example.com\r\n\
DTSTAMP:19970901T130000Z\r\n\
DTSTART:19970903T163000Z\r\n\
DTEND:19970903T190000Z\r\n\
SUMMARY:Annual Employee Review\r\n\
END:VEVENT\r\n\
END:VCALENDAR\r\n";

/// RFC 5545 §A.1 - Recurring event example
pub const VEVENT_RECURRING: &str = "\
BEGIN:VCALENDAR\r\n\
VERSION:2.0\r\n\
PRODID:-//Example//Example//EN\r\n\
BEGIN:VEVENT\r\n\
UID:19970901T130000Z-123402@example.com\r\n\
DTSTAMP:19970901T130000Z\r\n\
DTSTART:19970905T090000Z\r\n\
DTEND:19970905T100000Z\r\n\
SUMMARY:Weekly Team Meeting\r\n\
RRULE:FREQ=WEEKLY;COUNT=10;BYDAY=FR\r\n\
END:VEVENT\r\n\
END:VCALENDAR\r\n";

/// RFC 5545 §A.2 - Basic VTODO
pub const VTODO_BASIC: &str = "\
BEGIN:VCALENDAR\r\n\
VERSION:2.0\r\n\
PRODID:-//Example//Example//EN\r\n\
BEGIN:VTODO\r\n\
UID:19970901T130000Z-123403@example.com\r\n\
DTSTAMP:19970901T130000Z\r\n\
DUE:19970903T090000Z\r\n\
SUMMARY:Submit Tax Returns\r\n\
STATUS:NEEDS-ACTION\r\n\
END:VTODO\r\n\
END:VCALENDAR\r\n";

/// RFC 5545 §A.3 - Basic VJOURNAL
pub const VJOURNAL_BASIC: &str = "\
BEGIN:VCALENDAR\r\n\
VERSION:2.0\r\n\
PRODID:-//Example//Example//EN\r\n\
BEGIN:VJOURNAL\r\n\
UID:19970901T130000Z-123404@example.com\r\n\
DTSTAMP:19970901T130000Z\r\n\
DTSTART:19970317T000000Z\r\n\
SUMMARY:Staff meeting minutes\r\n\
DESCRIPTION:Meeting notes from the staff meeting.\r\n\
END:VJOURNAL\r\n\
END:VCALENDAR\r\n";

/// RFC 5545 §A.4 - VFREEBUSY request
pub const VFREEBUSY_REQUEST: &str = "\
BEGIN:VCALENDAR\r\n\
VERSION:2.0\r\n\
PRODID:-//Example//Example//EN\r\n\
BEGIN:VFREEBUSY\r\n\
UID:19970901T130000Z-123405@example.com\r\n\
DTSTAMP:19970901T130000Z\r\n\
DTSTART:19970901T090000Z\r\n\
DTEND:19970901T170000Z\r\n\
END:VFREEBUSY\r\n\
END:VCALENDAR\r\n";

/// VEVENT with VALARM
pub const VEVENT_WITH_ALARM: &str = "\
BEGIN:VCALENDAR\r\n\
VERSION:2.0\r\n\
PRODID:-//Example//Example//EN\r\n\
BEGIN:VEVENT\r\n\
UID:19970901T130000Z-123406@example.com\r\n\
DTSTAMP:19970901T130000Z\r\n\
DTSTART:19970903T163000Z\r\n\
DTEND:19970903T190000Z\r\n\
SUMMARY:Meeting with reminder\r\n\
BEGIN:VALARM\r\n\
ACTION:DISPLAY\r\n\
TRIGGER:-PT15M\r\n\
DESCRIPTION:Reminder: Meeting in 15 minutes\r\n\
END:VALARM\r\n\
END:VEVENT\r\n\
END:VCALENDAR\r\n";

/// VEVENT with VTIMEZONE
pub const VEVENT_WITH_TIMEZONE: &str = "\
BEGIN:VCALENDAR\r\n\
VERSION:2.0\r\n\
PRODID:-//Example//Example//EN\r\n\
BEGIN:VTIMEZONE\r\n\
TZID:America/New_York\r\n\
BEGIN:STANDARD\r\n\
DTSTART:19971026T020000\r\n\
TZOFFSETFROM:-0400\r\n\
TZOFFSETTO:-0500\r\n\
TZNAME:EST\r\n\
END:STANDARD\r\n\
BEGIN:DAYLIGHT\r\n\
DTSTART:19980301T020000\r\n\
TZOFFSETFROM:-0500\r\n\
TZOFFSETTO:-0400\r\n\
TZNAME:EDT\r\n\
END:DAYLIGHT\r\n\
END:VTIMEZONE\r\n\
BEGIN:VEVENT\r\n\
UID:19970901T130000Z-123407@example.com\r\n\
DTSTAMP:19970901T130000Z\r\n\
DTSTART;TZID=America/New_York:19970903T163000\r\n\
DTEND;TZID=America/New_York:19970903T190000\r\n\
SUMMARY:Conference Call\r\n\
END:VEVENT\r\n\
END:VCALENDAR\r\n";

/// VEVENT with attendees
pub const VEVENT_WITH_ATTENDEES: &str = "\
BEGIN:VCALENDAR\r\n\
VERSION:2.0\r\n\
PRODID:-//Example//Example//EN\r\n\
BEGIN:VEVENT\r\n\
UID:19970901T130000Z-123408@example.com\r\n\
DTSTAMP:19970901T130000Z\r\n\
DTSTART:19970903T163000Z\r\n\
DTEND:19970903T190000Z\r\n\
SUMMARY:Project Meeting\r\n\
ORGANIZER:mailto:boss@example.com\r\n\
ATTENDEE;PARTSTAT=ACCEPTED:mailto:employee1@example.com\r\n\
ATTENDEE;PARTSTAT=TENTATIVE:mailto:employee2@example.com\r\n\
END:VEVENT\r\n\
END:VCALENDAR\r\n";

/// All-day event
pub const VEVENT_ALL_DAY: &str = "\
BEGIN:VCALENDAR\r\n\
VERSION:2.0\r\n\
PRODID:-//Example//Example//EN\r\n\
BEGIN:VEVENT\r\n\
UID:19970901T130000Z-123409@example.com\r\n\
DTSTAMP:19970901T130000Z\r\n\
DTSTART;VALUE=DATE:19970903\r\n\
DTEND;VALUE=DATE:19970904\r\n\
SUMMARY:Company Holiday\r\n\
END:VEVENT\r\n\
END:VCALENDAR\r\n";

/// VEVENT with GEO
pub const VEVENT_WITH_GEO: &str = "\
BEGIN:VCALENDAR\r\n\
VERSION:2.0\r\n\
PRODID:-//Example//Example//EN\r\n\
BEGIN:VEVENT\r\n\
UID:19970901T130000Z-123410@example.com\r\n\
DTSTAMP:19970901T130000Z\r\n\
DTSTART:19970903T163000Z\r\n\
DTEND:19970903T190000Z\r\n\
SUMMARY:Office Party\r\n\
LOCATION:Main Conference Room\r\n\
GEO:37.386013;-122.082932\r\n\
END:VEVENT\r\n\
END:VCALENDAR\r\n";

/// VEVENT with EXDATE
pub const VEVENT_WITH_EXDATE: &str = "\
BEGIN:VCALENDAR\r\n\
VERSION:2.0\r\n\
PRODID:-//Example//Example//EN\r\n\
BEGIN:VEVENT\r\n\
UID:19970901T130000Z-123411@example.com\r\n\
DTSTAMP:19970901T130000Z\r\n\
DTSTART:19970905T090000Z\r\n\
DTEND:19970905T100000Z\r\n\
SUMMARY:Weekly Meeting\r\n\
RRULE:FREQ=WEEKLY;COUNT=10\r\n\
EXDATE:19970912T090000Z,19970919T090000Z\r\n\
END:VEVENT\r\n\
END:VCALENDAR\r\n";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::component::rfc::ical::parse::parse;

    #[test]
    fn parse_vevent_minimal() {
        let ical = parse(VEVENT_MINIMAL).expect("should parse");
        assert_eq!(ical.version(), Some("2.0"));
        assert_eq!(ical.events().len(), 1);
    }

    #[test]
    fn parse_vevent_recurring() {
        let ical = parse(VEVENT_RECURRING).expect("should parse");
        assert_eq!(ical.events().len(), 1);
        // Check for RRULE property
        let events = ical.events();
        let event = events[0];
        assert!(event.properties.iter().any(|p| p.name == "RRULE"));
    }

    #[test]
    fn parse_vtodo_basic() {
        let ical = parse(VTODO_BASIC).expect("should parse");
        assert_eq!(ical.todos().len(), 1);
    }

    #[test]
    fn parse_vjournal_basic() {
        let ical = parse(VJOURNAL_BASIC).expect("should parse");
        assert_eq!(ical.journals().len(), 1);
    }

    #[test]
    fn parse_vfreebusy_request() {
        let ical = parse(VFREEBUSY_REQUEST).expect("should parse");
        assert_eq!(ical.freebusy().len(), 1);
    }

    #[test]
    fn parse_vevent_with_alarm() {
        let ical = parse(VEVENT_WITH_ALARM).expect("should parse");
        let events = ical.events();
        let event = events[0];
        assert_eq!(event.children.len(), 1);
    }

    #[test]
    fn parse_vevent_with_timezone() {
        let ical = parse(VEVENT_WITH_TIMEZONE).expect("should parse");
        assert_eq!(ical.timezones().len(), 1);
        assert_eq!(ical.events().len(), 1);
    }

    #[test]
    fn parse_vevent_with_attendees() {
        let ical = parse(VEVENT_WITH_ATTENDEES).expect("should parse");
        let events = ical.events();
        let event = events[0];
        let attendees: Vec<_> = event
            .properties
            .iter()
            .filter(|p| p.name == "ATTENDEE")
            .collect();
        assert_eq!(attendees.len(), 2);
    }

    #[test]
    fn parse_vevent_all_day() {
        let ical = parse(VEVENT_ALL_DAY).expect("should parse");
        let events = ical.events();
        let event = events[0];
        // Check for VALUE=DATE parameter
        let dtstart = event
            .properties
            .iter()
            .find(|p| p.name == "DTSTART")
            .expect("should have DTSTART");
        assert!(dtstart
            .params
            .iter()
            .any(|p| p.name == "VALUE" && p.value() == Some("DATE")));
    }

    #[test]
    fn parse_vevent_with_geo() {
        let ical = parse(VEVENT_WITH_GEO).expect("should parse");
        let events = ical.events();
        let event = events[0];
        assert!(event.properties.iter().any(|p| p.name == "GEO"));
    }

    #[test]
    fn parse_vevent_with_exdate() {
        let ical = parse(VEVENT_WITH_EXDATE).expect("should parse");
        let events = ical.events();
        let event = events[0];
        assert!(event.properties.iter().any(|p| p.name == "EXDATE"));
    }
}
