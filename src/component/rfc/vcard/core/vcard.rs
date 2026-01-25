//! vCard wrapper type.

use super::property::VCardProperty;
use super::structured::{Address, Organization, StructuredName};
use super::value::VCardValue;

/// vCard version.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum VCardVersion {
    /// vCard 3.0 (RFC 2426).
    V3,
    /// vCard 4.0 (RFC 6350).
    #[default]
    V4,
}

impl VCardVersion {
    /// Parses from version string.
    #[must_use]
    #[expect(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Option<Self> {
        match s.trim() {
            "3.0" => Some(Self::V3),
            "4.0" => Some(Self::V4),
            _ => None,
        }
    }

    /// Returns the version string.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::V3 => "3.0",
            Self::V4 => "4.0",
        }
    }
}

impl core::str::FromStr for VCardVersion {
    type Err = ();
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        VCardVersion::from_str(s).ok_or(())
    }
}

/// vCard KIND property values (RFC 6350 §6.1.4).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum VCardKind {
    /// An individual person.
    #[default]
    Individual,
    /// A group of people.
    Group,
    /// An organization.
    Organization,
    /// A named location.
    Location,
    /// Extension or unknown kind.
    Other(String),
}

impl VCardKind {
    /// Parses from kind string.
    #[must_use]
    #[expect(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "individual" => Self::Individual,
            "group" => Self::Group,
            "org" | "organization" => Self::Organization,
            "location" => Self::Location,
            other => Self::Other(other.to_string()),
        }
    }

    /// Returns the kind string.
    #[must_use]
    pub fn as_str(&self) -> &str {
        match self {
            Self::Individual => "individual",
            Self::Group => "group",
            Self::Organization => "org",
            Self::Location => "location",
            Self::Other(s) => s,
        }
    }
}

impl core::str::FromStr for VCardKind {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(VCardKind::from_str(s))
    }
}

/// A complete vCard.
#[derive(Debug, Clone, PartialEq)]
pub struct VCard {
    /// vCard version.
    pub version: VCardVersion,
    /// All properties in order of appearance.
    pub properties: Vec<VCardProperty>,
}

impl VCard {
    /// Creates a new vCard 4.0.
    #[must_use]
    pub fn new() -> Self {
        Self {
            version: VCardVersion::V4,
            properties: Vec::new(),
        }
    }

    /// Creates a vCard with the specified version.
    #[must_use]
    pub fn with_version(version: VCardVersion) -> Self {
        Self {
            version,
            properties: Vec::new(),
        }
    }

    /// Adds a property to the vCard.
    pub fn add_property(&mut self, prop: VCardProperty) {
        self.properties.push(prop);
    }

    /// Returns all properties with the given name.
    #[must_use]
    pub fn get_properties(&self, name: &str) -> Vec<&VCardProperty> {
        let name_upper = name.to_ascii_uppercase();
        self.properties
            .iter()
            .filter(|p| p.name == name_upper)
            .collect()
    }

    /// Returns the first property with the given name.
    #[must_use]
    pub fn get_property(&self, name: &str) -> Option<&VCardProperty> {
        let name_upper = name.to_ascii_uppercase();
        self.properties.iter().find(|p| p.name == name_upper)
    }

    /// Returns the FN (formatted name) value.
    #[must_use]
    pub fn formatted_name(&self) -> Option<&str> {
        self.get_property("FN")?.as_text()
    }

    /// Returns the N (structured name) value.
    #[must_use]
    pub fn name(&self) -> Option<&StructuredName> {
        match &self.get_property("N")?.value {
            VCardValue::StructuredName(n) => Some(n),
            _ => None,
        }
    }

    /// Returns the UID value.
    #[must_use]
    pub fn uid(&self) -> Option<&str> {
        self.get_property("UID")?.as_text()
    }

    /// Returns the KIND value.
    #[must_use]
    pub fn kind(&self) -> VCardKind {
        self.get_property("KIND")
            .and_then(|p| p.as_text())
            .map(VCardKind::from_str)
            .unwrap_or_default()
    }

    /// Returns all EMAIL property values.
    #[must_use]
    pub fn emails(&self) -> Vec<&str> {
        self.get_properties("EMAIL")
            .iter()
            .filter_map(|p| p.as_text())
            .collect()
    }

    /// Returns all TEL property values.
    #[must_use]
    pub fn telephones(&self) -> Vec<&str> {
        self.get_properties("TEL")
            .iter()
            .filter_map(|p| match &p.value {
                VCardValue::Text(s) | VCardValue::Uri(s) => Some(s.as_str()),
                _ => None,
            })
            .collect()
    }

    /// Returns all ADR (address) values.
    #[must_use]
    pub fn addresses(&self) -> Vec<&Address> {
        self.get_properties("ADR")
            .iter()
            .filter_map(|p| p.value.as_address())
            .collect()
    }

    /// Returns the ORG (organization) value.
    #[must_use]
    pub fn organization(&self) -> Option<&Organization> {
        match &self.get_property("ORG")?.value {
            VCardValue::Organization(o) => Some(o),
            _ => None,
        }
    }

    /// Returns the TITLE value.
    #[must_use]
    pub fn title(&self) -> Option<&str> {
        self.get_property("TITLE")?.as_text()
    }

    /// Returns the NOTE value.
    #[must_use]
    pub fn note(&self) -> Option<&str> {
        self.get_property("NOTE")?.as_text()
    }

    /// Returns all URL values.
    #[must_use]
    pub fn urls(&self) -> Vec<&str> {
        self.get_properties("URL")
            .iter()
            .filter_map(|p| match &p.value {
                VCardValue::Text(s) | VCardValue::Uri(s) => Some(s.as_str()),
                _ => None,
            })
            .collect()
    }

    /// Returns the PHOTO URI if present.
    #[must_use]
    pub fn photo(&self) -> Option<&str> {
        match &self.get_property("PHOTO")?.value {
            VCardValue::Uri(s) => Some(s),
            _ => None,
        }
    }

    /// Returns whether this vCard is for a group.
    #[must_use]
    pub fn is_group(&self) -> bool {
        matches!(self.kind(), VCardKind::Group)
    }

    /// Returns MEMBER URIs for group vCards.
    #[must_use]
    pub fn members(&self) -> Vec<&str> {
        self.get_properties("MEMBER")
            .iter()
            .filter_map(|p| match &p.value {
                VCardValue::Uri(s) => Some(s.as_str()),
                _ => None,
            })
            .collect()
    }
}

impl Default for VCard {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vcard_new() {
        let card = VCard::new();
        assert_eq!(card.version, VCardVersion::V4);
        assert!(card.properties.is_empty());
    }

    #[test]
    fn vcard_version_parse() {
        assert_eq!(VCardVersion::from_str("3.0"), Some(VCardVersion::V3));
        assert_eq!(VCardVersion::from_str("4.0"), Some(VCardVersion::V4));
        assert_eq!(VCardVersion::from_str("2.1"), None);
    }

    #[test]
    fn vcard_kind_parse() {
        assert_eq!(VCardKind::from_str("individual"), VCardKind::Individual);
        assert_eq!(VCardKind::from_str("GROUP"), VCardKind::Group);
        assert_eq!(VCardKind::from_str("org"), VCardKind::Organization);
    }

    #[test]
    fn vcard_formatted_name() {
        let mut card = VCard::new();
        card.add_property(VCardProperty::text("FN", "John Doe"));
        assert_eq!(card.formatted_name(), Some("John Doe"));
    }

    #[test]
    fn vcard_emails() {
        let mut card = VCard::new();
        card.add_property(VCardProperty::text("EMAIL", "john@example.com"));
        card.add_property(VCardProperty::text("EMAIL", "john.doe@work.com"));

        let emails = card.emails();
        assert_eq!(emails.len(), 2);
        assert!(emails.contains(&"john@example.com"));
    }
}
