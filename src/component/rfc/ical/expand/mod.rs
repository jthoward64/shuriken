//! Recurrence expansion (RFC 5545 §3.3.10, §3.8.5).
//!
//! This module provides functionality to expand RRULE definitions into individual
//! occurrence instances, handling:
//! - Frequency iteration (DAILY, WEEKLY, MONTHLY, YEARLY, etc.)
//! - BY-rules (BYDAY, BYMONTH, BYMONTHDAY, BYSETPOS, etc.)
//! - UNTIL/COUNT limiting
//! - EXDATE exclusion
//! - RDATE inclusion
//! - Timezone handling

mod expander;
mod timezone;

pub use expander::{RecurrenceExpander, RecurrenceSet};
pub use timezone::{TimezoneDatabase, TimezoneResolver};
