//! Transaction helper utilities for database operations.
//!
//! ## Usage
//!
//! Diesel-async provides built-in transaction support through the `AsyncConnection::transaction` method.
//! To use transactions, wrap your database operations in a closure:
//!
//! ```rust,ignore
//! use diesel_async::{AsyncConnection, scoped_futures::ScopedFutureExt};
//!
//! conn.transaction::<_, diesel::result::Error, _>(|conn| async move {
//!     // Your database operations here
//!     entity::create_entity(conn, &entity).await?;
//!     instance::create_instance(conn, &instance).await?;
//!     Ok(())
//! }.scope_boxed()).await?;
//! ```
//!
//! ## Note
//!
//! The current PUT handlers execute operations sequentially without explicit transaction wrapping.
//! For production use, operations should be wrapped in transactions to ensure atomicity.
//! This is left as a TODO to avoid complexity during initial implementation.
