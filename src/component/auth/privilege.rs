//! WebDAV privilege set generation for `DAV:current-user-privilege-set`.
//!
//! This module generates the privilege set XML that clients request via PROPFIND
//! to discover what operations they can perform on a resource.

use std::fmt::Write;

use tracing_unwrap::ResultExt;

use super::permission::{PermissionLevel, WebDavPrivilege};

/// Generates the set of WebDAV privileges for a given permission level.
///
/// This is used to populate the `DAV:current-user-privilege-set` property.
///
/// ## Returns
///
/// A deduplicated list of non-abstract WebDAV privileges that the permission
/// level grants. The privileges are based on the mapping in Section 12.1.1.
#[must_use]
pub fn privileges_for_level(level: PermissionLevel) -> Vec<WebDavPrivilege> {
    let base = level.webdav_privileges();
    let mut result: Vec<WebDavPrivilege> = base.to_vec();

    // Deduplicate (in case of overlapping privilege definitions)
    result.sort_by_key(WebDavPrivilege::qualified_name);
    result.dedup_by_key(|p| p.qualified_name());

    result
}

/// A builder for generating `DAV:current-user-privilege-set` XML.
///
/// ## Example
///
/// ```ignore
/// let builder = PrivilegeSetBuilder::for_level(PermissionLevel::Edit);
/// let xml = builder.to_xml();
/// // <current-user-privilege-set xmlns="DAV:">
/// //   <privilege><read/></privilege>
/// //   <privilege><write-content/></privilege>
/// //   <privilege><bind/></privilege>
/// //   <privilege><unbind/></privilege>
/// // </current-user-privilege-set>
/// ```
pub struct PrivilegeSetBuilder {
    privileges: Vec<WebDavPrivilege>,
}

impl PrivilegeSetBuilder {
    /// Create a builder for a given permission level.
    #[must_use]
    pub fn for_level(level: PermissionLevel) -> Self {
        Self {
            privileges: privileges_for_level(level),
        }
    }

    /// Create an empty builder (no privileges).
    #[must_use]
    pub fn empty() -> Self {
        Self {
            privileges: Vec::new(),
        }
    }

    /// Add a privilege to the set.
    pub fn add_privilege(&mut self, privilege: WebDavPrivilege) -> &mut Self {
        if !self.privileges.contains(&privilege) {
            self.privileges.push(privilege);
        }
        self
    }

    /// Returns the privileges in this set.
    #[must_use]
    pub fn privileges(&self) -> &[WebDavPrivilege] {
        &self.privileges
    }

    /// Generate the XML content for `DAV:current-user-privilege-set`.
    ///
    /// This returns the inner content (the `<privilege>` elements), not the
    /// outer `<current-user-privilege-set>` wrapper. The caller should wrap
    /// this in the appropriate element.
    #[must_use]
    pub fn to_privilege_elements(&self) -> String {
        let mut xml = String::new();

        for privilege in &self.privileges {
            let ns = privilege.namespace();
            let local = privilege.local_name();

            // Use qualified names for non-DAV privileges
            if ns == "DAV:" {
                write!(xml, "<D:privilege><D:{local}/></D:privilege>").ok_or_log();
            } else {
                // For CalDAV/CardDAV privileges, include the namespace
                let prefix = match ns {
                    "urn:ietf:params:xml:ns:caldav" => "C",
                    "urn:ietf:params:xml:ns:carddav" => "A",
                    _ => continue, // Skip unknown namespaces
                };
                write!(
                    xml,
                    "<D:privilege><{prefix}:{local} xmlns:{prefix}=\"{ns}\"/></D:privilege>"
                )
                .ok_or_log();
            }
        }

        xml
    }

    /// Generate a full `DAV:current-user-privilege-set` element.
    #[must_use]
    pub fn to_xml(&self) -> String {
        format!(
            "<D:current-user-privilege-set xmlns:D=\"DAV:\">{}</D:current-user-privilege-set>",
            self.to_privilege_elements()
        )
    }
}

/// Generates `DAV:supported-privilege-set` content.
///
/// This returns a static representation of the WebDAV privilege hierarchy
/// that Shuriken supports. Clients use this to understand the available
/// privileges.
///
/// ## Notes
///
/// - `DAV:write-acl` is NOT included because Shuriken does not support
///   generic WebDAV ACL mutation.
/// - `DAV:unlock` is NOT included because Shuriken does not implement LOCK.
#[must_use]
pub fn supported_privilege_set_xml() -> &'static str {
    r#"<D:supported-privilege-set xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:supported-privilege>
    <D:privilege><D:all/></D:privilege>
    <D:abstract/>
    <D:description xml:lang="en">All privileges</D:description>
    <D:supported-privilege>
      <D:privilege><D:read/></D:privilege>
      <D:description xml:lang="en">Read resource content and properties</D:description>
      <D:supported-privilege>
        <D:privilege><D:read-acl/></D:privilege>
        <D:description xml:lang="en">Read access control list</D:description>
      </D:supported-privilege>
      <D:supported-privilege>
        <D:privilege><D:read-current-user-privilege-set/></D:privilege>
        <D:description xml:lang="en">Read current user's privileges</D:description>
      </D:supported-privilege>
    </D:supported-privilege>
    <D:supported-privilege>
      <D:privilege><D:write/></D:privilege>
      <D:abstract/>
      <D:description xml:lang="en">Write to resource</D:description>
      <D:supported-privilege>
        <D:privilege><D:write-properties/></D:privilege>
        <D:description xml:lang="en">Write resource properties</D:description>
      </D:supported-privilege>
      <D:supported-privilege>
        <D:privilege><D:write-content/></D:privilege>
        <D:description xml:lang="en">Write resource content</D:description>
      </D:supported-privilege>
      <D:supported-privilege>
        <D:privilege><D:bind/></D:privilege>
        <D:description xml:lang="en">Add child resources</D:description>
      </D:supported-privilege>
      <D:supported-privilege>
        <D:privilege><D:unbind/></D:privilege>
        <D:description xml:lang="en">Remove child resources</D:description>
      </D:supported-privilege>
    </D:supported-privilege>
    <D:supported-privilege>
      <D:privilege><C:read-free-busy/></D:privilege>
      <D:description xml:lang="en">Query free-busy information</D:description>
    </D:supported-privilege>
  </D:supported-privilege>
</D:supported-privilege-set>"#
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn privileges_for_read() {
        let privs = privileges_for_level(PermissionLevel::Read);
        assert_eq!(privs.len(), 1);
        assert!(privs.contains(&WebDavPrivilege::DavRead));
    }

    #[test]
    fn privileges_for_edit() {
        let privs = privileges_for_level(PermissionLevel::Edit);
        assert!(privs.contains(&WebDavPrivilege::DavRead));
        assert!(privs.contains(&WebDavPrivilege::DavWriteContent));
        assert!(privs.contains(&WebDavPrivilege::DavBind));
        assert!(privs.contains(&WebDavPrivilege::DavUnbind));
    }

    #[test]
    fn privileges_for_freebusy() {
        let privs = privileges_for_level(PermissionLevel::ReadFreebusy);
        assert!(privs.contains(&WebDavPrivilege::DavRead));
        assert!(privs.contains(&WebDavPrivilege::CalDavReadFreeBusy));
    }

    #[test]
    fn privilege_set_xml_generation() {
        let builder = PrivilegeSetBuilder::for_level(PermissionLevel::Read);
        let xml = builder.to_privilege_elements();
        assert!(xml.contains("<D:privilege>"));
        assert!(xml.contains("<D:read/>"));
    }

    #[test]
    fn supported_privilege_set_is_valid() {
        let xml = supported_privilege_set_xml();
        assert!(xml.contains("<D:supported-privilege-set"));
        assert!(xml.contains("<D:read/>"));
        assert!(xml.contains("<D:write/>"));
        assert!(xml.contains("<C:read-free-busy/>"));
        // Should NOT contain write-acl (not supported)
        assert!(!xml.contains("<D:write-acl/>"));
    }
}
