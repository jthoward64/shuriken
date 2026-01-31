//! Authentication and authorization flow.
//!
//! ## Module Organization
//!
//! - `acl`: DAV:acl property serialization from Casbin policies
//! - `action`: Authorization actions for Casbin enforcement (read, write, `share_grant`)
//! - `authenticate`: User authentication (single user, proxy)
//! - `authorize`: Authorization wrappers and convenience functions
//! - `casbin`: Casbin enforcer initialization and depot integration
//! - `depot`: Helpers for extracting authorization context from Salvo requests
//! - `password`: Password hashing and verification with Argon2
//! - `permission`: Permission levels and WebDAV privilege mappings
//! - `privilege`: WebDAV privilege set generation for `DAV:current-user-privilege-set`
//! - `resource`: Resource types and identifiers for authorization
//! - `service`: Centralized authorization service (`Authorizer`)
//! - `subject`: Subject types and principal expansion

pub mod acl;
pub mod action;
pub mod authenticate;
pub mod authorize;
pub mod casbin;
pub mod depot;
pub mod password;
pub mod permission;
pub mod privilege;
pub mod resource;
pub mod service;
pub mod subject;

#[cfg(test)]
mod casbin_test;

// Re-export commonly used types at module level
pub use acl::{
    serialize_acl_for_resource, supported_privilege_set_xml as acl_supported_privilege_set_xml,
};
pub use action::{Action, HttpMethod, MethodContext, action_for_method};
pub use authorize::{
    Authorizer, AuthzResult, authorizer_from_depot, handler_check, handler_require,
};
pub use depot::{
    get_collection_chain_from_depot, get_expanded_subjects, get_instance_from_depot,
    get_owner_principal_from_depot, get_resolved_location_from_depot, get_subjects_from_depot,
    get_terminal_collection_from_depot, get_user_from_depot,
};
pub use permission::{PermissionLevel, WebDavPrivilege};
pub use privilege::{PrivilegeSetBuilder, privileges_for_level, supported_privilege_set_xml};
pub use resource::{PathSegment, ResourceIdentifier, ResourceLocation, ResourceType};
pub use subject::{ExpandedSubjects, Subject};
