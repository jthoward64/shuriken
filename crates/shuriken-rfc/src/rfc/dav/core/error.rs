//! DAV error types.

use std::fmt;

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
}
