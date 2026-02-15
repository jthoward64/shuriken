//! iCalendar parameter name types (RFC 5545 §3.2).

use super::normalized::NormalizedValue;
use crate::define_names;

define_names! {
    /// iCalendar parameter names (RFC 5545).
    ///
    /// Normalized enum representation of parameter names with case-insensitive
    /// matching. Unknown parameter names are represented as `None` in the
    /// `NormalizedValue::parsed` field.
    pub ICalParameterName,

    // Standard parameters (RFC 5545 §3.2)
    Altrep => "ALTREP",
    Cn => "CN",
    Cutype => "CUTYPE",
    DelegatedFrom => "DELEGATED-FROM",
    DelegatedTo => "DELEGATED-TO",
    Dir => "DIR",
    Encoding => "ENCODING",
    Fmttype => "FMTTYPE",
    Fbtype => "FBTYPE",
    Language => "LANGUAGE",
    Member => "MEMBER",
    Partstat => "PARTSTAT",
    Range => "RANGE",
    Related => "RELATED",
    Reltype => "RELTYPE",
    Role => "ROLE",
    Rsvp => "RSVP",
    SentBy => "SENT-BY",
    Tzid => "TZID",
    Value => "VALUE",
}

/// Type alias for parameter names with case-preserving original value.
pub type ParameterName = NormalizedValue<ICalParameterName>;

impl ParameterName {
    /// Returns the known parameter name variant, if recognized.
    #[must_use]
    pub fn known(&self) -> Option<ICalParameterName> {
        self.parsed
    }

    /// Returns whether this is a known standard parameter name.
    #[must_use]
    pub fn is_known(&self) -> bool {
        self.parsed.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parameter_name_case_insensitive() {
        let name1 = ParameterName::new("TZID");
        let name2 = ParameterName::new("tzid");
        let name3 = ParameterName::new("TzId");

        assert_eq!(name1, name2);
        assert_eq!(name2, name3);
        assert_eq!(name1.as_str(), "TZID");
        assert_eq!(name2.as_str(), "tzid");
    }

    #[test]
    fn parameter_name_unknown() {
        let name = ParameterName::new("X-CUSTOM-PARAM");
        assert!(!name.is_known());
        assert_eq!(name.known(), None);
        assert_eq!(name.as_str(), "X-CUSTOM-PARAM");
    }

    #[test]
    fn parameter_name_known() {
        let name = ParameterName::new("CUTYPE");
        assert!(name.is_known());
        assert_eq!(name.known(), Some(ICalParameterName::Cutype));
    }
}
