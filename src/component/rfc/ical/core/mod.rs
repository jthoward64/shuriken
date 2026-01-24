//! iCalendar core models (RFC 5545).
//!
//! This module defines the core data structures for representing iCalendar
//! content. These types are designed for:
//! - Round-trip fidelity: preserving unknown properties and parameters
//! - Deterministic serialization: canonical ordering for stable `ETag`s
//! - Type safety: leveraging Rust's type system for value validation

mod component;
mod datetime;
mod duration;
mod parameter;
mod property;
mod rrule;
mod value;

pub use component::{Component, ComponentKind, ICalendar};
pub use datetime::{DateTime, DateTimeForm, Time, UtcOffset};
pub use duration::Duration;
pub use parameter::Parameter;
pub use property::{ContentLine, Property};
pub use rrule::{Frequency, RRule, RRuleUntil, Weekday, WeekdayNum};
pub use value::{Date, Period, Value};
