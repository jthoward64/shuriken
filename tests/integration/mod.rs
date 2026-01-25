#![allow(clippy::unused_async)]
//! Integration tests for CalDAV/CardDAV HTTP methods.
//!
//! These tests verify protocol-level correctness by running the Salvo app
//! against a test Postgres database and issuing real HTTP requests.
//!
//! ## Running Tests
//!
//! Tests require a running Postgres instance with the DATABASE_URL environment
//! variable set. Run migrations before testing:
//!
//! ```sh
//! export DATABASE_URL=postgres://user:pass@localhost/shuriken_test
//! diesel migration run
//! cargo test --test integration
//! ```
//!
//! Most tests are currently marked `#[ignore]` as they require the HTTP
//! routing to be fully wired up.

mod helpers;
mod options;
mod propfind;
mod proppatch;
mod get_head;
mod put;
mod delete;
mod copy_move;
mod mkcol;
