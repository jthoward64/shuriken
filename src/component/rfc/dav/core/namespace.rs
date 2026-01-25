#![allow(dead_code)]
//! XML namespace and qualified name types.

use std::borrow::Cow;

/// `DAV:` namespace URI.
pub const DAV_NS: &str = "DAV:";

/// `CalDAV` namespace URI.
pub const CALDAV_NS: &str = "urn:ietf:params:xml:ns:caldav";

/// `CardDAV` namespace URI.
pub const CARDDAV_NS: &str = "urn:ietf:params:xml:ns:carddav";

/// `CalendarServer` (Apple) namespace URI.
pub const CS_NS: &str = "http://calendarserver.org/ns/";

/// An XML namespace.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Namespace(pub Cow<'static, str>);

impl Namespace {
    /// `DAV:` namespace.
    pub const DAV: Self = Self(Cow::Borrowed(DAV_NS));

    /// `CalDAV` namespace.
    pub const CALDAV: Self = Self(Cow::Borrowed(CALDAV_NS));

    /// `CardDAV` namespace.
    pub const CARDDAV: Self = Self(Cow::Borrowed(CARDDAV_NS));

    /// `CalendarServer` namespace.
    pub const CS: Self = Self(Cow::Borrowed(CS_NS));

    /// Creates a new namespace from a string.
    #[must_use]
    pub fn new(uri: impl Into<Cow<'static, str>>) -> Self {
        Self(uri.into())
    }

    /// Returns the namespace URI.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Returns the conventional prefix for this namespace.
    #[must_use]
    pub fn default_prefix(&self) -> Option<&'static str> {
        match self.0.as_ref() {
            DAV_NS => Some("D"),
            CALDAV_NS => Some("C"),
            CARDDAV_NS => Some("CR"),
            CS_NS => Some("CS"),
            _ => None,
        }
    }
}

impl From<&'static str> for Namespace {
    fn from(s: &'static str) -> Self {
        Self(Cow::Borrowed(s))
    }
}

impl From<String> for Namespace {
    fn from(s: String) -> Self {
        Self(Cow::Owned(s))
    }
}

/// A qualified XML name (namespace + local name).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct QName {
    /// The namespace URI.
    pub namespace: Namespace,
    /// The local name.
    pub local_name: Cow<'static, str>,
}

impl QName {
    /// Creates a new qualified name.
    #[must_use]
    pub fn new(namespace: impl Into<Namespace>, local_name: impl Into<Cow<'static, str>>) -> Self {
        Self {
            namespace: namespace.into(),
            local_name: local_name.into(),
        }
    }

    /// Creates a `DAV:` qualified name.
    #[must_use]
    pub fn dav(local_name: impl Into<Cow<'static, str>>) -> Self {
        Self {
            namespace: Namespace::DAV,
            local_name: local_name.into(),
        }
    }

    /// Creates a `CalDAV` qualified name.
    #[must_use]
    pub fn caldav(local_name: impl Into<Cow<'static, str>>) -> Self {
        Self {
            namespace: Namespace::CALDAV,
            local_name: local_name.into(),
        }
    }

    /// Creates a `CardDAV` qualified name.
    #[must_use]
    pub fn carddav(local_name: impl Into<Cow<'static, str>>) -> Self {
        Self {
            namespace: Namespace::CARDDAV,
            local_name: local_name.into(),
        }
    }

    /// Returns the local name.
    #[must_use]
    pub fn local_name(&self) -> &str {
        &self.local_name
    }

    /// Returns the namespace URI.
    #[must_use]
    pub fn namespace_uri(&self) -> &str {
        self.namespace.as_str()
    }

    /// Returns whether this is a DAV: element.
    #[must_use]
    pub fn is_dav(&self) -> bool {
        self.namespace == Namespace::DAV
    }

    /// Returns whether this is a `CalDAV` element.
    #[must_use]
    pub fn is_caldav(&self) -> bool {
        self.namespace == Namespace::CALDAV
    }

    /// Returns whether this is a `CardDAV` element.
    #[must_use]
    pub fn is_carddav(&self) -> bool {
        self.namespace == Namespace::CARDDAV
    }
}

impl std::fmt::Display for QName {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{{{}}}{}", self.namespace.as_str(), self.local_name)
    }
}

/// Common DAV property names.
pub mod dav_props {
    use super::QName;

    pub fn resourcetype() -> QName {
        QName::dav("resourcetype")
    }
    pub fn displayname() -> QName {
        QName::dav("displayname")
    }
    pub fn getcontenttype() -> QName {
        QName::dav("getcontenttype")
    }
    pub fn getcontentlength() -> QName {
        QName::dav("getcontentlength")
    }
    pub fn getlastmodified() -> QName {
        QName::dav("getlastmodified")
    }
    pub fn getetag() -> QName {
        QName::dav("getetag")
    }
    pub fn creationdate() -> QName {
        QName::dav("creationdate")
    }
    pub fn current_user_principal() -> QName {
        QName::dav("current-user-principal")
    }
    pub fn principal_url() -> QName {
        QName::dav("principal-URL")
    }
    pub fn supported_report_set() -> QName {
        QName::dav("supported-report-set")
    }
    pub fn sync_token() -> QName {
        QName::dav("sync-token")
    }
    pub fn owner() -> QName {
        QName::dav("owner")
    }
    pub fn quota_available_bytes() -> QName {
        QName::dav("quota-available-bytes")
    }
    pub fn quota_used_bytes() -> QName {
        QName::dav("quota-used-bytes")
    }
}

/// Common `CalDAV` property names.
pub mod caldav_props {
    use super::QName;

    pub fn calendar_home_set() -> QName {
        QName::caldav("calendar-home-set")
    }
    pub fn calendar_description() -> QName {
        QName::caldav("calendar-description")
    }
    pub fn calendar_timezone() -> QName {
        QName::caldav("calendar-timezone")
    }
    pub fn supported_calendar_component_set() -> QName {
        QName::caldav("supported-calendar-component-set")
    }
    pub fn supported_calendar_data() -> QName {
        QName::caldav("supported-calendar-data")
    }
    pub fn max_resource_size() -> QName {
        QName::caldav("max-resource-size")
    }
    pub fn calendar_data() -> QName {
        QName::caldav("calendar-data")
    }
    pub fn calendar_user_address_set() -> QName {
        QName::caldav("calendar-user-address-set")
    }
    pub fn schedule_inbox_url() -> QName {
        QName::caldav("schedule-inbox-URL")
    }
    pub fn schedule_outbox_url() -> QName {
        QName::caldav("schedule-outbox-URL")
    }
}

/// Common `CardDAV` property names.
pub mod carddav_props {
    use super::QName;

    pub fn addressbook_home_set() -> QName {
        QName::carddav("addressbook-home-set")
    }
    pub fn addressbook_description() -> QName {
        QName::carddav("addressbook-description")
    }
    pub fn supported_address_data() -> QName {
        QName::carddav("supported-address-data")
    }
    pub fn max_resource_size() -> QName {
        QName::carddav("max-resource-size")
    }
    pub fn address_data() -> QName {
        QName::carddav("address-data")
    }
    pub fn principal_address() -> QName {
        QName::carddav("principal-address")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qname_display() {
        let qname = QName::dav("resourcetype");
        assert_eq!(qname.to_string(), "{DAV:}resourcetype");
    }

    #[test]
    fn qname_is_dav() {
        let qname = QName::dav("displayname");
        assert!(qname.is_dav());
        assert!(!qname.is_caldav());
    }

    #[test]
    fn namespace_prefix() {
        assert_eq!(Namespace::DAV.default_prefix(), Some("D"));
        assert_eq!(Namespace::CALDAV.default_prefix(), Some("C"));
    }
}
