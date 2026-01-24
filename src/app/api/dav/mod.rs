// Shared WebDAV mechanics used by both CalDAV and CardDAV handlers.
//
// This module is intentionally "glue-only": header parsing, XML body extraction,
// and shared response builders (e.g., 207 Multi-Status).

pub mod extract;
pub mod method;
pub mod response;
