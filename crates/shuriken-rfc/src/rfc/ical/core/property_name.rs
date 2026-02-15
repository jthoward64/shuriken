//! iCalendar property name types (RFC 5545 §3.8).

use super::normalized::NormalizedValue;
use crate::define_names;

define_names! {
    /// iCalendar property names (RFC 5545).
    ///
    /// Normalized enum representation of property names with case-insensitive
    /// matching. Unknown property names are represented as `None` in the
    /// `NormalizedValue::parsed` field.
    pub ICalPropertyName,

    // Calendar properties (RFC 5545 §3.7)
    Calscale => "CALSCALE",
    Method => "METHOD",
    Prodid => "PRODID",
    Version => "VERSION",

    // Component properties (RFC 5545 §3.8.1)
    Attach => "ATTACH",
    Categories => "CATEGORIES",
    Class => "CLASS",
    Comment => "COMMENT",
    Description => "DESCRIPTION",
    Geo => "GEO",
    Location => "LOCATION",
    PercentComplete => "PERCENT-COMPLETE",
    Priority => "PRIORITY",
    Resources => "RESOURCES",
    Status => "STATUS",
    Summary => "SUMMARY",

    // Date and time properties (RFC 5545 §3.8.2)
    Completed => "COMPLETED",
    Dtend => "DTEND",
    Due => "DUE",
    Dtstart => "DTSTART",
    Duration => "DURATION",
    Freebusy => "FREEBUSY",
    Transp => "TRANSP",

    // Timezone properties (RFC 5545 §3.8.3)
    Tzid => "TZID",
    Tzname => "TZNAME",
    Tzoffsetfrom => "TZOFFSETFROM",
    Tzoffsetto => "TZOFFSETTO",
    Tzurl => "TZURL",

    // Relationship properties (RFC 5545 §3.8.4)
    Attendee => "ATTENDEE",
    Contact => "CONTACT",
    Organizer => "ORGANIZER",
    RecurrenceId => "RECURRENCE-ID",
    RelatedTo => "RELATED-TO",
    Url => "URL",
    Uid => "UID",

    // Recurrence properties (RFC 5545 §3.8.5)
    Exdate => "EXDATE",
    Rdate => "RDATE",
    Rrule => "RRULE",

    // Alarm properties (RFC 5545 §3.8.6)
    Action => "ACTION",
    Repeat => "REPEAT",
    Trigger => "TRIGGER",

    // Change management properties (RFC 5545 §3.8.7)
    Created => "CREATED",
    Dtstamp => "DTSTAMP",
    LastModified => "LAST-MODIFIED",
    Sequence => "SEQUENCE",

    // RFC 7986 extensions
    Color => "COLOR",
    Conference => "CONFERENCE",
    Image => "IMAGE",
    Name => "NAME",
    RefreshInterval => "REFRESH-INTERVAL",
    Source => "SOURCE",
}

/// Type alias for property names with case-preserving original value.
pub type PropertyName = NormalizedValue<ICalPropertyName>;

impl PropertyName {
    /// Returns the known property name variant, if recognized.
    #[must_use]
    pub fn known(&self) -> Option<ICalPropertyName> {
        self.parsed
    }

    /// Returns whether this is a known standard property name.
    #[must_use]
    pub fn is_known(&self) -> bool {
        self.parsed.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn property_name_case_insensitive() {
        let name1 = PropertyName::new("DTSTART");
        let name2 = PropertyName::new("dtstart");
        let name3 = PropertyName::new("DtStArT");

        assert_eq!(name1, name2);
        assert_eq!(name2, name3);
        assert_eq!(name1.as_str(), "DTSTART");
        assert_eq!(name2.as_str(), "dtstart");
    }

    #[test]
    fn property_name_unknown() {
        let name = PropertyName::new("X-CUSTOM-PROP");
        assert!(!name.is_known());
        assert_eq!(name.known(), None);
        assert_eq!(name.as_str(), "X-CUSTOM-PROP");
    }

    #[test]
    fn property_name_known() {
        let name = PropertyName::new("SUMMARY");
        assert!(name.is_known());
        assert_eq!(name.known(), Some(ICalPropertyName::Summary));
    }
}
