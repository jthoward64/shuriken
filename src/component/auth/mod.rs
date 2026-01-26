//! Authentication and authorization flow.
//!
//! ## Module Organization
//!
//! - `action`: Authorization actions for Casbin enforcement (read, write, `share_grant`)
//! - `authenticate`: User authentication (single user, proxy)
//! - `authorize`: Authorization wrappers and convenience functions
//! - `casbin`: Casbin enforcer initialization and depot integration
//! - `depot`: Helpers for extracting authorization context from Salvo requests
//! - `permission`: Permission levels and WebDAV privilege mappings
//! - `privilege`: WebDAV privilege set generation for `DAV:current-user-privilege-set`
//! - `resource`: Resource types and identifiers for authorization
//! - `service`: Centralized authorization service (`Authorizer`)
//! - `subject`: Subject types and principal expansion

pub mod action;
pub mod authenticate;
pub mod authorize;
pub mod casbin;
pub mod depot;
pub mod permission;
pub mod privilege;
pub mod resource;
pub mod service;
pub mod subject;

#[cfg(test)]
mod casbin_test;

// Re-export commonly used types at module level
pub use action::{Action, HttpMethod, MethodContext, action_for_method};
pub use authorize::{
    Authorizer, AuthzResult, authorizer_from_depot, check_read, check_write, require_read,
    require_read_freebusy, require_write,
};
pub use depot::{get_expanded_subjects, get_subjects_from_depot, get_user_from_depot};
pub use permission::{PermissionLevel, WebDavPrivilege};
pub use privilege::{PrivilegeSetBuilder, privileges_for_level, supported_privilege_set_xml};
pub use resource::{ResourceId, ResourceType};
pub use subject::{ExpandedSubjects, Subject};
