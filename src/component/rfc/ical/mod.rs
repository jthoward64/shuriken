//! iCalendar RFC 5545 implementation.
//!
//! This module provides complete iCalendar parsing and serialization:
//!
//! - `core`: Type definitions for iCalendar structures
//! - `parse`: Parsers for iCalendar content
//! - `build`: Serializers for iCalendar content
//!
//! ## Example
//!
//! ```rust
//! use shuriken::component::rfc::ical::{parse, build, core::*};
//!
//! // Parse an iCalendar document
//! let input = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n...";
//! // let ical = parse::parse(input).unwrap();
//!
//! // Create an iCalendar programmatically
//! let mut ical = ICalendar::new("-//My App//EN");
//! let mut event = Component::event();
//! event.add_property(Property::text("UID", "my-event-1"));
//! event.add_property(Property::text("SUMMARY", "Team Meeting"));
//! ical.add_event(event);
//!
//! // Serialize to string
//! let output = build::serialize(&ical);
//! ```

pub mod build;
pub mod core;
pub mod parse;

#[cfg(test)]
mod tests;

// Re-export commonly used items at module level
pub use build::serialize;
pub use core::{Component, ComponentKind, ICalendar, Parameter, Property};
pub use parse::{ParseError, ParseResult, parse};
