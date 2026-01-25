#![allow(clippy::unused_async)]
//! Database query tests for DAV operations.
//!
//! These tests verify entity/instance storage, collection management,
//! and derived index operations against a real Postgres database.
//!
//! ## Running Tests
//!
//! Tests require a running Postgres instance with the DATABASE_URL environment
//! variable set. Run migrations before testing:
//!
//! ```sh
//! export DATABASE_URL=postgres://user:pass@localhost/shuriken_test
//! diesel migration run
//! cargo test --lib db::query::dav::tests
//! ```

mod entity;
mod collection;
mod instance;
mod fixtures;
