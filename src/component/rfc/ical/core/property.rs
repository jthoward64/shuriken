//! iCalendar property and content line types (RFC 5545 §3.1, §3.8).

use super::{Parameter, Value};

/// A raw content line as parsed from iCalendar text.
///
/// This is the low-level representation before value type resolution.
/// Preserves the original raw value for round-trip fidelity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContentLine {
    /// Property name (normalized to uppercase).
    pub name: String,
    /// Parameters in order of appearance.
    pub params: Vec<Parameter>,
    /// Raw value string (after unfolding, before unescaping).
    pub raw_value: String,
}

impl ContentLine {
    /// Creates a new content line.
    #[must_use]
    pub fn new(name: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            name: name.into().to_ascii_uppercase(),
            params: Vec::new(),
            raw_value: value.into(),
        }
    }

    /// Creates a content line with parameters.
    #[must_use]
    pub fn with_params(
        name: impl Into<String>,
        params: Vec<Parameter>,
        value: impl Into<String>,
    ) -> Self {
        Self {
            name: name.into().to_ascii_uppercase(),
            params,
            raw_value: value.into(),
        }
    }

    /// Returns the parameter with the given name.
    #[must_use]
    pub fn get_param(&self, name: &str) -> Option<&Parameter> {
        let name_upper = name.to_ascii_uppercase();
        self.params.iter().find(|p| p.name == name_upper)
    }

    /// Returns the value of a parameter.
    #[must_use]
    pub fn get_param_value(&self, name: &str) -> Option<&str> {
        let p = self.get_param(name)?;
        p.value()
    }

    /// Returns whether this content line has a parameter with the given name.
    #[must_use]
    pub fn has_param(&self, name: &str) -> bool {
        self.get_param(name).is_some()
    }

    /// Returns the VALUE parameter if present.
    #[must_use]
    pub fn value_type(&self) -> Option<&str> {
        self.get_param_value("VALUE")
    }

    /// Returns the TZID parameter if present.
    #[must_use]
    pub fn tzid(&self) -> Option<&str> {
        self.get_param_value("TZID")
    }
}

/// A fully parsed iCalendar property.
///
/// Contains the parsed value along with the original raw value
/// for round-trip fidelity.
#[derive(Debug, Clone, PartialEq)]
pub struct Property {
    /// Property name (normalized to uppercase).
    pub name: String,
    /// Parameters in order of appearance.
    pub params: Vec<Parameter>,
    /// Parsed value.
    pub value: Value,
    /// Original raw value string (for round-trip).
    pub raw_value: String,
}

impl Property {
    /// Creates a property with a text value.
    #[must_use]
    pub fn text(name: impl Into<String>, value: impl Into<String>) -> Self {
        let value_str = value.into();
        Self {
            name: name.into().to_ascii_uppercase(),
            params: Vec::new(),
            value: Value::Text(value_str.clone()),
            raw_value: value_str,
        }
    }

    /// Creates a property with an integer value.
    #[must_use]
    pub fn integer(name: impl Into<String>, value: i32) -> Self {
        Self {
            name: name.into().to_ascii_uppercase(),
            params: Vec::new(),
            value: Value::Integer(value),
            raw_value: value.to_string(),
        }
    }

    /// Creates a property with a datetime value.
    #[must_use]
    pub fn datetime(name: impl Into<String>, dt: super::DateTime) -> Self {
        let raw = dt.to_string();
        Self {
            name: name.into().to_ascii_uppercase(),
            params: Vec::new(),
            value: Value::DateTime(dt),
            raw_value: raw,
        }
    }

    /// Creates a property with a date value.
    #[must_use]
    pub fn date(name: impl Into<String>, d: super::Date) -> Self {
        let raw = d.to_string();
        Self {
            name: name.into().to_ascii_uppercase(),
            params: vec![Parameter::value_type("DATE")],
            value: Value::Date(d),
            raw_value: raw,
        }
    }

    /// Creates a property with a duration value.
    #[must_use]
    pub fn duration(name: impl Into<String>, d: super::Duration) -> Self {
        let raw = d.to_string();
        Self {
            name: name.into().to_ascii_uppercase(),
            params: Vec::new(),
            value: Value::Duration(d),
            raw_value: raw,
        }
    }

    /// Creates a property from a content line with an unparsed value.
    #[must_use]
    pub fn from_content_line(cl: ContentLine) -> Self {
        Self {
            name: cl.name,
            params: cl.params,
            value: Value::Unknown(cl.raw_value.clone()),
            raw_value: cl.raw_value,
        }
    }

    /// Returns the parameter with the given name.
    #[must_use]
    pub fn get_param(&self, name: &str) -> Option<&Parameter> {
        let name_upper = name.to_ascii_uppercase();
        self.params.iter().find(|p| p.name == name_upper)
    }

    /// Returns the value of a parameter.
    #[must_use]
    pub fn get_param_value(&self, name: &str) -> Option<&str> {
        let p = self.get_param(name)?;
        p.value()
    }

    /// Adds a parameter to this property.
    pub fn add_param(&mut self, param: Parameter) {
        self.params.push(param);
    }

    /// Sets a parameter, replacing any existing parameter with the same name.
    pub fn set_param(&mut self, param: Parameter) {
        self.params.retain(|p| p.name != param.name);
        self.params.push(param);
    }

    /// Returns the value as text if it is a text value.
    #[must_use]
    pub fn as_text(&self) -> Option<&str> {
        self.value.as_text()
    }

    /// Returns the value as an integer if it is an integer value.
    #[must_use]
    pub fn as_integer(&self) -> Option<i32> {
        self.value.as_integer()
    }

    /// Returns the value as a datetime if it is a datetime value.
    #[must_use]
    pub fn as_datetime(&self) -> Option<&super::DateTime> {
        self.value.as_datetime()
    }

    /// Returns the value as a date if it is a date value.
    #[must_use]
    pub fn as_date(&self) -> Option<&super::Date> {
        self.value.as_date()
    }

    /// Returns the value as a duration if it is a duration value.
    #[must_use]
    pub fn as_duration(&self) -> Option<&super::Duration> {
        self.value.as_duration()
    }
}

/// Common property names as constants.
#[expect(dead_code)]
pub mod names {
    // Calendar properties
    pub const CALSCALE: &str = "CALSCALE";
    pub const METHOD: &str = "METHOD";
    pub const PRODID: &str = "PRODID";
    pub const VERSION: &str = "VERSION";

    // Calendar component properties
    pub const ATTACH: &str = "ATTACH";
    pub const CATEGORIES: &str = "CATEGORIES";
    pub const CLASS: &str = "CLASS";
    pub const COMMENT: &str = "COMMENT";
    pub const DESCRIPTION: &str = "DESCRIPTION";
    pub const GEO: &str = "GEO";
    pub const LOCATION: &str = "LOCATION";
    pub const PERCENT_COMPLETE: &str = "PERCENT-COMPLETE";
    pub const PRIORITY: &str = "PRIORITY";
    pub const RESOURCES: &str = "RESOURCES";
    pub const STATUS: &str = "STATUS";
    pub const SUMMARY: &str = "SUMMARY";

    // Date and time properties
    pub const COMPLETED: &str = "COMPLETED";
    pub const DTEND: &str = "DTEND";
    pub const DUE: &str = "DUE";
    pub const DTSTART: &str = "DTSTART";
    pub const DURATION: &str = "DURATION";
    pub const FREEBUSY: &str = "FREEBUSY";
    pub const TRANSP: &str = "TRANSP";

    // Timezone properties
    pub const TZID: &str = "TZID";
    pub const TZNAME: &str = "TZNAME";
    pub const TZOFFSETFROM: &str = "TZOFFSETFROM";
    pub const TZOFFSETTO: &str = "TZOFFSETTO";
    pub const TZURL: &str = "TZURL";

    // Relationship properties
    pub const ATTENDEE: &str = "ATTENDEE";
    pub const CONTACT: &str = "CONTACT";
    pub const ORGANIZER: &str = "ORGANIZER";
    pub const RECURRENCE_ID: &str = "RECURRENCE-ID";
    pub const RELATED_TO: &str = "RELATED-TO";
    pub const URL: &str = "URL";
    pub const UID: &str = "UID";

    // Recurrence properties
    pub const EXDATE: &str = "EXDATE";
    pub const RDATE: &str = "RDATE";
    pub const RRULE: &str = "RRULE";

    // Alarm properties
    pub const ACTION: &str = "ACTION";
    pub const REPEAT: &str = "REPEAT";
    pub const TRIGGER: &str = "TRIGGER";

    // Change management properties
    pub const CREATED: &str = "CREATED";
    pub const DTSTAMP: &str = "DTSTAMP";
    pub const LAST_MODIFIED: &str = "LAST-MODIFIED";
    pub const SEQUENCE: &str = "SEQUENCE";

    // RFC 7986 extensions
    pub const COLOR: &str = "COLOR";
    pub const CONFERENCE: &str = "CONFERENCE";
    pub const IMAGE: &str = "IMAGE";
    pub const NAME: &str = "NAME";
    pub const REFRESH_INTERVAL: &str = "REFRESH-INTERVAL";
    pub const SOURCE: &str = "SOURCE";
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_line_get_param() {
        let cl = ContentLine::with_params(
            "DTSTART",
            vec![Parameter::tzid("America/New_York")],
            "20260123T120000",
        );
        assert_eq!(cl.tzid(), Some("America/New_York"));
        assert!(cl.has_param("TZID"));
        assert!(!cl.has_param("VALUE"));
    }

    #[test]
    fn property_text() {
        let prop = Property::text("SUMMARY", "Meeting");
        assert_eq!(prop.name, "SUMMARY");
        assert_eq!(prop.as_text(), Some("Meeting"));
    }

    #[test]
    fn property_integer() {
        let prop = Property::integer("SEQUENCE", 5);
        assert_eq!(prop.as_integer(), Some(5));
    }
}
