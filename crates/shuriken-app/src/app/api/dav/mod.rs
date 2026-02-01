// Shared WebDAV mechanics used by both CalDAV and CardDAV handlers.
//
// This module is intentionally "glue-only": header parsing, XML body extraction,
// and shared response builders (e.g., 207 Multi-Status).

use salvo::Router;

pub mod extract;
pub mod method;
pub mod response;
pub mod util;

#[must_use]
pub fn routes() -> Router {
    Router::new()
        .options(method::options::options)
        .get(method::get_head::get)
        .head(method::get_head::head)
        .delete(method::delete::delete)
        .push(
            // PROPFIND method
            Router::new()
                .filter_fn(|req, _| req.method().as_str() == "PROPFIND")
                .goal(method::propfind::propfind),
        )
        .push(
            // PROPPATCH method
            Router::new()
                .filter_fn(|req, _| req.method().as_str() == "PROPPATCH")
                .goal(method::proppatch::proppatch),
        )
        .push(
            // COPY method
            Router::new()
                .filter_fn(|req, _| req.method().as_str() == "COPY")
                .goal(method::copy::copy),
        )
        .push(
            // MOVE method
            Router::new()
                .filter_fn(|req, _| req.method().as_str() == "MOVE")
                .goal(method::r#move::r#move),
        )
        .push(
            // MKCOL method
            Router::new()
                .filter_fn(|req, _| req.method().as_str() == "MKCOL")
                .goal(method::mkcol::mkcol),
        )
}
