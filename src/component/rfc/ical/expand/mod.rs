//! Recurrence expansion for iCalendar components.
//!
//! This module provides functionality to expand recurring calendar events
//! according to RFC 5545 recurrence rules (RRULE).

mod rrule;
mod timezone;

pub use rrule::{expand_rrule, ExpansionError, ExpansionOptions};
pub use timezone::{convert_to_utc, ConversionError, TimeZoneResolver};
