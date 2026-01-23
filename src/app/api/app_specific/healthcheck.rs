use salvo::{Router, handler};

#[handler]
async fn hello() -> &'static str {
    "OK"
}

#[must_use]
pub fn routes() -> Router {
    Router::with_path("healthcheck").get(hello)
}
