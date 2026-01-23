use salvo::Depot;
use tracing::error;

use crate::component::{auth::authenticate::authenticate, model};

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
    async fn handle(
        &self,
        req: &mut salvo::Request,
        depot: &mut Depot,
        res: &mut salvo::Response,
        ctrl: &mut salvo::FlowCtrl,
    ) {
        match authenticate(req).await {
            Ok(user) => {
                depot.insert("user", DepotUser::User(user));
            }
            Err(e) => match e {
                crate::component::error::Error::NotAuthenticated => {
                    depot.insert("user", DepotUser::Public);
                }
                crate::component::error::Error::AuthenticationError(_) => {
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
