//! Structured vCard types (RFC 6350).
//!
//! These types represent structured property values like N, ADR, and ORG.

use super::datetime::DateAndOrTime;

/// Structured name (N property, RFC 6350 §6.2.2).
///
/// All components are optional per RFC 6350.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StructuredName {
    /// Family names (surnames).
    pub family: Vec<String>,
    /// Given names (first names).
    pub given: Vec<String>,
    /// Additional names (middle names).
    pub additional: Vec<String>,
    /// Honorific prefixes (e.g., "Mr.", "Dr.").
    pub prefixes: Vec<String>,
    /// Honorific suffixes (e.g., "Jr.", "M.D.").
    pub suffixes: Vec<String>,
}

impl StructuredName {
    /// Creates an empty structured name.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Creates a structured name with family and given names.
    #[must_use]
    pub fn simple(family: impl Into<String>, given: impl Into<String>) -> Self {
        Self {
            family: vec![family.into()],
            given: vec![given.into()],
            ..Self::default()
        }
    }

    /// Returns whether the name is empty (all components are empty).
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.family.is_empty()
            && self.given.is_empty()
            && self.additional.is_empty()
            && self.prefixes.is_empty()
            && self.suffixes.is_empty()
    }

    /// Formats as a display name (given + family).
    #[must_use]
    pub fn display_name(&self) -> String {
        let mut parts = Vec::new();
        if !self.given.is_empty() {
            parts.push(self.given.join(" "));
        }
        if !self.family.is_empty() {
            parts.push(self.family.join(" "));
        }
        parts.join(" ")
    }
}

/// Address (ADR property, RFC 6350 §6.3.1).
///
/// All components are optional per RFC 6350.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Address {
    /// Post office box.
    pub po_box: Vec<String>,
    /// Extended address (e.g., apartment or suite number).
    pub extended: Vec<String>,
    /// Street address.
    pub street: Vec<String>,
    /// Locality (city).
    pub locality: Vec<String>,
    /// Region (state or province).
    pub region: Vec<String>,
    /// Postal code.
    pub postal_code: Vec<String>,
    /// Country name.
    pub country: Vec<String>,
}

impl Address {
    /// Creates an empty address.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns whether the address is empty.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.po_box.is_empty()
            && self.extended.is_empty()
            && self.street.is_empty()
            && self.locality.is_empty()
            && self.region.is_empty()
            && self.postal_code.is_empty()
            && self.country.is_empty()
    }

    /// Formats as a single-line address.
    #[must_use]
    pub fn one_line(&self) -> String {
        let parts: Vec<&String> = [
            &self.street,
            &self.locality,
            &self.region,
            &self.postal_code,
            &self.country,
        ]
        .iter()
        .flat_map(|v| v.iter())
        .collect();
        parts
            .iter()
            .map(|s| s.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    }
}

/// Organization (ORG property, RFC 6350 §6.6.4).
///
/// First value is the organizational name, subsequent values are
/// organizational units in order of decreasing specificity.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Organization {
    /// Organization name.
    pub name: String,
    /// Organizational units (department, division, etc.).
    pub units: Vec<String>,
}

impl Organization {
    /// Creates an organization with just a name.
    #[must_use]
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            units: Vec::new(),
        }
    }

    /// Creates an organization with name and units.
    #[must_use]
    pub fn with_units(name: impl Into<String>, units: Vec<String>) -> Self {
        Self {
            name: name.into(),
            units,
        }
    }

    /// Returns whether the organization is empty.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.name.is_empty() && self.units.is_empty()
    }
}

/// Gender (GENDER property, RFC 6350 §6.2.7).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Gender {
    /// Sex component: M, F, O, N, or U.
    pub sex: Option<Sex>,
    /// Gender identity text (free-form).
    pub identity: Option<String>,
}

impl Gender {
    /// Creates a gender with just sex.
    #[must_use]
    pub fn sex(sex: Sex) -> Self {
        Self {
            sex: Some(sex),
            identity: None,
        }
    }

    /// Creates a gender with just identity text.
    #[must_use]
    pub fn identity(text: impl Into<String>) -> Self {
        Self {
            sex: None,
            identity: Some(text.into()),
        }
    }

    /// Creates a gender with both sex and identity.
    #[must_use]
    pub fn full(sex: Sex, identity: impl Into<String>) -> Self {
        Self {
            sex: Some(sex),
            identity: Some(identity.into()),
        }
    }
}

// Default is `sex: None`, `identity: None` via #[derive(Default)]

/// Sex component of GENDER property (RFC 6350 §6.2.7).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sex {
    /// Male.
    Male,
    /// Female.
    Female,
    /// Other.
    Other,
    /// None or not applicable.
    None,
    /// Unknown.
    Unknown,
}

impl Sex {
    /// Parses from single character.
    #[must_use]
    pub fn from_char(c: char) -> Option<Self> {
        match c {
            'M' | 'm' => Some(Self::Male),
            'F' | 'f' => Some(Self::Female),
            'O' | 'o' => Some(Self::Other),
            'N' | 'n' => Some(Self::None),
            'U' | 'u' => Some(Self::Unknown),
            _ => Option::None,
        }
    }

    /// Returns the single-character representation.
    #[must_use]
    pub const fn as_char(self) -> char {
        match self {
            Self::Male => 'M',
            Self::Female => 'F',
            Self::Other => 'O',
            Self::None => 'N',
            Self::Unknown => 'U',
        }
    }
}

/// Client PID map entry (CLIENTPIDMAP property, RFC 6350 §6.7.7).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClientPidMap {
    /// Source ID (integer ≥ 1).
    pub source_id: u32,
    /// URI identifying the source.
    pub uri: String,
}

impl ClientPidMap {
    /// Creates a new client PID map entry.
    #[must_use]
    pub fn new(source_id: u32, uri: impl Into<String>) -> Self {
        Self {
            source_id,
            uri: uri.into(),
        }
    }
}

/// Telephone URI (per RFC 3966).
///
/// Represents a parsed tel: URI with optional extension.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TelUri {
    /// The telephone number (global or local).
    pub number: String,
    /// Extension, if any.
    pub extension: Option<String>,
}

impl TelUri {
    /// Creates a tel URI from a phone number.
    #[must_use]
    pub fn new(number: impl Into<String>) -> Self {
        Self {
            number: number.into(),
            extension: None,
        }
    }

    /// Creates a tel URI with an extension.
    #[must_use]
    pub fn with_extension(number: impl Into<String>, ext: impl Into<String>) -> Self {
        Self {
            number: number.into(),
            extension: Some(ext.into()),
        }
    }

    /// Formats as a tel: URI string.
    #[must_use]
    pub fn to_uri(&self) -> String {
        if let Some(ext) = &self.extension {
            format!("tel:{};ext={}", self.number, ext)
        } else {
            format!("tel:{}", self.number)
        }
    }
}

/// Related contact (RELATED property, RFC 6350 §6.6.6).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Related {
    /// URI reference to another vCard.
    Uri(String),
    /// Free-text description.
    Text(String),
}

/// Anniversary or birthday value with optional time.
#[derive(Debug, Clone, PartialEq)]
pub struct Anniversary {
    /// The date/time value.
    pub value: DateAndOrTime,
    /// Optional calendar scale (defaults to gregorian).
    pub calscale: Option<String>,
}

impl Anniversary {
    /// Creates an anniversary from a date value.
    #[must_use]
    pub fn new(value: DateAndOrTime) -> Self {
        Self {
            value,
            calscale: None,
        }
    }

    /// Creates an anniversary with a calendar scale.
    #[must_use]
    pub fn with_calscale(value: DateAndOrTime, calscale: impl Into<String>) -> Self {
        Self {
            value,
            calscale: Some(calscale.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn structured_name_simple() {
        let name = StructuredName::simple("Doe", "John");
        assert_eq!(name.display_name(), "John Doe");
    }

    #[test]
    fn structured_name_empty() {
        let name = StructuredName::new();
        assert!(name.is_empty());
    }

    #[test]
    fn address_one_line() {
        let addr = Address {
            street: vec!["123 Main St".to_string()],
            locality: vec!["Anytown".to_string()],
            region: vec!["CA".to_string()],
            postal_code: vec!["12345".to_string()],
            country: vec!["USA".to_string()],
            ..Address::default()
        };
        assert_eq!(addr.one_line(), "123 Main St, Anytown, CA, 12345, USA");
    }

    #[test]
    fn organization_with_units() {
        let org = Organization::with_units(
            "Acme Inc.",
            vec!["Engineering".to_string(), "Backend Team".to_string()],
        );
        assert_eq!(org.name, "Acme Inc.");
        assert_eq!(org.units.len(), 2);
    }

    #[test]
    fn gender_sex_only() {
        let gender = Gender::sex(Sex::Female);
        assert_eq!(gender.sex, Some(Sex::Female));
        assert!(gender.identity.is_none());
    }

    #[test]
    fn sex_from_char() {
        assert_eq!(Sex::from_char('M'), Some(Sex::Male));
        assert_eq!(Sex::from_char('f'), Some(Sex::Female));
        assert_eq!(Sex::from_char('X'), None);
    }

    #[test]
    fn tel_uri_with_extension() {
        let tel = TelUri::with_extension("+1-555-555-5555", "1234");
        assert_eq!(tel.to_uri(), "tel:+1-555-555-5555;ext=1234");
    }
}
