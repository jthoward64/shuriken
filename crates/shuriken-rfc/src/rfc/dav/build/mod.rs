//! `WebDAV` XML serialization for responses.
//!
//! This module provides serialization of multistatus responses
//! and error responses to XML.

pub mod multistatus;

pub use multistatus::serialize_multistatus;
