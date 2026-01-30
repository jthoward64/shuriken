//! Authorization service for centralized access control.
//!
//! This module provides the main authorization API that handlers use to check
//! permissions. It wraps Casbin enforcement with Shuriken-specific logic.

use std::sync::Arc;

use casbin::CoreApi;

use crate::error::{ServiceError, ServiceResult};

use super::{action::Action, resource::ResourceLocation, subject::ExpandedSubjects};

/// Result of an authorization check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthzResult {
    /// Access is allowed.
    Allowed,
    /// Access is denied.
    Denied,
}

impl AuthzResult {
    /// Returns `true` if access is allowed.
    #[must_use]
    pub const fn is_allowed(&self) -> bool {
        matches!(self, Self::Allowed)
    }

    /// Convert to a `Result`, returning `Err(ServiceError::AuthorizationError)` if denied.
    ///
    /// ## Errors
    ///
    /// Returns `AuthorizationError` if access is denied.
    pub fn require(self, resource: &ResourceLocation, action: &Action) -> ServiceResult<()> {
        match self {
            Self::Allowed => Ok(()),
            Self::Denied => Err(ServiceError::AuthorizationError(format!(
                "Access denied: {action} on {resource}"
            ))),
        }
    }
}

/// Authorization service for checking permissions.
///
/// This wraps a Casbin enforcer and provides Shuriken-specific authorization logic.
/// The new model uses path-based policies with glob matching and g2 role-to-permission mappings.
///
/// ## Usage
///
/// ```ignore
/// let authz = Authorizer::new(enforcer);
/// let result = authz.check(&subjects, &resource, Action::Read)?;
/// if result.is_allowed() {
///     // proceed
/// }
/// ```
pub struct Authorizer {
    enforcer: Arc<casbin::Enforcer>,
}

impl Authorizer {
    /// Create a new authorizer with the given Casbin enforcer.
    #[must_use]
    pub fn new(enforcer: Arc<casbin::Enforcer>) -> Self {
        Self { enforcer }
    }

    /// Check if any subject in the expanded set has the required permission.
    ///
    /// This implements the enforcement flow using the new model:
    /// 1. For each subject in the expanded set (user + groups + authenticated + all)
    /// 2. Check Casbin policy: `enforce((subject, path, action))`
    /// 3. Casbin uses `globMatch(r.path, p.path)` for path matching
    /// 4. Casbin uses `g2(p.role, r.action)` for role-to-permission mapping
    /// 5. Return `Allowed` if any subject has permission
    ///
    /// ## Errors
    ///
    /// Returns `CasbinError` if Casbin evaluation fails.
    pub fn check(
        &self,
        subjects: &ExpandedSubjects,
        resource: &ResourceLocation,
        action: Action,
    ) -> ServiceResult<AuthzResult> {
        let path = resource.to_resource_path(false)?;
        let act = action.as_casbin_action();

        tracing::debug!(
            path = %path,
            action = %act,
            subject_count = subjects.len(),
            "Authorization check started"
        );

        // Check each subject until we find one that's allowed
        for subject in subjects {
            let sub = subject.casbin_subject();

            tracing::trace!(
                subject = %sub,
                path = %path,
                action = %act,
                "Checking subject"
            );

            let allowed = self
                .enforcer
                .enforce((&sub, &path, act))
                .map_err(ServiceError::CasbinError)?;

            tracing::trace!(
                subject = %sub,
                path = %path,
                action = %act,
                allowed = %allowed,
                "Subject check result"
            );

            if allowed {
                tracing::debug!(
                    subject = %sub,
                    path = %path,
                    action = %act,
                    "Authorization granted"
                );
                return Ok(AuthzResult::Allowed);
            }
        }

        tracing::debug!(
            path = %path,
            action = %act,
            "Authorization denied for all subjects"
        );
        Ok(AuthzResult::Denied)
    }

    /// Check and require permission, returning an error if denied.
    ///
    /// This is a convenience method that combines `check()` with `AuthzResult::require()`.
    ///
    /// ## Errors
    ///
    /// - Returns `AuthorizationError` if access is denied.
    /// - Returns `CasbinError` if Casbin evaluation fails.
    pub fn require(
        &self,
        subjects: &ExpandedSubjects,
        resource: &ResourceLocation,
        action: Action,
    ) -> ServiceResult<()> {
        self.check(subjects, resource, action)?
            .require(resource, &action)
    }
}

/// Create an authorizer from the depot.
///
/// ## Errors
///
/// Returns `InvariantViolation` if the Casbin enforcer is not in the depot.
pub fn authorizer_from_depot(depot: &salvo::Depot) -> ServiceResult<Authorizer> {
    let enforcer = super::casbin::get_enforcer_from_depot(depot)?;
    Ok(Authorizer::new(enforcer))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::ResourceType;

    #[test]
    fn authz_result_require() {
        let resource = ResourceLocation::from_segments_item(
            ResourceType::Calendar,
            "alice".to_string(),
            "personal",
            "work.ics".to_string(),
        );
        let action = Action::Read;

        let allowed = AuthzResult::Allowed;
        assert!(allowed.require(&resource, &action).is_ok());

        let denied = AuthzResult::Denied;
        assert!(denied.require(&resource, &action).is_err());
    }
}
