//! Database <-> canonical DAV mapping helpers.
//!
//! This module provides functions to convert between RFC-parsed types
//! (iCalendar/vCard) and database models (`DavEntity`, `DavComponent`, etc.).

pub mod extract;
pub mod ical;
pub mod vcard;

// Re-export main API
pub use ical::icalendar_to_db_models;
pub use vcard::vcard_to_db_models;
