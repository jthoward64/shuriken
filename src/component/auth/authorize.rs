use casbin::CoreApi;

use crate::component::{
    auth::casbin::get_enforcer,
    error::{Error, Result},
};

/// ## Summary
/// High-level authorization wrapper for Casbin.
///
/// This keeps Casbin-specific details localized so services can depend on a small API.
///
/// ## Errors
/// Returns `Error::AuthorizationError` when access is denied.
/// Propagates `Error::CasbinError` for Casbin evaluation errors.
pub fn require(sub: &str, obj: &str, act: &str) -> Result<()> {
    let enforcer = get_enforcer();

    let allowed = enforcer
        .enforce((sub, obj, act))
        .map_err(Error::CasbinError)?;

    if allowed {
        Ok(())
    } else {
        Err(Error::AuthorizationError(format!(
            "Denied: sub={sub} obj={obj} act={act}"
        )))
    }
}
