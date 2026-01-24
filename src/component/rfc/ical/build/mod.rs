//! iCalendar serialization (RFC 5545).
//!
//! This module provides serializers for iCalendar content:
//! - Escape: Text and parameter value escaping
//! - Fold: Content line folding at 75 octets
//! - Serializer: Full document serialization with canonical ordering

mod escape;
mod fold;
mod serializer;

pub use escape::{escape_param_value, escape_text};
pub use fold::fold_line;
pub use serializer::{serialize, serialize_component, serialize_property};
