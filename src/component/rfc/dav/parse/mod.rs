//! `WebDAV` XML parsing.
//!
//! This module provides parsing for `WebDAV` XML request bodies
//! using the `quick-xml` crate.

mod error;
mod propfind;
mod proppatch;
mod report;

pub use error::{ParseError, ParseResult};
pub use propfind::parse_propfind;
pub use proppatch::parse_proppatch;
pub use report::parse_report;
