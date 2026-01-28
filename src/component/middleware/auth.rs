use salvo::Depot;
use tracing::error;

use crate::component::{
    auth::{authenticate::authenticate, depot::depot_keys},
    model,
};

pub enum DepotUser {
    User(model::user::User),
    Public,
}

/// ## Summary
/// Authentication middleware that authenticates the request and stores the user in the depot.
/// If authentication fails, a 401 Unauthorized response is returned.
///
/// ## Side Effects
/// Inserts the authenticated user into the depot under the key "user" for downstream handlers to access.
///
/// ## Errors
/// Returns an HTTP 401 Unauthorized response if authentication fails.
#[salvo::async_trait]
impl salvo::Handler for AuthMiddleware {
    #[tracing::instrument(skip(self, req, depot, res, ctrl), fields(
        method = %req.method(),
        path = %req.uri().path()
    ))]
    async fn handle(
        &self,
        req: &mut salvo::Request,
        depot: &mut Depot,
        res: &mut salvo::Response,
        ctrl: &mut salvo::FlowCtrl,
    ) {
        tracing::trace!("Authenticating request");

        if req.method() == salvo::http::Method::OPTIONS {
            depot.insert(depot_keys::AUTHENTICATED_PRINCIPAL, DepotUser::Public);
            return;
        }

        match authenticate(req, depot).await {
            Ok(user) => {
                tracing::debug!(user_email = %user.email, "User authenticated successfully");
                depot.insert(depot_keys::AUTHENTICATED_PRINCIPAL, DepotUser::User(user));
            }
            Err(e) => match e {
                crate::component::error::AppError::NotAuthenticated => {
                    tracing::debug!("Request not authenticated, treating as public");
                    depot.insert(depot_keys::AUTHENTICATED_PRINCIPAL, DepotUser::Public);
                }
                crate::component::error::AppError::PoolError(_) => {
                    tracing::warn!(error = ?e, "Database pool unavailable, treating as public");
                    depot.insert(depot_keys::AUTHENTICATED_PRINCIPAL, DepotUser::Public);
                }
                crate::component::error::AppError::AuthenticationError(_) => {
                    tracing::warn!(error = ?e, "Authentication error");
                    res.status_code(salvo::http::StatusCode::UNAUTHORIZED);
                    res.body("Unauthorized");
                    ctrl.skip_rest();
                }
                _ => {
                    res.status_code(salvo::http::StatusCode::INTERNAL_SERVER_ERROR);
                    res.body("Internal Server Error");
                    error!("Authentication error: {:?}", e);
                    ctrl.skip_rest();
                }
            },
        }
    }
}

/// ## Summary
/// Middleware handler for authentication.
/// Use this as a handler in routes to protect them with authentication.
pub struct AuthMiddleware;
