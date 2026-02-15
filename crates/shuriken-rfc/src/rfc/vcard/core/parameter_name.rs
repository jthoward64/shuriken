//! vCard parameter name types (RFC 6350).

use crate::define_names;
use crate::rfc::ical::core::NormalizedValue;

define_names! {
    /// vCard parameter names (RFC 6350).
    ///
    /// Normalized enum representation of parameter names with case-insensitive
    /// matching. Unknown parameter names are represented as `None` in the
    /// `NormalizedValue::parsed` field.
    pub VCardParameterName,

    // Standard parameters (RFC 6350 §5)
    Altid => "ALTID",
    Calscale => "CALSCALE",
    Geo => "GEO",
    Label => "LABEL",
    Language => "LANGUAGE",
    Mediatype => "MEDIATYPE",
    Pid => "PID",
    Pref => "PREF",
    SortAs => "SORT-AS",
    Type => "TYPE",
    Tz => "TZ",
    Value => "VALUE",
}

/// Type alias for vCard parameter names with case-preserving original value.
pub type VCardParameterNameValue = NormalizedValue<VCardParameterName>;

impl VCardParameterNameValue {
    /// Returns the known parameter name variant, if recognized.
    #[must_use]
    pub fn known(&self) -> Option<VCardParameterName> {
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
        let name1 = VCardParameterNameValue::new("TYPE");
        let name2 = VCardParameterNameValue::new("type");
        let name3 = VCardParameterNameValue::new("Type");

        assert_eq!(name1, name2);
        assert_eq!(name2, name3);
        assert_eq!(name1.as_str(), "TYPE");
        assert_eq!(name2.as_str(), "type");
    }

    #[test]
    fn parameter_name_unknown() {
        let name = VCardParameterNameValue::new("X-CUSTOM-PARAM");
        assert!(!name.is_known());
        assert_eq!(name.known(), None);
        assert_eq!(name.as_str(), "X-CUSTOM-PARAM");
    }

    #[test]
    fn parameter_name_known() {
        let name = VCardParameterNameValue::new("PREF");
        assert!(name.is_known());
        assert_eq!(name.known(), Some(VCardParameterName::Pref));
    }
}
