//! Database <-> canonical DAV mapping helpers.
//!
//! This module provides functions to convert between RFC-parsed types
//! (iCalendar/vCard) and database models (`DavEntity`, `DavComponent`, etc.).

pub mod assemble;
pub mod extract;
pub mod ical;
pub mod vcard;

// Re-export main API
pub use assemble::{ical_from_tree, serialize_ical_tree, serialize_vcard_tree, vcard_from_tree};
pub use ical::icalendar_to_db_models;
pub use vcard::vcard_to_db_models;

#[cfg(test)]
mod tests;
