//! Recurrence expansion for iCalendar components.
//!
//! This module provides functionality to expand recurring calendar events
//! according to RFC 5545 recurrence rules (RRULE).

mod rrule;
mod timezone;
mod vtimezone;

pub use rrule::{ExpansionError, ExpansionOptions, expand_rrule};
pub use timezone::{ConversionError, TimeZoneResolver, convert_to_utc};
pub use vtimezone::{Observance, ObservanceKind, UtcOffset, VTimezone, VTimezoneError};
