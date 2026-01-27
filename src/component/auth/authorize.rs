//! Authorization wrappers and utilities.
//!
//! This module re-exports the main authorization API from the service module
//! and provides convenience functions for common authorization patterns.

pub use super::service::{Authorizer, AuthzResult, authorizer_from_depot};

use crate::component::error::AppResult;

use super::{action::Action, resource::ResourceId, subject::ExpandedSubjects};

/// Require ${action} access to a resource.
///
/// ## Errors
///
/// - Returns `AuthorizationError` if access is denied.
/// - Returns `CasbinError` if Casbin evaluation fails.
/// - Returns `InvariantViolation` if the Casbin enforcer is not in the depot.
pub fn handler_require(
    depot: &salvo::Depot,
    subjects: &ExpandedSubjects,
    resource: &ResourceId,
    action: Action,
) -> AppResult<()> {
    authorizer_from_depot(depot)?.require(subjects, resource, action)
}

/// Check ${action} access to a resource.
///
/// ## Errors
/// - Returns `CasbinError` if Casbin evaluation fails.
/// - Returns `InvariantViolation` if the Casbin enforcer is not in the depot.
pub fn handler_check(
    depot: &salvo::Depot,
    subjects: &ExpandedSubjects,
    resource: &ResourceId,
    action: Action,
) -> AppResult<AuthzResult> {
    authorizer_from_depot(depot)?.check(subjects, resource, action)
}
