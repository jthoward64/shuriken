//! Authorization actions for Casbin enforcement.
//!
//! Actions are the operations that can be performed on resources. They map to
//! HTTP methods and WebDAV privileges per RFC 3744 Appendix B.

use super::permission::PermissionLevel;

/// Actions that can be performed on resources.
///
/// These are used as the `act` parameter in Casbin enforcement requests.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Action {
    /// Read free-busy information only (CalDAV).
    ReadFreebusy,
    /// Read items and metadata (GET, PROPFIND, REPORT queries).
    Read,
    /// Create/update/delete items (PUT, DELETE, MOVE).
    Write,
    /// Grant a specific permission level to another principal.
    ShareGrant(PermissionLevel),
}

impl Action {
    /// Returns the Casbin action string for this action.
    #[must_use]
    pub fn as_casbin_action(&self) -> String {
        match self {
            Self::ReadFreebusy => "read_freebusy".to_string(),
            Self::Read => "read".to_string(),
            Self::Write => "write".to_string(),
            Self::ShareGrant(level) => format!("share_grant:{}", level.as_casbin_role()),
        }
    }

    /// Parse a Casbin action string into an action.
    #[must_use]
    pub fn from_casbin_action(action: &str) -> Option<Self> {
        match action {
            "read_freebusy" => Some(Self::ReadFreebusy),
            "read" => Some(Self::Read),
            "write" => Some(Self::Write),
            _ if action.starts_with("share_grant:") => {
                let level_str = action.strip_prefix("share_grant:")?;
                let level = PermissionLevel::from_casbin_role(level_str)?;
                Some(Self::ShareGrant(level))
            }
            _ => None,
        }
    }

    /// Returns the minimum permission level required for this action.
    ///
    /// This is used for quick checks when the resource type is known.
    #[must_use]
    pub const fn minimum_level(&self) -> PermissionLevel {
        match self {
            Self::ReadFreebusy => PermissionLevel::ReadFreebusy,
            Self::Read => PermissionLevel::Read,
            Self::Write => PermissionLevel::Edit,
            Self::ShareGrant(_) => PermissionLevel::ReadShare, // Lowest share-capable level
        }
    }
}

impl std::fmt::Display for Action {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_casbin_action())
    }
}

/// Maps HTTP methods to authorization actions per RFC 3744 Appendix B.
///
/// ## Method-to-Privilege Expectations
///
/// - `OPTIONS` → `DAV:read`
/// - `GET`/`HEAD` → `DAV:read`
/// - `PROPFIND` → `DAV:read` (+ `DAV:read-acl` when requesting `DAV:acl`)
/// - `PROPPATCH` → `DAV:write-properties`
/// - `PUT` (existing target) → `DAV:write-content`
/// - `PUT` (new target) → `DAV:bind` on parent collection
/// - `DELETE` → `DAV:unbind` on parent collection
/// - `MOVE` → `DAV:unbind` on source + `DAV:bind` on destination
/// - `COPY` → `DAV:read` + `DAV:write-content`/`DAV:write-properties`
/// - `REPORT` → `DAV:read` on all referenced resources
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum HttpMethod {
    Options,
    Get,
    Head,
    Put,
    Delete,
    Propfind,
    Proppatch,
    Mkcol,
    Mkcalendar,
    Copy,
    Move,
    Report,
    Acl,
}

impl HttpMethod {
    /// Parse an HTTP method string into an `HttpMethod`.
    #[must_use]
    pub fn parse(method: &str) -> Option<Self> {
        match method.to_ascii_uppercase().as_str() {
            "OPTIONS" => Some(Self::Options),
            "GET" => Some(Self::Get),
            "HEAD" => Some(Self::Head),
            "PUT" => Some(Self::Put),
            "DELETE" => Some(Self::Delete),
            "PROPFIND" => Some(Self::Propfind),
            "PROPPATCH" => Some(Self::Proppatch),
            "MKCOL" => Some(Self::Mkcol),
            "MKCALENDAR" => Some(Self::Mkcalendar),
            "COPY" => Some(Self::Copy),
            "MOVE" => Some(Self::Move),
            "REPORT" => Some(Self::Report),
            "ACL" => Some(Self::Acl),
            _ => None,
        }
    }

    /// Returns the primary action required for this method.
    ///
    /// ## Notes
    ///
    /// - For `PUT`, `DELETE`, `MOVE`, and `COPY`, additional context is needed
    ///   to determine if the operation is on an existing or new resource.
    /// - For `MOVE` and `COPY`, both source and destination must be authorized.
    /// - `PROPPATCH` requires `Write` because it modifies properties.
    #[must_use]
    pub const fn primary_action(self) -> Action {
        match self {
            Self::Options | Self::Get | Self::Head | Self::Propfind | Self::Report => Action::Read,
            Self::Put
            | Self::Delete
            | Self::Proppatch
            | Self::Mkcol
            | Self::Mkcalendar
            | Self::Copy
            | Self::Move
            | Self::Acl => Action::Write,
        }
    }
}

/// Context for method authorization that may affect which action is required.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MethodContext {
    /// Whether the target resource already exists.
    pub target_exists: bool,
    /// Whether this is a free-busy query (for REPORT).
    pub is_freebusy_query: bool,
}

impl Default for MethodContext {
    fn default() -> Self {
        Self {
            target_exists: true,
            is_freebusy_query: false,
        }
    }
}

impl MethodContext {
    /// Create a context for an existing resource.
    #[must_use]
    pub const fn existing() -> Self {
        Self {
            target_exists: true,
            is_freebusy_query: false,
        }
    }

    /// Create a context for a new resource.
    #[must_use]
    pub const fn new_resource() -> Self {
        Self {
            target_exists: false,
            is_freebusy_query: false,
        }
    }

    /// Create a context for a free-busy query.
    #[must_use]
    pub const fn freebusy() -> Self {
        Self {
            target_exists: true,
            is_freebusy_query: true,
        }
    }
}

/// Determine the action required for a method with additional context.
///
/// ## Summary
///
/// Maps HTTP methods to authorization actions, taking into account context
/// like whether the target exists (for PUT) or if it's a free-busy query.
#[must_use]
pub fn action_for_method(method: HttpMethod, context: MethodContext) -> Action {
    match method {
        HttpMethod::Report if context.is_freebusy_query => Action::ReadFreebusy,
        HttpMethod::Report => Action::Read,

        HttpMethod::Options | HttpMethod::Get | HttpMethod::Head | HttpMethod::Propfind => {
            Action::Read
        }

        HttpMethod::Put
        | HttpMethod::Delete
        | HttpMethod::Proppatch
        | HttpMethod::Mkcol
        | HttpMethod::Mkcalendar
        | HttpMethod::Copy
        | HttpMethod::Move
        | HttpMethod::Acl => Action::Write,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_casbin_roundtrip() {
        let actions = [
            Action::ReadFreebusy,
            Action::Read,
            Action::Write,
            Action::ShareGrant(PermissionLevel::Read),
            Action::ShareGrant(PermissionLevel::EditShare),
        ];

        for action in actions {
            let casbin_str = action.as_casbin_action();
            let parsed = Action::from_casbin_action(&casbin_str);
            assert_eq!(Some(action), parsed, "Roundtrip failed for {action:?}");
        }
    }

    #[test]
    fn method_parsing() {
        assert_eq!(HttpMethod::parse("GET"), Some(HttpMethod::Get));
        assert_eq!(HttpMethod::parse("get"), Some(HttpMethod::Get));
        assert_eq!(HttpMethod::parse("PROPFIND"), Some(HttpMethod::Propfind));
        assert_eq!(HttpMethod::parse("UNKNOWN"), None);
    }

    #[test]
    fn freebusy_report_action() {
        let action = action_for_method(HttpMethod::Report, MethodContext::freebusy());
        assert_eq!(action, Action::ReadFreebusy);

        let action = action_for_method(HttpMethod::Report, MethodContext::existing());
        assert_eq!(action, Action::Read);
    }
}
