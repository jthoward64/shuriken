use std::sync::OnceLock;

use diesel_async::AsyncPgConnection;
use diesel_async::pooled_connection::AsyncDieselConnectionManager;
use diesel_async::pooled_connection::bb8::{Pool, PooledConnection, RunError};

pub type DbPool = Pool<AsyncPgConnection>;
pub type DbConnection<'pool> = PooledConnection<'pool, AsyncPgConnection>;

static DB_POOL: OnceLock<DbPool> = OnceLock::new();

/// ## Summary
/// Creates a new database connection pool.
///
/// ## Errors
/// Returns an error if the pool cannot be created with the provided database URL.
///
/// ## Panics
/// Panics if the database pool is already initialized. This is a programming error
/// and indicates `create_pool()` was called multiple times.
pub async fn create_pool(database_url: &str, size: u32) -> anyhow::Result<()> {
    let config = AsyncDieselConnectionManager::<AsyncPgConnection>::new(database_url);

    let pool = Pool::builder()
        .max_size(size)
        .min_idle(Some(size))
        .test_on_check_out(false)
        .idle_timeout(None)
        .max_lifetime(None)
        .build(config)
        .await?;

    DB_POOL
        .set(pool)
        .expect("Database pool is already set - create_pool() must only be called once at startup");

    Ok(())
}

/// Get a connection from the database pool.
///
/// ## Panics
///
/// Panics if the database pool is not initialized. This indicates a programming error
/// where the connection was accessed before `create_pool()` was called.
///
/// ## Errors
///
/// Returns a `PoolError` if unable to get a connection from the pool.
pub async fn connect() -> Result<DbConnection<'static>, RunError> {
    DB_POOL
        .get()
        .expect("Database pool is not initialized - create_pool() must be called at startup")
        .get()
        .await
}

/// ## Summary
/// Get a reference to the global database pool.
///
/// ## Panics
/// Panics if the database pool is not initialized. This indicates a programming error
/// where the pool was accessed before `create_pool()` was called.
#[must_use]
pub fn get_pool() -> DbPool {
    DB_POOL
        .get()
        .expect("Database pool is not initialized - create_pool() must be called at startup")
        .clone()
}
