//! vCard serialization (RFC 6350).
//!
//! This module provides serialization functionality for vCard data.
//!
//! ## Usage
//!
//! ```rust
//! use shuriken::component::rfc::vcard::{VCard, VCardProperty, serialize};
//!
//! let mut card = VCard::new();
//! card.add_property(VCardProperty::text("FN", "John Doe"));
//! card.add_property(VCardProperty::text("EMAIL", "john@example.com"));
//!
//! let output = serialize(&[card]);
//! ```
//!
//! ## Features
//!
//! - Proper line folding at 75 octets (UTF-8 safe)
//! - Text escaping per RFC 6350
//! - RFC 6868 caret encoding for parameters
//! - Canonical property ordering for stable `ETag`s
//! - Structured value serialization (N, ADR, ORG)

mod escape;
mod fold;
mod serializer;

pub use escape::{escape_component, escape_param_value, escape_text};
pub use fold::fold_line;
pub use serializer::{serialize, serialize_single};
