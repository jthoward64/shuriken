//! `WebDAV` XML parsing.
//!
//! This module provides parsing for `WebDAV` XML request bodies
//! using the `quick-xml` crate.

mod error;
mod mkcol;
pub mod propfind;
mod proppatch;
pub mod report;

#[cfg(test)]
mod error_tests;

pub use error::{ParseError, ParseResult};
pub use mkcol::{MkcolRequest, parse_mkcol};
pub use propfind::parse_propfind;
pub use proppatch::parse_proppatch;
pub use report::parse_report;
