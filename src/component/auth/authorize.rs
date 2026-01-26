use casbin::CoreApi;

use crate::component::{
    auth::casbin::get_enforcer_from_depot,
    error::{AppError, AppResult},
};

/// ## Summary
/// High-level authorization wrapper for Casbin.
///
/// This keeps Casbin-specific details localized so services can depend on a small API.
///
/// ## Errors
/// Returns `Error::AuthorizationError` when access is denied.
/// Propagates `Error::CasbinError` for Casbin evaluation errors.
pub fn require(depot: &salvo::Depot, sub: &str, obj: &str, act: &str) -> AppResult<()> {
    let enforcer = get_enforcer_from_depot(depot)?;

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
