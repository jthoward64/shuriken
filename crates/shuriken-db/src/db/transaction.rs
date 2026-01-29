//! Transaction helper utilities for database operations.
//!
//! ## Usage
//!
//! Diesel-async provides built-in transaction support through the `AsyncConnection::transaction` method.
//! To use transactions, wrap your database operations in a closure:
//!
//! ```rust,ignore
//! use diesel_async::scoped_futures::ScopedFutureExt;
//! use crate::db::transaction::with_transaction;
//!
//! with_transaction(conn, |conn| async move {
//!     // Your database operations here
//!     entity::create_entity(conn, &entity).await?;
//!     instance::create_instance(conn, &instance).await?;
//!     Ok(())
//! }.scope_boxed()).await?;
//! ```

use diesel_async::{AsyncConnection, scoped_futures::ScopedBoxFuture};

use crate::db::connection::DbConnection;

/// ## Summary
/// Runs a database transaction and returns the closure result.
///
/// ## Errors
/// Returns any error produced by the closure, or errors raised while starting
/// or committing the transaction.
pub async fn with_transaction<'conn, T, F>(
    conn: &'conn mut DbConnection<'conn>,
    callback: F,
) -> anyhow::Result<T>
where
    F: for<'r> FnOnce(&'r mut DbConnection<'conn>) -> ScopedBoxFuture<'conn, 'r, anyhow::Result<T>>
        + Send
        + 'conn,
    T: Send + 'conn,
{
    conn.transaction::<_, anyhow::Error, _>(callback).await
}
