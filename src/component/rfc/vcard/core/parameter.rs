//! vCard parameter types (RFC 6350).

/// A vCard parameter.
///
/// Parameters can have multiple values (e.g., TYPE=home,work).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VCardParameter {
    /// Parameter name (normalized to uppercase).
    pub name: String,
    /// Parameter values.
    pub values: Vec<String>,
}

impl VCardParameter {
    /// Creates a new parameter with a single value.
    #[must_use]
    pub fn new(name: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            name: name.into().to_ascii_uppercase(),
            values: vec![value.into()],
        }
    }

    /// Creates a parameter with multiple values.
    #[must_use]
    pub fn multi(name: impl Into<String>, values: Vec<String>) -> Self {
        Self {
            name: name.into().to_ascii_uppercase(),
            values,
        }
    }

    /// Returns the first value, if any.
    #[must_use]
    pub fn value(&self) -> Option<&str> {
        self.values.first().map(String::as_str)
    }

    /// Returns whether the parameter has the specified value (case-insensitive).
    #[must_use]
    pub fn has_value(&self, value: &str) -> bool {
        let value_upper = value.to_ascii_uppercase();
        self.values
            .iter()
            .any(|v| v.eq_ignore_ascii_case(&value_upper))
    }

    // --- Convenience constructors ---

    /// Creates a TYPE parameter.
    #[must_use]
    pub fn type_param(value: impl Into<String>) -> Self {
        Self::new("TYPE", value)
    }

    /// Creates a PREF parameter with priority (1-100).
    #[must_use]
    pub fn pref(priority: u8) -> Self {
        Self::new("PREF", priority.to_string())
    }

    /// Creates an ALTID parameter for grouping alternate representations.
    #[must_use]
    pub fn altid(id: impl Into<String>) -> Self {
        Self::new("ALTID", id)
    }

    /// Creates a LANGUAGE parameter.
    #[must_use]
    pub fn language(tag: impl Into<String>) -> Self {
        Self::new("LANGUAGE", tag)
    }

    /// Creates a VALUE parameter specifying the value type.
    #[must_use]
    pub fn value_type(type_name: impl Into<String>) -> Self {
        Self::new("VALUE", type_name)
    }

    /// Creates a PID parameter (property ID for synchronization).
    #[must_use]
    pub fn pid(id: impl Into<String>) -> Self {
        Self::new("PID", id)
    }

    /// Creates a SORT-AS parameter for collation.
    #[must_use]
    pub fn sort_as(value: impl Into<String>) -> Self {
        Self::new("SORT-AS", value)
    }

    /// Creates a CALSCALE parameter.
    #[must_use]
    pub fn calscale(value: impl Into<String>) -> Self {
        Self::new("CALSCALE", value)
    }

    /// Creates a GEO parameter (for ADR property).
    #[must_use]
    pub fn geo(uri: impl Into<String>) -> Self {
        Self::new("GEO", uri)
    }

    /// Creates a TZ parameter (for ADR property).
    #[must_use]
    pub fn tz(value: impl Into<String>) -> Self {
        Self::new("TZ", value)
    }

    /// Creates a LABEL parameter (formatted address text).
    #[must_use]
    pub fn label(text: impl Into<String>) -> Self {
        Self::new("LABEL", text)
    }

    /// Creates a MEDIATYPE parameter.
    #[must_use]
    pub fn mediatype(value: impl Into<String>) -> Self {
        Self::new("MEDIATYPE", value)
    }
}

/// Common TYPE values as constants.
pub mod types {
    // Address types
    pub const HOME: &str = "home";
    pub const WORK: &str = "work";

    // Telephone types
    pub const TEXT: &str = "text";
    pub const VOICE: &str = "voice";
    pub const FAX: &str = "fax";
    pub const CELL: &str = "cell";
    pub const VIDEO: &str = "video";
    pub const PAGER: &str = "pager";
    pub const TEXTPHONE: &str = "textphone";

    // Related types
    pub const CONTACT: &str = "contact";
    pub const ACQUAINTANCE: &str = "acquaintance";
    pub const FRIEND: &str = "friend";
    pub const MET: &str = "met";
    pub const CO_WORKER: &str = "co-worker";
    pub const COLLEAGUE: &str = "colleague";
    pub const CO_RESIDENT: &str = "co-resident";
    pub const NEIGHBOR: &str = "neighbor";
    pub const CHILD: &str = "child";
    pub const PARENT: &str = "parent";
    pub const SIBLING: &str = "sibling";
    pub const SPOUSE: &str = "spouse";
    pub const KIN: &str = "kin";
    pub const MUSE: &str = "muse";
    pub const CRUSH: &str = "crush";
    pub const DATE: &str = "date";
    pub const SWEETHEART: &str = "sweetheart";
    pub const ME: &str = "me";
    pub const AGENT: &str = "agent";
    pub const EMERGENCY: &str = "emergency";
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parameter_single_value() {
        let param = VCardParameter::new("type", "home");
        assert_eq!(param.name, "TYPE");
        assert_eq!(param.value(), Some("home"));
    }

    #[test]
    fn parameter_has_value() {
        let param = VCardParameter::multi("TYPE", vec!["home".into(), "work".into()]);
        assert!(param.has_value("home"));
        assert!(param.has_value("HOME"));
        assert!(param.has_value("work"));
        assert!(!param.has_value("cell"));
    }

    #[test]
    fn pref_parameter() {
        let param = VCardParameter::pref(1);
        assert_eq!(param.name, "PREF");
        assert_eq!(param.value(), Some("1"));
    }
}
