//! vCard value types (RFC 6350 §4).

use super::datetime::{DateAndOrTime, Timestamp, VCardUtcOffset};
use super::structured::{Address, ClientPidMap, Gender, Organization, Related, StructuredName};

/// A vCard property value.
///
/// Covers all value types defined in RFC 6350.
#[derive(Debug, Clone, PartialEq)]
pub enum VCardValue {
    /// Text value (RFC 6350 §4.1).
    Text(String),

    /// Multi-valued text (comma-separated in source).
    TextList(Vec<String>),

    /// URI value (RFC 6350 §4.2).
    Uri(String),

    /// Date, time, or datetime value (RFC 6350 §4.3).
    DateAndOrTime(DateAndOrTime),

    /// Timestamp (REV property).
    Timestamp(Timestamp),

    /// Structured name (N property).
    StructuredName(StructuredName),

    /// Address (ADR property).
    Address(Address),

    /// Organization (ORG property).
    Organization(Organization),

    /// Gender (GENDER property).
    Gender(Gender),

    /// Client PID map (CLIENTPIDMAP property).
    ClientPidMap(ClientPidMap),

    /// Related contact (RELATED property).
    Related(Related),

    /// Boolean value (RFC 6350 §4.4).
    Boolean(bool),

    /// Integer value (RFC 6350 §4.5).
    Integer(i64),

    /// Float value (RFC 6350 §4.6).
    Float(f64),

    /// UTC offset value (RFC 6350 §4.7).
    UtcOffset(VCardUtcOffset),

    /// Language tag value (RFC 6350 §4.8).
    LanguageTag(String),

    /// Binary data (typically base64 encoded).
    Binary(Vec<u8>),

    /// Unknown/extension value (preserved as text).
    Unknown(String),
}

impl VCardValue {
    /// Returns whether this is a text value.
    #[must_use]
    pub fn is_text(&self) -> bool {
        matches!(self, Self::Text(_))
    }

    /// Returns the value as text if applicable.
    #[must_use]
    pub fn as_text(&self) -> Option<&str> {
        match self {
            Self::Text(s) | Self::Unknown(s) => Some(s),
            _ => None,
        }
    }

    /// Returns the value as a URI if applicable.
    #[must_use]
    pub fn as_uri(&self) -> Option<&str> {
        match self {
            Self::Uri(s) => Some(s),
            _ => None,
        }
    }

    /// Returns the value as a structured name if applicable.
    #[must_use]
    pub fn as_structured_name(&self) -> Option<&StructuredName> {
        match self {
            Self::StructuredName(n) => Some(n),
            _ => None,
        }
    }

    /// Returns the value as an address if applicable.
    #[must_use]
    pub fn as_address(&self) -> Option<&Address> {
        match self {
            Self::Address(a) => Some(a),
            _ => None,
        }
    }

    /// Returns the value as an organization if applicable.
    #[must_use]
    pub fn as_organization(&self) -> Option<&Organization> {
        match self {
            Self::Organization(o) => Some(o),
            _ => None,
        }
    }

    /// Returns the value as a date/time if applicable.
    #[must_use]
    pub fn as_date_and_or_time(&self) -> Option<&DateAndOrTime> {
        match self {
            Self::DateAndOrTime(d) => Some(d),
            _ => None,
        }
    }

    /// Returns the value as a boolean if applicable.
    #[must_use]
    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Self::Boolean(b) => Some(*b),
            _ => None,
        }
    }

    /// Returns the value as an integer if applicable.
    #[must_use]
    pub fn as_integer(&self) -> Option<i64> {
        match self {
            Self::Integer(i) => Some(*i),
            _ => None,
        }
    }
}

impl From<String> for VCardValue {
    fn from(s: String) -> Self {
        Self::Text(s)
    }
}

impl From<&str> for VCardValue {
    fn from(s: &str) -> Self {
        Self::Text(s.to_string())
    }
}

impl From<StructuredName> for VCardValue {
    fn from(n: StructuredName) -> Self {
        Self::StructuredName(n)
    }
}

impl From<Address> for VCardValue {
    fn from(a: Address) -> Self {
        Self::Address(a)
    }
}

impl From<Organization> for VCardValue {
    fn from(o: Organization) -> Self {
        Self::Organization(o)
    }
}

impl From<Gender> for VCardValue {
    fn from(g: Gender) -> Self {
        Self::Gender(g)
    }
}

impl From<DateAndOrTime> for VCardValue {
    fn from(d: DateAndOrTime) -> Self {
        Self::DateAndOrTime(d)
    }
}

impl From<bool> for VCardValue {
    fn from(b: bool) -> Self {
        Self::Boolean(b)
    }
}

impl From<i64> for VCardValue {
    fn from(i: i64) -> Self {
        Self::Integer(i)
    }
}

impl From<f64> for VCardValue {
    fn from(f: f64) -> Self {
        Self::Float(f)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn value_from_string() {
        let val: VCardValue = "Hello".into();
        assert_eq!(val.as_text(), Some("Hello"));
    }

    #[test]
    fn value_from_structured_name() {
        let name = StructuredName::simple("Doe", "John");
        let val: VCardValue = name.clone().into();
        assert_eq!(val.as_structured_name(), Some(&name));
    }

    #[test]
    fn value_as_bool() {
        let val = VCardValue::Boolean(true);
        assert_eq!(val.as_bool(), Some(true));
    }
}
