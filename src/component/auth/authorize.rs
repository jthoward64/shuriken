//! Authorization wrappers and utilities.
//!
//! This module re-exports the main authorization API from the service module
//! and provides convenience functions for common authorization patterns.

pub use super::service::{Authorizer, AuthzResult, authorizer_from_depot, require_legacy};

use crate::component::error::AppResult;

use super::{action::Action, resource::ResourceId, subject::ExpandedSubjects};

/// Require read access to a resource.
///
/// ## Errors
///
/// - Returns `AuthorizationError` if access is denied.
/// - Returns `CasbinError` if Casbin evaluation fails.
/// - Returns `InvariantViolation` if the Casbin enforcer is not in the depot.
pub fn require_read(
    depot: &salvo::Depot,
    subjects: &ExpandedSubjects,
    resource: &ResourceId,
) -> AppResult<()> {
    authorizer_from_depot(depot)?
        .require(subjects, resource, Action::Read)
        .map(|_| ())
}

/// Require write access to a resource.
///
/// ## Errors
///
/// - Returns `AuthorizationError` if access is denied.
/// - Returns `CasbinError` if Casbin evaluation fails.
/// - Returns `InvariantViolation` if the Casbin enforcer is not in the depot.
pub fn require_write(
    depot: &salvo::Depot,
    subjects: &ExpandedSubjects,
    resource: &ResourceId,
) -> AppResult<()> {
    authorizer_from_depot(depot)?
        .require(subjects, resource, Action::Write)
        .map(|_| ())
}

/// Require free-busy read access to a resource (CalDAV only).
///
/// ## Errors
///
/// - Returns `AuthorizationError` if access is denied.
/// - Returns `CasbinError` if Casbin evaluation fails.
/// - Returns `InvariantViolation` if the Casbin enforcer is not in the depot.
pub fn require_read_freebusy(
    depot: &salvo::Depot,
    subjects: &ExpandedSubjects,
    resource: &ResourceId,
) -> AppResult<()> {
    authorizer_from_depot(depot)?
        .require(subjects, resource, Action::ReadFreebusy)
        .map(|_| ())
}

/// Check read access without requiring it.
///
/// ## Errors
///
/// Returns `CasbinError` if Casbin evaluation fails.
/// Returns `InvariantViolation` if the Casbin enforcer is not in the depot.
pub fn check_read(
    depot: &salvo::Depot,
    subjects: &ExpandedSubjects,
    resource: &ResourceId,
) -> AppResult<AuthzResult> {
    authorizer_from_depot(depot)?.check(subjects, resource, Action::Read)
}

/// Check write access without requiring it.
///
/// ## Errors
///
/// Returns `CasbinError` if Casbin evaluation fails.
/// Returns `InvariantViolation` if the Casbin enforcer is not in the depot.
pub fn check_write(
    depot: &salvo::Depot,
    subjects: &ExpandedSubjects,
    resource: &ResourceId,
) -> AppResult<AuthzResult> {
    authorizer_from_depot(depot)?.check(subjects, resource, Action::Write)
}

/// Re-export the legacy require function for backwards compatibility.
///
/// New code should use the `Authorizer` API directly.
///
/// ## Errors
///
/// - Returns `AuthorizationError` if access is denied.
/// - Returns `CasbinError` if Casbin evaluation fails.
/// - Returns `InvariantViolation` if the Casbin enforcer is not in the depot.
#[deprecated(
    since = "0.1.0",
    note = "Use authorizer_from_depot() and Authorizer::require() instead"
)]
pub fn require(depot: &salvo::Depot, sub: &str, obj: &str, act: &str) -> AppResult<()> {
    require_legacy(depot, sub, obj, act)
}
