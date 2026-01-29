//! vCard implementation (RFC 6350).
//!
//! This module provides types, parsing, and serialization for vCard data
//! used in `CardDAV` (RFC 6352).
//!
//! ## Overview
//!
//! vCard is a standard format for contact information. This implementation
//! supports both vCard 3.0 (RFC 2426) and 4.0 (RFC 6350).
//!
//! ## Usage
//!
//! ### Parsing
//!
//! ```rust
//! use shuriken_rfc::rfc::vcard::{parse, VCard};
//!
//! let input = "\
//! BEGIN:VCARD\r\n\
//! VERSION:4.0\r\n\
//! FN:John Doe\r\n\
//! EMAIL:john@example.com\r\n\
//! END:VCARD\r\n";
//!
//! let cards = parse(input).unwrap();
//! assert_eq!(cards[0].formatted_name(), Some("John Doe"));
//! ```
//!
//! ### Serializing
//!
//! ```rust
//! use shuriken_rfc::rfc::vcard::{VCard, VCardProperty, serialize};
//!
//! let mut card = VCard::new();
//! card.add_property(VCardProperty::text("FN", "Jane Doe"));
//! card.add_property(VCardProperty::text("EMAIL", "jane@example.com"));
//!
//! let output = serialize(&[card]);
//! assert!(output.contains("FN:Jane Doe"));
//! ```
//!
//! ## Round-Trip Fidelity
//!
//! Properties preserve their raw values for round-trip fidelity.
//! Serialization uses canonical ordering for deterministic `ETag` generation.
//!
//! ## Submodules
//!
//! - [`core`] - Core types (`VCard`, `VCardProperty`, `VCardValue`, etc.)
//! - [`parse`] - Parsing functions and error types
//! - [`build`] - Serialization functions

pub mod build;
pub mod core;
pub mod parse;

#[cfg(test)]
mod tests;

// Re-export commonly used types
pub use build::serialize;
pub use core::{
    Address, DateAndOrTime, Gender, Organization, StructuredName, VCard, VCardKind, VCardParameter,
    VCardProperty, VCardValue, VCardVersion,
};
pub use parse::{ParseError, ParseResult, parse, parse_single};
