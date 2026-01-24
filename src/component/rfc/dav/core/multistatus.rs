//! Multistatus response types.

use super::href::Href;
use super::property::DavProperty;

/// A multistatus response (RFC 4918 §13).
#[derive(Debug, Clone)]
pub struct Multistatus {
    /// Individual responses.
    pub responses: Vec<PropstatResponse>,
    /// Optional response description.
    pub description: Option<String>,
    /// Sync token (for sync-collection).
    pub sync_token: Option<String>,
}

impl Multistatus {
    /// Creates an empty multistatus.
    #[must_use]
    pub fn new() -> Self {
        Self {
            responses: Vec::new(),
            description: None,
            sync_token: None,
        }
    }

    /// Adds a response.
    pub fn add_response(&mut self, response: PropstatResponse) {
        self.responses.push(response);
    }

    /// Sets the sync token.
    pub fn set_sync_token(&mut self, token: impl Into<String>) {
        self.sync_token = Some(token.into());
    }

    /// Returns true if empty.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.responses.is_empty()
    }
}

impl Default for Multistatus {
    fn default() -> Self {
        Self::new()
    }
}

/// A single response within a multistatus.
#[derive(Debug, Clone)]
pub struct PropstatResponse {
    /// The resource href.
    pub href: Href,
    /// Property statuses grouped by status code.
    pub propstats: Vec<Propstat>,
    /// Optional error element.
    pub error: Option<String>,
    /// Optional response description.
    pub description: Option<String>,
}

impl PropstatResponse {
    /// Creates a response for a resource.
    #[must_use]
    pub fn new(href: impl Into<Href>) -> Self {
        Self {
            href: href.into(),
            propstats: Vec::new(),
            error: None,
            description: None,
        }
    }

    /// Creates a simple 200 OK response with properties.
    #[must_use]
    pub fn ok(href: impl Into<Href>, properties: Vec<DavProperty>) -> Self {
        Self {
            href: href.into(),
            propstats: vec![Propstat {
                status: Status::Ok,
                properties,
                description: None,
            }],
            error: None,
            description: None,
        }
    }

    /// Creates a response with found and not-found properties.
    #[must_use]
    pub fn with_found_and_not_found(
        href: impl Into<Href>,
        found: Vec<DavProperty>,
        not_found: Vec<DavProperty>,
    ) -> Self {
        let mut propstats = Vec::new();

        if !found.is_empty() {
            propstats.push(Propstat {
                status: Status::Ok,
                properties: found,
                description: None,
            });
        }

        if !not_found.is_empty() {
            propstats.push(Propstat {
                status: Status::NotFound,
                properties: not_found,
                description: None,
            });
        }

        Self {
            href: href.into(),
            propstats,
            error: None,
            description: None,
        }
    }

    /// Creates a 404 Not Found response.
    #[must_use]
    pub fn not_found(href: impl Into<Href>) -> Self {
        Self {
            href: href.into(),
            propstats: vec![Propstat {
                status: Status::NotFound,
                properties: Vec::new(),
                description: None,
            }],
            error: None,
            description: None,
        }
    }

    /// Creates an error response with a status.
    #[must_use]
    pub fn error(href: impl Into<Href>, status: Status, message: impl Into<String>) -> Self {
        Self {
            href: href.into(),
            propstats: vec![Propstat {
                status,
                properties: Vec::new(),
                description: Some(message.into()),
            }],
            error: None,
            description: None,
        }
    }

    /// Adds a propstat to the response.
    pub fn add_propstat(&mut self, propstat: Propstat) {
        self.propstats.push(propstat);
    }
}

/// Property status grouping.
#[derive(Debug, Clone)]
pub struct Propstat {
    /// HTTP status.
    pub status: Status,
    /// Properties with this status.
    pub properties: Vec<DavProperty>,
    /// Optional description.
    pub description: Option<String>,
}

impl Propstat {
    /// Creates a new propstat.
    #[must_use]
    pub fn new(status: Status, properties: Vec<DavProperty>) -> Self {
        Self {
            status,
            properties,
            description: None,
        }
    }
}

/// HTTP status for propstat.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    /// 200 OK
    Ok,
    /// 201 Created
    Created,
    /// 204 No Content
    NoContent,
    /// 403 Forbidden
    Forbidden,
    /// 404 Not Found
    NotFound,
    /// 409 Conflict
    Conflict,
    /// 412 Precondition Failed
    PreconditionFailed,
    /// 424 Failed Dependency
    FailedDependency,
    /// 507 Insufficient Storage
    InsufficientStorage,
    /// Custom status
    Custom(u16),
}

impl Status {
    /// Returns the status code.
    #[must_use]
    pub const fn code(&self) -> u16 {
        match self {
            Self::Ok => 200,
            Self::Created => 201,
            Self::NoContent => 204,
            Self::Forbidden => 403,
            Self::NotFound => 404,
            Self::Conflict => 409,
            Self::PreconditionFailed => 412,
            Self::FailedDependency => 424,
            Self::InsufficientStorage => 507,
            Self::Custom(code) => *code,
        }
    }

    /// Returns the status line.
    #[must_use]
    pub fn status_line(&self) -> String {
        format!("HTTP/1.1 {} {}", self.code(), self.reason_phrase())
    }

    /// Returns the reason phrase.
    #[must_use]
    pub const fn reason_phrase(&self) -> &'static str {
        match self {
            Self::Ok => "OK",
            Self::Created => "Created",
            Self::NoContent => "No Content",
            Self::Forbidden => "Forbidden",
            Self::NotFound => "Not Found",
            Self::Conflict => "Conflict",
            Self::PreconditionFailed => "Precondition Failed",
            Self::FailedDependency => "Failed Dependency",
            Self::InsufficientStorage => "Insufficient Storage",
            Self::Custom(_) => "Unknown",
        }
    }
}

impl From<u16> for Status {
    fn from(code: u16) -> Self {
        match code {
            200 => Self::Ok,
            201 => Self::Created,
            204 => Self::NoContent,
            403 => Self::Forbidden,
            404 => Self::NotFound,
            409 => Self::Conflict,
            412 => Self::PreconditionFailed,
            424 => Self::FailedDependency,
            507 => Self::InsufficientStorage,
            _ => Self::Custom(code),
        }
    }
}

/// Response description wrapper.
#[derive(Debug, Clone)]
pub struct ResponseDescription(pub String);

impl ResponseDescription {
    /// Creates a new description.
    #[must_use]
    pub fn new(s: impl Into<String>) -> Self {
        Self(s.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::component::rfc::dav::core::namespace::QName;

    #[test]
    fn multistatus_new() {
        let ms = Multistatus::new();
        assert!(ms.is_empty());
    }

    #[test]
    fn propstat_response_ok() {
        let resp = PropstatResponse::ok(
            "/calendars/user/cal/",
            vec![DavProperty::text(QName::dav("displayname"), "My Calendar")],
        );
        assert_eq!(resp.propstats.len(), 1);
        assert_eq!(resp.propstats[0].status, Status::Ok);
    }

    #[test]
    fn propstat_response_with_not_found() {
        let resp = PropstatResponse::with_found_and_not_found(
            "/calendars/user/cal/",
            vec![DavProperty::text(QName::dav("displayname"), "My Calendar")],
            vec![DavProperty::not_found(QName::caldav("calendar-description"))],
        );
        assert_eq!(resp.propstats.len(), 2);
    }

    #[test]
    fn status_line() {
        assert_eq!(Status::Ok.status_line(), "HTTP/1.1 200 OK");
        assert_eq!(Status::NotFound.status_line(), "HTTP/1.1 404 Not Found");
    }
}
