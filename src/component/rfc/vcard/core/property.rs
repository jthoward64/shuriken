//! vCard property types (RFC 6350).

use super::parameter::VCardParameter;
use super::value::VCardValue;

/// A vCard property.
///
/// Contains the parsed value along with the original raw value
/// for round-trip fidelity.
#[derive(Debug, Clone, PartialEq)]
pub struct VCardProperty {
    /// Optional property group (e.g., "item1" in "item1.TEL").
    pub group: Option<String>,
    /// Property name (normalized to uppercase).
    pub name: String,
    /// Parameters in order of appearance.
    pub params: Vec<VCardParameter>,
    /// Parsed value.
    pub value: VCardValue,
    /// Original raw value string (for round-trip).
    pub raw_value: String,
}

impl VCardProperty {
    /// Creates a property with a text value.
    #[must_use]
    pub fn text(name: impl Into<String>, value: impl Into<String>) -> Self {
        let value_str = value.into();
        Self {
            group: None,
            name: name.into().to_ascii_uppercase(),
            params: Vec::new(),
            value: VCardValue::Text(value_str.clone()),
            raw_value: value_str,
        }
    }

    /// Creates a property with a text value and group.
    #[must_use]
    pub fn grouped_text(
        group: impl Into<String>,
        name: impl Into<String>,
        value: impl Into<String>,
    ) -> Self {
        let value_str = value.into();
        Self {
            group: Some(group.into()),
            name: name.into().to_ascii_uppercase(),
            params: Vec::new(),
            value: VCardValue::Text(value_str.clone()),
            raw_value: value_str,
        }
    }

    /// Creates a property with a URI value.
    #[must_use]
    pub fn uri(name: impl Into<String>, value: impl Into<String>) -> Self {
        let value_str = value.into();
        Self {
            group: None,
            name: name.into().to_ascii_uppercase(),
            params: Vec::new(),
            value: VCardValue::Uri(value_str.clone()),
            raw_value: value_str,
        }
    }

    /// Returns the parameter with the given name.
    #[must_use]
    pub fn get_param(&self, name: &str) -> Option<&VCardParameter> {
        let name_upper = name.to_ascii_uppercase();
        self.params.iter().find(|p| p.name == name_upper)
    }

    /// Returns the value of a parameter.
    #[must_use]
    pub fn get_param_value(&self, name: &str) -> Option<&str> {
        let p = self.get_param(name)?;
        p.value()
    }

    /// Returns whether this property has the specified TYPE value.
    #[must_use]
    pub fn has_type(&self, type_value: &str) -> bool {
        self.get_param("TYPE")
            .is_some_and(|p| p.has_value(type_value))
    }

    /// Returns the PREF value if present (1-100, lower is preferred).
    #[must_use]
    pub fn pref(&self) -> Option<u8> {
        self.get_param_value("PREF").and_then(|v| v.parse().ok())
    }

    /// Returns the value as text if it is a text value.
    #[must_use]
    pub fn as_text(&self) -> Option<&str> {
        match &self.value {
            VCardValue::Text(s) => Some(s),
            _ => None,
        }
    }

    /// Adds a parameter to this property.
    pub fn add_param(&mut self, param: VCardParameter) {
        self.params.push(param);
    }

    /// Adds a TYPE parameter value.
    pub fn add_type(&mut self, type_value: impl Into<String>) {
        if let Some(param) = self.params.iter_mut().find(|p| p.name == "TYPE") {
            param.values.push(type_value.into());
        } else {
            self.params.push(VCardParameter::type_param(type_value));
        }
    }
}

/// Common property names as constants.
pub mod names {
    // Identification properties
    pub const FN: &str = "FN";
    pub const N: &str = "N";
    pub const NICKNAME: &str = "NICKNAME";
    pub const PHOTO: &str = "PHOTO";
    pub const BDAY: &str = "BDAY";
    pub const ANNIVERSARY: &str = "ANNIVERSARY";
    pub const GENDER: &str = "GENDER";

    // Delivery addressing
    pub const ADR: &str = "ADR";

    // Communications
    pub const TEL: &str = "TEL";
    pub const EMAIL: &str = "EMAIL";
    pub const IMPP: &str = "IMPP";
    pub const LANG: &str = "LANG";

    // Geographical
    pub const TZ: &str = "TZ";
    pub const GEO: &str = "GEO";

    // Organizational
    pub const TITLE: &str = "TITLE";
    pub const ROLE: &str = "ROLE";
    pub const LOGO: &str = "LOGO";
    pub const ORG: &str = "ORG";
    pub const MEMBER: &str = "MEMBER";
    pub const RELATED: &str = "RELATED";

    // Explanatory
    pub const CATEGORIES: &str = "CATEGORIES";
    pub const NOTE: &str = "NOTE";
    pub const PRODID: &str = "PRODID";
    pub const REV: &str = "REV";
    pub const SOUND: &str = "SOUND";
    pub const UID: &str = "UID";
    pub const CLIENTPIDMAP: &str = "CLIENTPIDMAP";
    pub const URL: &str = "URL";

    // Security
    pub const KEY: &str = "KEY";

    // Calendar
    pub const FBURL: &str = "FBURL";
    pub const CALADRURI: &str = "CALADRURI";
    pub const CALURI: &str = "CALURI";

    // General/structural
    pub const BEGIN: &str = "BEGIN";
    pub const END: &str = "END";
    pub const VERSION: &str = "VERSION";
    pub const SOURCE: &str = "SOURCE";
    pub const KIND: &str = "KIND";
    pub const XML: &str = "XML";
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn property_text() {
        let prop = VCardProperty::text("FN", "John Doe");
        assert_eq!(prop.name, "FN");
        assert_eq!(prop.as_text(), Some("John Doe"));
    }

    #[test]
    fn property_grouped() {
        let prop = VCardProperty::grouped_text("item1", "TEL", "+1-555-555-5555");
        assert_eq!(prop.group, Some("item1".to_string()));
        assert_eq!(prop.name, "TEL");
    }

    #[test]
    fn property_with_types() {
        let mut prop = VCardProperty::text("TEL", "+1-555-555-5555");
        prop.add_type("home");
        prop.add_type("voice");

        assert!(prop.has_type("home"));
        assert!(prop.has_type("VOICE")); // Case-insensitive
    }
}
