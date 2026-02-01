//! Validation logic for RFC compliance.
//!
//! This module provides validators for CalDAV and CardDAV requests to ensure
//! compliance with RFC specifications.

pub mod filter;

pub use filter::{FilterValidationResult, validate_calendar_filter};
