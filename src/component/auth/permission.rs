//! Permission levels and WebDAV privilege mappings.
//!
//! This module defines the permission hierarchy used by Shuriken's ACL model
//! and provides mappings to WebDAV privileges for `DAV:current-user-privilege-set`.

use std::cmp::Ordering;

use crate::component::error::AppError;

/// Permission levels in Shuriken's ACL model.
///
/// Levels are ordered from lowest to highest. A principal with a higher level
/// has all the capabilities of lower levels.
///
/// ## Privilege Hierarchy (lowest → highest)
///
/// ```text
/// read-freebusy < read < read-share < edit < edit-share < admin < owner
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PermissionLevel {
    /// Can execute free-busy queries but cannot read event bodies.
    ReadFreebusy,
    /// Can read items and metadata.
    Read,
    /// Can read and share at `read` level.
    ReadShare,
    /// Can create/update/delete items.
    Edit,
    /// Can edit and share at `read` or `edit` level.
    EditShare,
    /// Full resource management; can share up to `edit-share`.
    Admin,
    /// Owner semantics; treat as resource owner.
    Owner,
}

impl PermissionLevel {
    /// All permission levels in ascending order.
    pub const ALL: [Self; 7] = [
        Self::ReadFreebusy,
        Self::Read,
        Self::ReadShare,
        Self::Edit,
        Self::EditShare,
        Self::Admin,
        Self::Owner,
    ];

    /// Returns the ordinal index of this level (0 = lowest, 6 = highest).
    #[must_use]
    pub const fn ordinal(self) -> u8 {
        match self {
            Self::ReadFreebusy => 0,
            Self::Read => 1,
            Self::ReadShare => 2,
            Self::Edit => 3,
            Self::EditShare => 4,
            Self::Admin => 5,
            Self::Owner => 6,
        }
    }

    /// Returns the Casbin role string for this level.
    #[must_use]
    pub const fn as_casbin_role(&self) -> &'static str {
        match self {
            Self::ReadFreebusy => "read-freebusy",
            Self::Read => "read",
            Self::ReadShare => "read-share",
            Self::Edit => "edit",
            Self::EditShare => "edit-share",
            Self::Admin => "admin",
            Self::Owner => "owner",
        }
    }

    /// Parse a Casbin role string into a permission level.
    #[must_use]
    pub fn from_casbin_role(role: &str) -> Option<Self> {
        match role {
            "read-freebusy" => Some(Self::ReadFreebusy),
            "read" => Some(Self::Read),
            "read-share" => Some(Self::ReadShare),
            "edit" => Some(Self::Edit),
            "edit-share" => Some(Self::EditShare),
            "admin" => Some(Self::Admin),
            "owner" => Some(Self::Owner),
            _ => None,
        }
    }

    /// Returns the maximum level that can be granted by this level.
    ///
    /// - `ReadShare` → can grant `Read`
    /// - `EditShare` → can grant up to `Edit`
    /// - `Admin` → can grant up to `EditShare`
    /// - `Owner` → can grant up to `Admin`
    /// - Others → cannot grant (returns `None`)
    #[must_use]
    pub const fn share_ceiling(self) -> Option<Self> {
        match self {
            Self::ReadShare => Some(Self::Read),
            Self::EditShare => Some(Self::Edit),
            Self::Admin => Some(Self::EditShare),
            Self::Owner => Some(Self::Admin),
            _ => None,
        }
    }

    /// Returns `true` if this level allows sharing.
    #[must_use]
    pub const fn can_share(self) -> bool {
        self.share_ceiling().is_some()
    }

    /// Returns `true` if this level can grant the target level.
    #[must_use]
    pub const fn can_grant(self, target: Self) -> bool {
        match self.share_ceiling() {
            Some(ceiling) => target.ordinal() <= ceiling.ordinal(),
            None => false,
        }
    }

    /// Ensure the grantor is allowed to grant the target level.
    ///
    /// ## Errors
    /// Returns `AuthorizationError` when the grant would exceed the grantor's share ceiling.
    pub fn ensure_can_grant(self, target: Self) -> Result<(), AppError> {
        if self.can_grant(target) {
            return Ok(());
        }

        Err(AppError::AuthorizationError(format!(
            "Grantor level {self} cannot grant {target}",
        )))
    }

    /// Returns the WebDAV privileges to report for `DAV:current-user-privilege-set`.
    ///
    /// This maps Shuriken's permission levels to WebDAV privileges as defined
    /// in RFC 3744 and the implementation spec (Section 12.1.1).
    #[must_use]
    pub fn webdav_privileges(self) -> &'static [WebDavPrivilege] {
        use WebDavPrivilege::{
            CalDavReadFreeBusy, DavBind, DavRead, DavReadAcl, DavUnbind, DavWriteContent,
            DavWriteProperties,
        };
        match self {
            Self::ReadFreebusy => &[DavRead, CalDavReadFreeBusy],
            Self::Read | Self::ReadShare => &[DavRead],
            Self::Edit | Self::EditShare => &[DavRead, DavWriteContent, DavBind, DavUnbind],
            Self::Admin | Self::Owner => &[
                DavRead,
                DavWriteContent,
                DavWriteProperties,
                DavBind,
                DavUnbind,
                DavReadAcl,
            ],
        }
    }
}

impl PartialOrd for PermissionLevel {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for PermissionLevel {
    fn cmp(&self, other: &Self) -> Ordering {
        self.ordinal().cmp(&other.ordinal())
    }
}

impl std::fmt::Display for PermissionLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_casbin_role())
    }
}

/// WebDAV and CalDAV/CardDAV privileges for `DAV:current-user-privilege-set`.
///
/// These are the non-abstract privileges from the WebDAV privilege hierarchy
/// that Shuriken reports to clients.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum WebDavPrivilege {
    /// `DAV:read` - Read access to resources.
    DavRead,
    /// `DAV:read-acl` - Read access to all user permissions.
    DavReadAcl,
    /// `DAV:write-content` - Modify resource content.
    DavWriteContent,
    /// `DAV:write-properties` - Modify resource properties.
    DavWriteProperties,
    /// `DAV:bind` - Add child resources to a collection.
    DavBind,
    /// `DAV:unbind` - Remove child resources from a collection.
    DavUnbind,
    /// `CALDAV:read-free-busy` - Query free-busy information.
    CalDavReadFreeBusy,
}

impl WebDavPrivilege {
    /// Returns the XML namespace for this privilege.
    #[must_use]
    pub const fn namespace(&self) -> &'static str {
        match self {
            Self::DavRead
            | Self::DavReadAcl
            | Self::DavWriteContent
            | Self::DavWriteProperties
            | Self::DavBind
            | Self::DavUnbind => "DAV:",
            Self::CalDavReadFreeBusy => "urn:ietf:params:xml:ns:caldav",
        }
    }

    /// Returns the local name of this privilege (without namespace).
    #[must_use]
    pub const fn local_name(&self) -> &'static str {
        match self {
            Self::DavRead => "read",
            Self::DavReadAcl => "read-acl",
            Self::DavWriteContent => "write-content",
            Self::DavWriteProperties => "write-properties",
            Self::DavBind => "bind",
            Self::DavUnbind => "unbind",
            Self::CalDavReadFreeBusy => "read-free-busy",
        }
    }

    /// Returns the fully qualified name (namespace + local name) for display.
    #[must_use]
    pub const fn qualified_name(&self) -> &'static str {
        match self {
            Self::DavRead => "DAV:read",
            Self::DavReadAcl => "DAV:read-acl",
            Self::DavWriteContent => "DAV:write-content",
            Self::DavWriteProperties => "DAV:write-properties",
            Self::DavBind => "DAV:bind",
            Self::DavUnbind => "DAV:unbind",
            Self::CalDavReadFreeBusy => "CALDAV:read-free-busy",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permission_ordering() {
        assert!(PermissionLevel::ReadFreebusy < PermissionLevel::Read);
        assert!(PermissionLevel::Read < PermissionLevel::ReadShare);
        assert!(PermissionLevel::ReadShare < PermissionLevel::Edit);
        assert!(PermissionLevel::Edit < PermissionLevel::EditShare);
        assert!(PermissionLevel::EditShare < PermissionLevel::Admin);
        assert!(PermissionLevel::Admin < PermissionLevel::Owner);
    }

    #[test]
    fn casbin_role_roundtrip() {
        for level in PermissionLevel::ALL {
            let role = level.as_casbin_role();
            let parsed = PermissionLevel::from_casbin_role(role);
            assert_eq!(Some(level), parsed, "Roundtrip failed for {level:?}");
        }
    }

    #[test]
    fn share_ceiling_hierarchy() {
        assert_eq!(PermissionLevel::Read.share_ceiling(), None);
        assert_eq!(
            PermissionLevel::ReadShare.share_ceiling(),
            Some(PermissionLevel::Read)
        );
        assert_eq!(
            PermissionLevel::EditShare.share_ceiling(),
            Some(PermissionLevel::Edit)
        );
        assert_eq!(
            PermissionLevel::Admin.share_ceiling(),
            Some(PermissionLevel::EditShare)
        );
        assert_eq!(
            PermissionLevel::Owner.share_ceiling(),
            Some(PermissionLevel::Admin)
        );
    }

    #[test]
    fn can_grant_logic() {
        // ReadShare can grant only Read
        assert!(PermissionLevel::ReadShare.can_grant(PermissionLevel::Read));
        assert!(PermissionLevel::ReadShare.can_grant(PermissionLevel::ReadFreebusy));
        assert!(!PermissionLevel::ReadShare.can_grant(PermissionLevel::Edit));

        // EditShare can grant up to Edit
        assert!(PermissionLevel::EditShare.can_grant(PermissionLevel::Read));
        assert!(PermissionLevel::EditShare.can_grant(PermissionLevel::Edit));
        assert!(!PermissionLevel::EditShare.can_grant(PermissionLevel::EditShare));

        // Admin can grant up to EditShare
        assert!(PermissionLevel::Admin.can_grant(PermissionLevel::EditShare));
        assert!(!PermissionLevel::Admin.can_grant(PermissionLevel::Admin));

        // Owner can grant up to Admin
        assert!(PermissionLevel::Owner.can_grant(PermissionLevel::Admin));
        assert!(!PermissionLevel::Owner.can_grant(PermissionLevel::Owner));
    }

    #[test]
    fn ensure_can_grant_errors() {
        assert!(
            PermissionLevel::EditShare
                .ensure_can_grant(PermissionLevel::Edit)
                .is_ok()
        );
        assert!(
            PermissionLevel::EditShare
                .ensure_can_grant(PermissionLevel::EditShare)
                .is_err()
        );
    }
}
