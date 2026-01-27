//! Authorization actions for Casbin enforcement.
//!
//! Actions are the operations that can be performed on resources. They map directly
//! to the permission types in the Casbin model.

/// Actions that can be performed on resources.
///
/// These are used as the `act` parameter in Casbin enforcement requests and
/// map directly to the permissions defined in the g2 role mappings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Action {
    /// Read free-busy information only (CalDAV).
    ReadFreebusy,
    /// Read items and metadata (GET, PROPFIND, REPORT queries).
    Read,
    /// Edit/update items (PUT for existing resources).
    Edit,
    /// Delete items (DELETE).
    Delete,
    /// Share resource with read permissions.
    ShareRead,
    /// Share resource with edit permissions.
    ShareEdit,
    /// Administrative actions (manage ACLs, collection properties).
    Admin,
}

impl Action {
    /// Returns the Casbin action string for this action.
    #[must_use]
    pub const fn as_casbin_action(&self) -> &'static str {
        match self {
            Self::ReadFreebusy => "read_freebusy",
            Self::Read => "read",
            Self::Edit => "edit",
            Self::Delete => "delete",
            Self::ShareRead => "share_read",
            Self::ShareEdit => "share_edit",
            Self::Admin => "admin",
        }
    }

    /// Parse a Casbin action string into an action.
    #[must_use]
    pub fn from_casbin_action(action: &str) -> Option<Self> {
        match action {
            "read_freebusy" => Some(Self::ReadFreebusy),
            "read" => Some(Self::Read),
            "edit" => Some(Self::Edit),
            "delete" => Some(Self::Delete),
            "share_read" => Some(Self::ShareRead),
            "share_edit" => Some(Self::ShareEdit),
            "admin" => Some(Self::Admin),
            _ => None,
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
/// ## Method-to-Action Mapping
///
/// - `OPTIONS`, `GET`, `HEAD`, `PROPFIND`, `REPORT` → `Read`
/// - `PROPPATCH` → `Edit` (modifies properties)
/// - `PUT` (existing) → `Edit`
/// - `PUT` (new) → `Edit` on parent collection
/// - `DELETE` → `Delete`
/// - `MOVE` → `Delete` on source + `Edit` on destination
/// - `COPY` → `Read` + `Edit` on destination
/// - `MKCOL`, `MKCALENDAR` → `Edit` on parent
/// - `ACL` → `Admin`
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
    /// - For `PUT`, `DELETE`, `MOVE`, and `COPY`, additional context may be needed
    /// - For `MOVE` and `COPY`, both source and destination must be authorized
    /// - `ACL` requires `Admin` permission
    #[must_use]
    pub const fn primary_action(self) -> Action {
        match self {
            Self::Options | Self::Get | Self::Head | Self::Propfind | Self::Report => Action::Read,
            Self::Put
            | Self::Proppatch
            | Self::Mkcol
            | Self::Mkcalendar
            | Self::Copy
            | Self::Move => Action::Edit,
            Self::Delete => Action::Delete,
            Self::Acl => Action::Admin,
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
        | HttpMethod::Proppatch
        | HttpMethod::Mkcol
        | HttpMethod::Mkcalendar
        | HttpMethod::Copy
        | HttpMethod::Move => Action::Edit,
        HttpMethod::Delete => Action::Delete,
        HttpMethod::Acl => Action::Admin,
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
            Action::Edit,
            Action::Delete,
            Action::ShareRead,
            Action::ShareEdit,
            Action::Admin,
        ];

        for action in actions {
            let casbin_str = action.as_casbin_action();
            let parsed = Action::from_casbin_action(casbin_str);
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

    #[test]
    fn method_actions() {
        assert_eq!(HttpMethod::Get.primary_action(), Action::Read);
        assert_eq!(HttpMethod::Put.primary_action(), Action::Edit);
        assert_eq!(HttpMethod::Delete.primary_action(), Action::Delete);
        assert_eq!(HttpMethod::Acl.primary_action(), Action::Admin);
    }
}
