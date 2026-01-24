// Shared WebDAV mechanics used by both CalDAV and CardDAV handlers.
//
// This module is intentionally "glue-only": header parsing, XML body extraction,
// and shared response builders (e.g., 207 Multi-Status).

use salvo::Router;

pub mod extract;
pub mod method;
pub mod response;

#[must_use]
pub fn routes() -> Router {
    Router::with_path("<**rest>")
        .options(method::options::options)
        .get(method::get_head::get)
        .head(method::get_head::head)
        .delete(method::delete::delete)
        .post(method::report::report)
        // PROPFIND is handled as POST for now until custom HTTP method support is added
        // TODO: Add proper PROPFIND HTTP method routing when Salvo supports it
}
