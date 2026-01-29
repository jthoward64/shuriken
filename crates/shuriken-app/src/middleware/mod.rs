// Middleware handlers for request processing.
pub mod auth;
pub mod dav_path_middleware;
pub mod path_parser;
// TODO: Migrate consumers to dav_path_middleware and remove slug_resolver
// pub mod slug_resolver;
