//! DAV:acl property serialization from Casbin policies.
//!
//! This module provides functionality to query Casbin policies for a resource
//! and serialize them into RFC 3744 DAV:acl XML format for PROPFIND responses.

use std::collections::HashMap;
use std::fmt::Write;
use std::sync::Arc;

use casbin::MgmtApi;
use tracing_unwrap::ResultExt;

use super::permission::PermissionLevel;
use crate::error::{ServiceError, ServiceResult};

/// ## Summary
/// Serializes Casbin policies for a resource path into RFC 3744 DAV:acl XML.
///
/// This function queries all policies matching the given resource path and converts
/// them into ACE (Access Control Entry) elements with principal, privilege, and grant/deny.
///
/// ## RFC 3744 Compliance
///
/// Per RFC 3744 §5.5, the DAV:acl property contains a list of ACE elements where each ACE has:
/// - `<principal>`: Who the grant applies to (`<href>` for specific principal, `<all>` for public)
/// - `<grant>` or `<deny>`: Whether this is a permission grant or denial
/// - `<privilege>`: What privileges are granted/denied
///
/// ## Implementation Notes
///
/// - Casbin policies use glob patterns (e.g., `/calendars/alice/**`) which may match the resource
/// - We filter policies to those that glob-match the given path
/// - Policies are grouped by subject (principal) to create one ACE per principal
/// - Only the highest permission level for each principal is returned (owner > admin > edit > read)
/// - The `public` subject is serialized as `<D:all/>` per RFC 3744 §5.5.1
///
/// ## Errors
///
/// Returns error if Casbin policy query fails or if enforcer is not of the correct type.
///
/// ## Example Output
///
/// ```xml
/// <D:acl xmlns:D="DAV:">
///   <D:ace>
///     <D:principal>
///       <D:href>/principals/user-uuid</D:href>
///     </D:principal>
///     <D:grant>
///       <D:privilege><D:read/></D:privilege>
///       <D:privilege><D:write/></D:privilege>
///     </D:grant>
///   </D:ace>
///   <D:ace>
///     <D:principal>
///       <D:all/>
///     </D:principal>
///     <D:grant>
///       <D:privilege><D:read/></D:privilege>
///     </D:grant>
///   </D:ace>
/// </D:acl>
/// ```
pub async fn serialize_acl_for_resource(
    resource_path: &str,
    enforcer: Arc<dyn std::any::Any + Send + Sync>,
) -> ServiceResult<String> {
    // Downcast the Any to Arc<casbin::Enforcer>
    let enforcer = enforcer.downcast::<casbin::Enforcer>().map_err(|_| {
        ServiceError::InvariantViolation("Enforcer is not of type casbin::Enforcer")
    })?;
    // Get all policies from Casbin
    // Format: Vec<Vec<String>> where each inner vec is [subject, path, role]
    let all_policies: Vec<Vec<String>> = enforcer.get_policy();

    // Filter to policies that match this resource path
    let matching_policies = all_policies
        .iter()
        .filter(|policy| {
            // policy format: [subject, path_pattern, role]
            if policy.len() < 3 {
                return false;
            }
            let path_pattern = &policy[1];
            glob_match(resource_path, path_pattern)
        })
        .collect::<Vec<_>>();

    // Group by subject (principal) and find highest permission level
    let mut principal_permissions: HashMap<String, PermissionLevel> = HashMap::new();

    for policy in matching_policies {
        let subject = &policy[0];
        let role = &policy[2];

        if let Some(level) = PermissionLevel::from_casbin_role(role) {
            principal_permissions
                .entry(subject.clone())
                .and_modify(|existing| {
                    if level.ordinal() > existing.ordinal() {
                        *existing = level;
                    }
                })
                .or_insert(level);
        }
    }

    // Serialize to XML
    let mut xml = String::from(r#"<D:acl xmlns:D="DAV:">"#);

    for (subject, level) in principal_permissions {
        xml.push_str("\n  <D:ace>");

        // Principal
        xml.push_str("\n    <D:principal>");
        if subject == "public" {
            xml.push_str("\n      <D:all/>");
        } else {
            // Convert Casbin subject format (e.g., "principal:uuid") to href
            let principal_href = if subject.starts_with("principal:") {
                let uuid = subject.strip_prefix("principal:").unwrap_or(&subject);
                format!("/principals/{uuid}")
            } else {
                format!("/principals/{subject}")
            };
            write!(
                xml,
                "\n      <D:href>{}</D:href>",
                xml_escape(&principal_href)
            )
            .unwrap_or_log();
        }
        xml.push_str("\n    </D:principal>");

        // Grant with privileges
        xml.push_str("\n    <D:grant>");

        // Map permission level to WebDAV privileges
        let privileges = level.webdav_privileges();
        for priv_obj in privileges {
            let priv_name = priv_obj.local_name();
            write!(xml, "\n      <D:privilege><D:{priv_name}/></D:privilege>").unwrap_or_log();
        }

        xml.push_str("\n    </D:grant>");
        xml.push_str("\n  </D:ace>");
    }

    xml.push_str("\n</D:acl>");

    Ok(xml)
}

/// ## Summary
/// Returns the static `DAV:supported-privilege-set` XML for RFC 3744 §5.8.
///
/// This property describes the WebDAV privilege hierarchy supported by the server.
/// It is used by clients to understand what privileges exist and how they relate.
///
/// ## Returns
///
/// XML string containing the privilege hierarchy. This is a static value that doesn't
/// change based on the resource or user.
#[must_use]
pub const fn supported_privilege_set_xml() -> &'static str {
    r#"<D:supported-privilege-set xmlns:D="DAV:">
  <D:supported-privilege>
    <D:privilege><D:all/></D:privilege>
    <D:abstract/>
    <D:description xml:lang="en">Aggregate of all privileges</D:description>
    <D:supported-privilege>
      <D:privilege><D:read/></D:privilege>
      <D:description xml:lang="en">Read resource content and properties</D:description>
    </D:supported-privilege>
    <D:supported-privilege>
      <D:privilege><D:write/></D:privilege>
      <D:description xml:lang="en">Write resource content and properties</D:description>
      <D:supported-privilege>
        <D:privilege><D:write-content/></D:privilege>
        <D:description xml:lang="en">Write resource content</D:description>
      </D:supported-privilege>
      <D:supported-privilege>
        <D:privilege><D:write-properties/></D:privilege>
        <D:description xml:lang="en">Write resource properties</D:description>
      </D:supported-privilege>
    </D:supported-privilege>
    <D:supported-privilege>
      <D:privilege><D:read-acl/></D:privilege>
      <D:description xml:lang="en">Read resource ACL</D:description>
    </D:supported-privilege>
    <D:supported-privilege>
      <D:privilege><D:write-acl/></D:privilege>
      <D:description xml:lang="en">Write resource ACL (NOT SUPPORTED)</D:description>
      <D:abstract/>
    </D:supported-privilege>
  </D:supported-privilege>
</D:supported-privilege-set>"#
}

/// ## Summary
/// Simple glob matching for Casbin path patterns.
///
/// Supports:
/// - `**` for "any depth" (e.g., `/calendars/alice/**` matches `/calendars/alice/events/1.ics`)
/// - `*` for "one segment" (e.g., `/calendars/alice/*` matches `/calendars/alice/events/` but not `/calendars/alice/events/1.ics`)
///
/// ## Side Effects
///
/// None - pure function.
fn glob_match(path: &str, pattern: &str) -> bool {
    // Handle ** (any depth)
    if pattern.ends_with("/**") {
        let prefix = pattern.strip_suffix("/**").unwrap_or(pattern);
        return path.starts_with(prefix);
    }

    // Handle * (single segment)
    if pattern.ends_with("/*") {
        let prefix = pattern.strip_suffix("/*").unwrap_or(pattern);
        if let Some(remainder) = path.strip_prefix(prefix) {
            // Check if there's exactly one more segment (no trailing slashes)
            let remainder = remainder.trim_start_matches('/');
            return !remainder.is_empty() && !remainder.contains('/');
        }
        return false;
    }

    // Exact match
    path == pattern
}

/// ## Summary
/// Escape XML special characters for safe embedding in XML attributes/text.
///
/// ## Side Effects
///
/// None - pure function.
fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_glob_match_double_star() {
        assert!(glob_match(
            "/calendars/alice/events/1.ics",
            "/calendars/alice/**"
        ));
        assert!(glob_match("/calendars/alice/events", "/calendars/alice/**"));
        assert!(!glob_match("/calendars/bob/events", "/calendars/alice/**"));
    }

    #[test]
    fn test_glob_match_single_star() {
        assert!(glob_match("/calendars/alice/events", "/calendars/alice/*"));
        assert!(!glob_match(
            "/calendars/alice/events/1.ics",
            "/calendars/alice/*"
        ));
        assert!(!glob_match("/calendars/bob/events", "/calendars/alice/*"));
    }

    #[test]
    fn test_glob_match_exact() {
        assert!(glob_match("/calendars/alice", "/calendars/alice"));
        assert!(!glob_match("/calendars/alice/events", "/calendars/alice"));
    }

    #[test]
    fn test_xml_escape() {
        assert_eq!(xml_escape("hello"), "hello");
        assert_eq!(xml_escape("<tag>"), "&lt;tag&gt;");
        assert_eq!(xml_escape("a&b"), "a&amp;b");
        assert_eq!(xml_escape("\"quoted\""), "&quot;quoted&quot;");
    }
}
