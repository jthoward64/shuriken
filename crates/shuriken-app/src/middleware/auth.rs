use salvo::Depot;
use tracing::error;

use crate::{config::get_config_from_depot, db_handler::get_db_from_depot};
use shuriken_db::dav_types::DepotUser;
use shuriken_service::auth::{authenticate::authenticate, depot::depot_keys};

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

        // Get config and db provider from depot
        let config = match get_config_from_depot(depot) {
            Ok(cfg) => cfg,
            Err(e) => {
                error!(error = ?e, "Failed to get config from depot");
                res.status_code(salvo::http::StatusCode::INTERNAL_SERVER_ERROR);
                ctrl.skip_rest();
                return;
            }
        };

        let provider = match get_db_from_depot(depot) {
            Ok(p) => p,
            Err(e) => {
                error!(error = ?e, "Failed to get database provider from depot");
                res.status_code(salvo::http::StatusCode::INTERNAL_SERVER_ERROR);
                ctrl.skip_rest();
                return;
            }
        };

        let mut conn = match provider.get_connection().await {
            Ok(c) => c,
            Err(e) => {
                error!(error = ?e, "Failed to get database connection");
                res.status_code(salvo::http::StatusCode::SERVICE_UNAVAILABLE);
                ctrl.skip_rest();
                return;
            }
        };

        match authenticate(req, &mut conn, &config).await {
            Ok(user) => {
                tracing::debug!(user_email = %user.email, "User authenticated successfully");
                depot.insert(depot_keys::AUTHENTICATED_PRINCIPAL, DepotUser::User(user));
            }
            Err(service_err) => {
                use shuriken_service::error::ServiceError;

                // Check if this is a not-authenticated or config error
                let should_be_public = matches!(
                    &service_err,
                    ServiceError::NotAuthenticated | ServiceError::InvalidConfiguration(_)
                );

                if should_be_public {
                    tracing::debug!(
                        "Request not authenticated or config error, treating as public"
                    );
                    depot.insert(depot_keys::AUTHENTICATED_PRINCIPAL, DepotUser::Public);
                    return;
                }

                // For all other errors, return 500
                error!(error = ?service_err, "Authentication failed with error");
                res.status_code(salvo::http::StatusCode::INTERNAL_SERVER_ERROR);
                res.body("Internal Server Error");
                ctrl.skip_rest();
            }
        }
    }
}

/// ## Summary
/// Middleware handler for authentication.
/// Use this as a handler in routes to protect them with authentication.
pub struct AuthMiddleware;
