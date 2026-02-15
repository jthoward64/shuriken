//! # shuriken-caldavtester
//!
//! Test runner for executing Apple's CalDAV/CardDAV test suite against the Shuriken server.
//!
//! ## Architecture
//!
//! This crate provides a well-structured test execution framework:
//!
//! - **XML parsing** ([`xml`]): Parse test definitions from XML files
//! - **Test execution** ([`runner`]): Execute HTTP requests and verify responses
//! - **Server management** ([`server`]): Manage test server lifecycle
//! - **Context** ([`context`]): Variable substitution and test state
//!
//! ## Test Format
//!
//! Tests are defined in XML files with structure:
//! - `<caldavtest>` - Root element
//! - `<test-suite>` - Groups related tests
//! - `<test>` - Individual test with request/verify
//!
//! ## Example Usage
//!
//! ```rust,no_run
//! use shuriken_caldavtester::runner::TestRunner;
//!
//! #[tokio::main]
//! async fn main() -> anyhow::Result<()> {
//!     let runner = TestRunner::new().await?;
//!     runner.run_test_file("test-suite/tests/CalDAV/get.xml").await?;
//!     Ok(())
//! }
//! ```

pub mod config;
pub mod context;
pub mod error;
pub mod runner;
pub mod server;
pub mod verification;
pub mod xml;

pub use error::{Error, Result};
