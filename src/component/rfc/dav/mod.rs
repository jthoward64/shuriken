//! `WebDAV`/`CalDAV`/`CardDAV` XML types and processing.
//!
//! This module provides types, parsing, and serialization for `WebDAV` XML
//! used in `PROPFIND`, `PROPPATCH`, `REPORT` requests and multistatus responses.
//!
//! ## Submodules
//!
//! - [`core`] - Core types (`Href`, `QName`, `Multistatus`, etc.)
//! - [`parse`] - XML parsing for request bodies
//! - [`build`] - XML serialization for responses
//! - [`method`] - HTTP method definitions

pub mod build;
pub mod core;
pub mod method;
pub mod parse;

#[cfg(test)]
mod tests;

// Re-export commonly used types
pub use core::{
    CALDAV_NS, CARDDAV_NS, CS_NS, DAV_NS, DavProperty, Depth, Href, Multistatus, Namespace,
    PropertyName, PropfindRequest, PropfindType, ProppatchRequest, QName, ReportRequest,
    ReportType, Status,
};
