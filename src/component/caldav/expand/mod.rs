//! `CalDAV` recurrence expansion integration.
//!
//! This module integrates the RRULE expander with `CalDAV` calendar-query reports,
//! providing expand and limit-recurrence-set functionality.

mod query;

pub use query::{expand_recurrence_set, limit_recurrence_set, should_expand_instance};
