//! vCard core types (RFC 6350).
//!
//! This module provides the foundational types for representing vCard data:
//!
//! - [`VCard`] - Complete vCard representation
//! - [`VCardProperty`] - Individual property with parameters and value
//! - [`VCardParameter`] - Property parameters
//! - [`VCardValue`] - Property value variants
//!
//! ## Structured Types
//!
//! - [`StructuredName`] - N property (family, given, etc.)
//! - [`Address`] - ADR property
//! - [`Organization`] - ORG property
//! - [`Gender`] - GENDER property
//!
//! ## Date/Time Types
//!
//! vCard supports partial/truncated dates that iCalendar doesn't:
//!
//! - [`VCardDate`] - Full or partial date
//! - [`VCardTime`] - Full or partial time
//! - [`DateAndOrTime`] - Combined date/time or text
//!
//! ## Example
//!
//! ```rust
//! use shuriken::component::rfc::vcard::core::{VCard, VCardProperty, StructuredName};
//!
//! let mut card = VCard::new();
//! card.add_property(VCardProperty::text("FN", "John Doe"));
//! card.add_property(VCardProperty::text("EMAIL", "john@example.com"));
//! ```

mod datetime;
mod parameter;
mod property;
mod structured;
mod value;
mod vcard;

pub use datetime::{DateAndOrTime, Timestamp, VCardDate, VCardTime, VCardUtcOffset};
pub use parameter::{types, VCardParameter};
pub use property::{names, VCardProperty};
pub use structured::{
    Address, Anniversary, ClientPidMap, Gender, Organization, Related, Sex, StructuredName, TelUri,
};
pub use value::VCardValue;
pub use vcard::{VCard, VCardKind, VCardVersion};
