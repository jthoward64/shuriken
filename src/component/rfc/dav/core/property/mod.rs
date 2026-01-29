//! DAV property types.

pub mod discovery;

use super::namespace::QName;
use super::partial_retrieval::{AddressDataRequest, CalendarDataRequest};

/// A property name (without value), with optional partial retrieval specification.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum PropertyName {
    /// Simple property name.
    Simple(QName),
    /// Calendar-data with optional partial retrieval.
    CalendarData(CalendarDataRequest),
    /// Address-data with optional partial retrieval.
    AddressData(AddressDataRequest),
}

impl PropertyName {
    /// Creates a new simple property name.
    #[must_use]
    pub fn new(qname: QName) -> Self {
        Self::Simple(qname)
    }

    /// Creates calendar-data property with partial retrieval.
    #[must_use]
    pub fn calendar_data(request: CalendarDataRequest) -> Self {
        Self::CalendarData(request)
    }

    /// Creates address-data property with partial retrieval.
    #[must_use]
    pub fn address_data(request: AddressDataRequest) -> Self {
        Self::AddressData(request)
    }

    /// Returns the qualified name.
    #[must_use]
    pub fn qname(&self) -> QName {
        match self {
            Self::Simple(qname) => qname.clone(),
            Self::CalendarData(_) => QName::new("urn:ietf:params:xml:ns:caldav", "calendar-data"),
            Self::AddressData(_) => QName::new("urn:ietf:params:xml:ns:carddav", "address-data"),
        }
    }

    /// Returns the namespace URI.
    #[must_use]
    pub fn namespace(&self) -> &str {
        match self {
            Self::Simple(qname) => qname.namespace_uri(),
            Self::CalendarData(_) => "urn:ietf:params:xml:ns:caldav",
            Self::AddressData(_) => "urn:ietf:params:xml:ns:carddav",
        }
    }

    /// Returns the local name.
    #[must_use]
    pub fn local_name(&self) -> &str {
        match self {
            Self::Simple(qname) => qname.local_name(),
            Self::CalendarData(_) => "calendar-data",
            Self::AddressData(_) => "address-data",
        }
    }

    /// Returns the calendar-data request if this is a calendar-data property.
    #[must_use]
    pub fn calendar_data_request(&self) -> Option<&CalendarDataRequest> {
        match self {
            Self::CalendarData(req) => Some(req),
            _ => None,
        }
    }

    /// Returns the address-data request if this is an address-data property.
    #[must_use]
    pub fn address_data_request(&self) -> Option<&AddressDataRequest> {
        match self {
            Self::AddressData(req) => Some(req),
            _ => None,
        }
    }
}

impl From<QName> for PropertyName {
    fn from(qname: QName) -> Self {
        Self::Simple(qname)
    }
}

/// A DAV property with name and optional value.
#[derive(Debug, Clone)]
pub struct DavProperty {
    /// The property name.
    pub name: QName,
    /// The property value (if known).
    pub value: Option<PropertyValue>,
}

impl DavProperty {
    /// Creates a property with no value (for 404 responses).
    #[must_use]
    pub fn not_found(name: QName) -> Self {
        Self { name, value: None }
    }

    /// Creates a property with a text value.
    #[must_use]
    pub fn text(name: QName, value: impl Into<String>) -> Self {
        Self {
            name,
            value: Some(PropertyValue::Text(value.into())),
        }
    }

    /// Creates a property with an href value.
    #[must_use]
    pub fn href(name: QName, href: impl Into<String>) -> Self {
        Self {
            name,
            value: Some(PropertyValue::Href(href.into())),
        }
    }

    /// Creates a property with multiple href values.
    #[must_use]
    pub fn href_set(name: QName, hrefs: Vec<String>) -> Self {
        Self {
            name,
            value: Some(PropertyValue::HrefSet(hrefs)),
        }
    }

    /// Creates a property with an integer value.
    #[must_use]
    pub fn integer(name: QName, value: i64) -> Self {
        Self {
            name,
            value: Some(PropertyValue::Integer(value)),
        }
    }

    /// Creates a property with a datetime value.
    #[must_use]
    pub fn datetime(name: QName, value: chrono::DateTime<chrono::Utc>) -> Self {
        Self {
            name,
            value: Some(PropertyValue::DateTime(value)),
        }
    }

    /// Creates a resourcetype property for a collection.
    #[must_use]
    pub fn collection_resourcetype(types: Vec<QName>) -> Self {
        Self {
            name: QName::dav("resourcetype"),
            value: Some(PropertyValue::ResourceType(types)),
        }
    }

    /// Creates a resourcetype property for a non-collection.
    #[must_use]
    pub fn resource_resourcetype() -> Self {
        Self {
            name: QName::dav("resourcetype"),
            value: Some(PropertyValue::ResourceType(Vec::new())),
        }
    }

    /// Creates an empty property.
    #[must_use]
    pub fn empty(name: QName) -> Self {
        Self {
            name,
            value: Some(PropertyValue::Empty),
        }
    }

    /// Creates a property with raw XML content.
    #[must_use]
    pub fn xml(name: QName, xml: impl Into<String>) -> Self {
        Self {
            name,
            value: Some(PropertyValue::Xml(xml.into())),
        }
    }
}

/// A property value.
#[derive(Debug, Clone)]
pub enum PropertyValue {
    /// Empty element.
    Empty,
    /// Text content.
    Text(String),
    /// Single href.
    Href(String),
    /// Multiple hrefs.
    HrefSet(Vec<String>),
    /// Integer value.
    Integer(i64),
    /// Date-time value (RFC 3339).
    DateTime(chrono::DateTime<chrono::Utc>),
    /// Resource types (collection, calendar, addressbook, etc.).
    ResourceType(Vec<QName>),
    /// Raw XML content.
    Xml(String),
    /// Calendar/address data (large text).
    ContentData(String),
    /// Supported component set (VEVENT, VTODO, etc.).
    SupportedComponents(Vec<String>),
    /// Supported report set.
    SupportedReports(Vec<QName>),
}

impl PropertyValue {
    /// Returns the value as text if applicable.
    #[must_use]
    pub fn as_text(&self) -> Option<&str> {
        match self {
            Self::Text(s) | Self::Xml(s) | Self::ContentData(s) => Some(s),
            _ => None,
        }
    }

    /// Returns the value as an href if applicable.
    #[must_use]
    pub fn as_href(&self) -> Option<&str> {
        match self {
            Self::Href(s) => Some(s),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn property_text() {
        let prop = DavProperty::text(QName::dav("displayname"), "My Calendar");
        assert_eq!(prop.name.local_name(), "displayname");
        assert!(matches!(prop.value, Some(PropertyValue::Text(_))));
    }

    #[test]
    fn property_href() {
        let prop = DavProperty::href(QName::dav("current-user-principal"), "/principals/user/");
        assert!(matches!(prop.value, Some(PropertyValue::Href(_))));
    }

    #[test]
    fn property_resourcetype() {
        let prop = DavProperty::collection_resourcetype(vec![
            QName::dav("collection"),
            QName::caldav("calendar"),
        ]);
        match prop.value {
            Some(PropertyValue::ResourceType(types)) => {
                assert_eq!(types.len(), 2);
            }
            _ => panic!("expected ResourceType"),
        }
    }
}
