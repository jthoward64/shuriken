use salvo::prelude::Json;
use salvo::{Depot, Router, handler};
use serde_json::json;

use shuriken_db::dav_types::DepotUser;
use shuriken_service::auth::depot::depot_keys;

/// ## Summary
/// Returns the authenticated user's information as JSON.
/// The user is retrieved from the depot set by the `AuthMiddleware`.
#[handler]
async fn whoami(depot: &Depot) -> salvo::prelude::Json<serde_json::Value> {
    match depot.get::<DepotUser>(depot_keys::AUTHENTICATED_PRINCIPAL) {
        Ok(val) => match val {
            DepotUser::User(user) => Json(serde_json::to_value(user).unwrap_or(json!(null))),
            DepotUser::Public => Json(json!({"status":"public"})),
        },
        Err(_) => Json(json!({"error":"User not found in depot"})),
    }
}

#[must_use]
pub fn routes() -> Router {
    Router::with_path("whoami").get(whoami)
}
