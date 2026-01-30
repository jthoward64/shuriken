//! DAV error types.

use std::fmt;

use crate::rfc::dav::core::Href;

/// A `WebDAV` error condition.
#[derive(Debug, Clone)]
pub struct DavError {
    /// HTTP status code.
    pub status: u16,
    /// Error description.
    pub message: String,
    /// Optional precondition/postcondition element name.
    pub condition: Option<String>,
}

/// ## Summary
/// Represents a required privilege that was denied (RFC 3744 §7.1.1).
///
/// Used to construct `DAV:need-privileges` error elements when returning
/// 403 Forbidden responses.
#[derive(Debug, Clone)]
pub struct PrivilegeRequired {
    /// Resource href where privilege was required
    pub href: Href,
    /// Privilege that was required (e.g., "read", "write", "read-acl")
    pub privilege: String,
}

impl DavError {
    /// Creates a new DAV error.
    #[must_use]
    pub fn new(status: u16, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
            condition: None,
        }
    }

    /// Creates a DAV error with a precondition.
    #[must_use]
    pub fn with_condition(
        status: u16,
        message: impl Into<String>,
        condition: impl Into<String>,
    ) -> Self {
        Self {
            status,
            message: message.into(),
            condition: Some(condition.into()),
        }
    }

    // Common WebDAV errors

    /// 400 Bad Request
    #[must_use]
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(400, message)
    }

    /// 403 Forbidden
    #[must_use]
    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(403, message)
    }

    /// 404 Not Found
    #[must_use]
    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(404, message)
    }

    /// 405 Method Not Allowed
    #[must_use]
    pub fn method_not_allowed(message: impl Into<String>) -> Self {
        Self::new(405, message)
    }

    /// 409 Conflict
    #[must_use]
    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(409, message)
    }

    /// 412 Precondition Failed
    #[must_use]
    pub fn precondition_failed(message: impl Into<String>) -> Self {
        Self::new(412, message)
    }

    /// 415 Unsupported Media Type
    #[must_use]
    pub fn unsupported_media_type(message: impl Into<String>) -> Self {
        Self::new(415, message)
    }

    /// 422 Unprocessable Entity
    #[must_use]
    pub fn unprocessable_entity(message: impl Into<String>) -> Self {
        Self::new(422, message)
    }

    /// 423 Locked
    #[must_use]
    pub fn locked(message: impl Into<String>) -> Self {
        Self::new(423, message)
    }

    /// 507 Insufficient Storage
    #[must_use]
    pub fn insufficient_storage(message: impl Into<String>) -> Self {
        Self::new(507, message)
    }

    // CalDAV-specific preconditions

    /// calendar-collection-location-ok
    #[must_use]
    pub fn calendar_collection_location_ok() -> Self {
        Self::with_condition(
            403,
            "Calendar collection must be created in calendar home",
            "calendar-collection-location-ok",
        )
    }

    /// valid-calendar-data
    #[must_use]
    pub fn valid_calendar_data(message: impl Into<String>) -> Self {
        Self::with_condition(403, message, "valid-calendar-data")
    }

    /// valid-calendar-object-resource
    #[must_use]
    pub fn valid_calendar_object_resource(message: impl Into<String>) -> Self {
        Self::with_condition(403, message, "valid-calendar-object-resource")
    }

    /// supported-calendar-component
    #[must_use]
    pub fn supported_calendar_component(message: impl Into<String>) -> Self {
        Self::with_condition(403, message, "supported-calendar-component")
    }

    /// no-uid-conflict
    #[must_use]
    pub fn uid_conflict(message: impl Into<String>) -> Self {
        Self::with_condition(403, message, "no-uid-conflict")
    }

    // CardDAV-specific preconditions

    /// valid-address-data
    #[must_use]
    pub fn valid_address_data(message: impl Into<String>) -> Self {
        Self::with_condition(403, message, "valid-address-data")
    }

    /// addressbook-collection-location-ok
    #[must_use]
    pub fn addressbook_collection_location_ok() -> Self {
        Self::with_condition(
            403,
            "Addressbook must be created in addressbook home",
            "addressbook-collection-location-ok",
        )
    }

    // RFC 3744 ACL errors

    /// ## Summary
    /// RFC 3744 §7.1.1: Build `DAV:need-privileges` error XML.
    ///
    /// When a 403 Forbidden is returned due to missing privileges,
    /// this method generates the required XML body listing which privileges
    /// were needed on which resources.
    ///
    /// ## Example
    ///
    /// ```rust
    /// use shuriken_rfc::rfc::dav::core::{DavError, PrivilegeRequired, Href};
    ///
    /// let xml = DavError::need_privileges(&[
    ///     PrivilegeRequired {
    ///         href: Href::new("/calendars/alice/work/"),
    ///         privilege: "read".to_string(),
    ///     },
    ///     PrivilegeRequired {
    ///         href: Href::new("/calendars/alice/work/event.ics"),
    ///         privilege: "write-content".to_string(),
    ///     },
    /// ]);
    /// assert!(xml.contains("<D:need-privileges>"));
    /// assert!(xml.contains("<D:read/>"));
    /// ```
    #[must_use]
    #[allow(clippy::format_push_string)] // write! is preferred but requires std::fmt::Write
    pub fn need_privileges(privileges_required: &[PrivilegeRequired]) -> String {
        let mut xml = String::from(
            r#"<?xml version="1.0" encoding="utf-8"?>
<D:error xmlns:D="DAV:">
  <D:need-privileges>"#,
        );

        for req in privileges_required {
            xml.push_str(&format!(
                r"
    <D:resource>
      <D:href>{}</D:href>
      <D:privilege>
        <D:{}/>
      </D:privilege>
    </D:resource>",
                xml_escape(req.href.as_str()),
                xml_escape(&req.privilege)
            ));
        }

        xml.push_str(
            r"
  </D:need-privileges>
</D:error>",
        );
        xml
    }
}

/// ## Summary
/// XML-escape special characters for safe XML output.
///
/// Escapes: `&`, `<`, `>`, `"`, `'`
fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

impl fmt::Display for DavError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} {}", self.status, self.message)
    }
}

impl std::error::Error for DavError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_new() {
        let err = DavError::new(404, "Resource not found");
        assert_eq!(err.status, 404);
        assert_eq!(err.message, "Resource not found");
        assert!(err.condition.is_none());
    }

    #[test]
    fn error_with_condition() {
        let err = DavError::valid_calendar_data("Invalid iCalendar");
        assert_eq!(err.status, 403);
        assert_eq!(err.condition, Some("valid-calendar-data".to_string()));
    }

    #[test]
    fn error_display() {
        let err = DavError::not_found("Collection does not exist");
        assert_eq!(err.to_string(), "404 Collection does not exist");
    }

    #[test]
    fn need_privileges_single_resource() {
        let xml = DavError::need_privileges(&[PrivilegeRequired {
            href: Href::new("/calendars/alice/work/"),
            privilege: "read".to_string(),
        }]);

        assert!(xml.contains(r#"<?xml version="1.0" encoding="utf-8"?>"#));
        assert!(xml.contains(r#"<D:error xmlns:D="DAV:">"#));
        assert!(xml.contains(r#"<D:need-privileges>"#));
        assert!(xml.contains(r#"<D:resource>"#));
        assert!(xml.contains(r#"<D:href>/calendars/alice/work/</D:href>"#));
        assert!(xml.contains(r#"<D:privilege>"#));
        assert!(xml.contains(r#"<D:read/>"#));
        assert!(xml.contains(r#"</D:need-privileges>"#));
        assert!(xml.contains(r#"</D:error>"#));
    }

    #[test]
    fn need_privileges_multiple_resources() {
        let xml = DavError::need_privileges(&[
            PrivilegeRequired {
                href: Href::new("/calendars/alice/work/"),
                privilege: "read".to_string(),
            },
            PrivilegeRequired {
                href: Href::new("/calendars/alice/work/event.ics"),
                privilege: "write-content".to_string(),
            },
        ]);

        assert!(xml.contains(r#"<D:href>/calendars/alice/work/</D:href>"#));
        assert!(xml.contains(r#"<D:read/>"#));
        assert!(xml.contains(r#"<D:href>/calendars/alice/work/event.ics</D:href>"#));
        assert!(xml.contains(r#"<D:write-content/>"#));
    }

    #[test]
    fn need_privileges_empty() {
        let xml = DavError::need_privileges(&[]);

        assert!(xml.contains(r#"<D:need-privileges>"#));
        assert!(xml.contains(r#"</D:need-privileges>"#));
        // Should have no resource elements
        assert!(!xml.contains(r#"<D:resource>"#));
    }

    #[test]
    fn need_privileges_xml_escaping() {
        let xml = DavError::need_privileges(&[PrivilegeRequired {
            href: Href::new("/path/with<special>&chars\"'"),
            privilege: "read<test>".to_string(),
        }]);

        // Verify XML escaping
        assert!(
            xml.contains(r#"<D:href>/path/with&lt;special&gt;&amp;chars&quot;&apos;</D:href>"#)
        );
        assert!(xml.contains(r#"<D:read&lt;test&gt;/>"#));
        // Should not contain unescaped special chars in content
        assert!(!xml.contains(r#"<D:href>/path/with<special>&chars"'</D:href>"#));
    }

    #[test]
    fn xml_escape_function() {
        assert_eq!(xml_escape("hello"), "hello");
        assert_eq!(xml_escape("a&b"), "a&amp;b");
        assert_eq!(xml_escape("<tag>"), "&lt;tag&gt;");
        assert_eq!(xml_escape(r#""quoted""#), "&quot;quoted&quot;");
        assert_eq!(xml_escape("'apostrophe'"), "&apos;apostrophe&apos;");
        assert_eq!(xml_escape(r#"<&>"'"#), "&lt;&amp;&gt;&quot;&apos;");
    }

    #[test]
    fn privilege_required_construction() {
        let priv_req = PrivilegeRequired {
            href: Href::new("/test/path"),
            privilege: "write".to_string(),
        };

        assert_eq!(priv_req.href.as_str(), "/test/path");
        assert_eq!(priv_req.privilege, "write");
    }
}
