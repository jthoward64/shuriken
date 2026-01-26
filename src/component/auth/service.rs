//! Authorization service for centralized access control.
//!
//! This module provides the main authorization API that handlers use to check
//! permissions. It wraps Casbin enforcement with Shuriken-specific logic.

use std::sync::Arc;

use casbin::{CoreApi, MgmtApi, RbacApi};

use crate::component::error::{AppError, AppResult};

use super::{
    action::Action, permission::PermissionLevel, resource::ResourceId, subject::ExpandedSubjects,
};

/// Result of an authorization check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthzResult {
    /// Access is allowed with the effective permission level.
    Allowed(PermissionLevel),
    /// Access is denied.
    Denied,
}

impl AuthzResult {
    /// Returns `true` if access is allowed.
    #[must_use]
    pub const fn is_allowed(&self) -> bool {
        matches!(self, Self::Allowed(_))
    }

    /// Returns the effective permission level if allowed.
    #[must_use]
    pub const fn permission_level(&self) -> Option<PermissionLevel> {
        match self {
            Self::Allowed(level) => Some(*level),
            Self::Denied => None,
        }
    }

    /// Convert to a `Result`, returning `Err(AppError::AuthorizationError)` if denied.
    ///
    /// ## Errors
    ///
    /// Returns `AuthorizationError` if access is denied.
    pub fn require(self, resource: &ResourceId, action: &Action) -> AppResult<PermissionLevel> {
        match self {
            Self::Allowed(level) => Ok(level),
            Self::Denied => Err(AppError::AuthorizationError(format!(
                "Access denied: {action} on {resource}"
            ))),
        }
    }
}

/// Authorization service for checking permissions.
///
/// This wraps a Casbin enforcer and provides Shuriken-specific authorization logic.
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
    /// This implements the enforcement flow from Section 12.3.1:
    /// 1. For each subject in the expanded set
    /// 2. Check Casbin policy for action on resource
    /// 3. If direct check fails, verify role hierarchy (owner > admin > ... > read)
    /// 4. Return `Allowed` with the highest permission level found
    ///
    /// Role hierarchy is enforced via g5 edges using Casbin's `GetImplicitRolesForUser()`.
    /// A subject with a higher role (e.g., "owner") implicitly has permissions for lower
    /// roles (e.g., "read") without needing explicit grants for each level.
    ///
    /// ## Errors
    ///
    /// Returns `CasbinError` if Casbin evaluation fails.
    pub fn check(
        &self,
        subjects: &ExpandedSubjects,
        resource: &ResourceId,
        action: Action,
    ) -> AppResult<AuthzResult> {
        let obj = resource.as_casbin_object();
        let act = action.as_casbin_action();

        // Check each subject until we find one that's allowed
        for subject in subjects {
            let sub = subject.casbin_subject();

            // First, try direct enforcement (exact role matching)
            let allowed = self
                .enforcer
                .enforce((&sub, &obj, &act))
                .map_err(AppError::CasbinError)?;

            if allowed {
                let level = action.minimum_level();
                return Ok(AuthzResult::Allowed(level));
            }

            // If direct enforcement failed, check role hierarchy
            // Get the roles granted to this subject on this resource
            let granted_roles = self.enforcer.get_roles_for_user(&sub, Some(&obj));

            if granted_roles.is_empty() {
                continue; // No roles granted, try next subject
            }

            // Check if any granted role satisfies the action via role hierarchy
            if self.check_role_hierarchy(&granted_roles, &obj, &act)? {
                let level = action.minimum_level();
                return Ok(AuthzResult::Allowed(level));
            }
        }

        Ok(AuthzResult::Denied)
    }

    /// Check if any granted role satisfies the action via role hierarchy.
    ///
    /// This uses Casbin's role hierarchy (g5) to determine if a higher role
    /// (e.g., "owner") implies permission for a lower role (e.g., "read").
    ///
    /// ## Algorithm
    /// 1. Get the resource type from g2
    /// 2. Get all policies for this resource type and action
    /// 3. For each policy's required role, check if any granted role implies it via g5
    ///
    /// ## Errors
    ///
    /// Returns `CasbinError` if Casbin evaluation fails.
    fn check_role_hierarchy(
        &self,
        granted_roles: &[String],
        obj: &str,
        act: &str,
    ) -> AppResult<bool> {
        // Get the resource type from g2
        let obj_types = self.enforcer.get_roles_for_user(obj, Some("g2"));

        for obj_type in obj_types {
            // Get all policies to find what roles are defined for this type/action
            let all_policies = self.enforcer.get_policy();

            // Find policies that match this object type and action
            for policy in all_policies {
                // Policy format: [role, obj_type, action]
                if policy.len() >= 3 && policy[1] == obj_type && policy[2] == act {
                    let required_role = &policy[0];

                    // Check if any granted role implies the required role via g5
                    for granted_role in granted_roles {
                        if self.role_implies(granted_role, required_role)? {
                            return Ok(true);
                        }
                    }
                }
            }
        }

        Ok(false)
    }

    /// Check if `higher_role` implies `lower_role` via the g5 role hierarchy.
    ///
    /// Uses Casbin's `GetImplicitRolesForUser()` to traverse the role hierarchy.
    /// For example, "owner" implies "read" if g5 edges form a path: owner → ... → read
    ///
    /// ## Returns
    /// - `true` if higher_role == lower_role (exact match)
    /// - `true` if higher_role transitively implies lower_role via g5
    /// - `false` otherwise
    ///
    /// ## Errors
    ///
    /// Returns `CasbinError` if Casbin evaluation fails.
    fn role_implies(&self, higher_role: &str, lower_role: &str) -> AppResult<bool> {
        // Exact match
        if higher_role == lower_role {
            return Ok(true);
        }

        // Get all roles that this role implies (direct + transitive via g5)
        let implied_roles = self
            .enforcer
            .get_implicit_roles_for_user(higher_role, Some("g5"));

        Ok(implied_roles.contains(&lower_role.to_string()))
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
        resource: &ResourceId,
        action: Action,
    ) -> AppResult<PermissionLevel> {
        self.check(subjects, resource, action)?
            .require(resource, &action)
    }

    /// Check if a subject can grant a permission level to another principal.
    ///
    /// ## Errors
    ///
    /// Returns `CasbinError` if Casbin evaluation fails.
    pub fn check_share(
        &self,
        subjects: &ExpandedSubjects,
        resource: &ResourceId,
        target_level: PermissionLevel,
    ) -> AppResult<AuthzResult> {
        self.check(subjects, resource, Action::ShareGrant(target_level))
    }

    /// Get the effective permission level for a subject on a resource.
    ///
    /// This finds the highest permission level that any subject in the set
    /// has on the resource.
    ///
    /// ## Errors
    ///
    /// Returns `CasbinError` if Casbin evaluation fails.
    pub fn effective_permission(
        &self,
        subjects: &ExpandedSubjects,
        resource: &ResourceId,
    ) -> AppResult<Option<PermissionLevel>> {
        // Check each level from highest to lowest
        for level in PermissionLevel::ALL.iter().rev() {
            // Check if any subject has at least this level
            // We do this by checking if read_freebusy is allowed (lowest level)
            // and then checking higher levels
            let action = match level {
                PermissionLevel::ReadFreebusy => Action::ReadFreebusy,
                PermissionLevel::Read
                | PermissionLevel::ReadShare
                | PermissionLevel::Edit
                | PermissionLevel::EditShare
                | PermissionLevel::Admin
                | PermissionLevel::Owner => {
                    // For levels that can write, check write action
                    if *level >= PermissionLevel::Edit {
                        Action::Write
                    } else {
                        Action::Read
                    }
                }
            };

            let result = self.check(subjects, resource, action)?;
            if result.is_allowed() {
                // Found a level that works
                // TODO: This is a simplified check. For accurate level detection,
                // we'd need to query Casbin for the actual role granted.
                return Ok(Some(action.minimum_level()));
            }
        }

        Ok(None)
    }
}

/// Check authorization for a single subject (legacy API).
///
/// ## Summary
///
/// This is the original `require()` function for backwards compatibility.
/// New code should use `Authorizer::require()` with expanded subjects.
///
/// ## Errors
///
/// - Returns `AuthorizationError` if access is denied.
/// - Returns `CasbinError` if Casbin evaluation fails.
/// - Returns `InvariantViolation` if the Casbin enforcer is not in the depot.
pub fn require_legacy(depot: &salvo::Depot, sub: &str, obj: &str, act: &str) -> AppResult<()> {
    let enforcer = super::casbin::get_enforcer_from_depot(depot)?;

    let allowed = enforcer
        .enforce((sub, obj, act))
        .map_err(AppError::CasbinError)?;

    if allowed {
        Ok(())
    } else {
        Err(AppError::AuthorizationError(format!(
            "Denied: sub={sub} obj={obj} act={act}"
        )))
    }
}

/// Create an authorizer from the depot.
///
/// ## Errors
///
/// Returns `InvariantViolation` if the Casbin enforcer is not in the depot.
pub fn authorizer_from_depot(depot: &salvo::Depot) -> AppResult<Authorizer> {
    let enforcer = super::casbin::get_enforcer_from_depot(depot)?;
    Ok(Authorizer::new(enforcer))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authz_result_require() {
        let resource = ResourceId::calendar(uuid::Uuid::now_v7());
        let action = Action::Read;

        let allowed = AuthzResult::Allowed(PermissionLevel::Read);
        assert!(allowed.require(&resource, &action).is_ok());

        let denied = AuthzResult::Denied;
        assert!(denied.require(&resource, &action).is_err());
    }

    #[test]
    fn authz_result_permission_level() {
        let allowed = AuthzResult::Allowed(PermissionLevel::Edit);
        assert_eq!(allowed.permission_level(), Some(PermissionLevel::Edit));

        let denied = AuthzResult::Denied;
        assert_eq!(denied.permission_level(), None);
    }
}
