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
#[tracing::instrument(skip(database_url), fields(pool_size = size))]
pub async fn create_pool(database_url: &str, size: u32) -> anyhow::Result<()> {
    tracing::debug!("Creating database connection pool");
    
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

    tracing::info!(pool_size = size, "Database connection pool created successfully");

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
#[tracing::instrument]
pub async fn connect() -> Result<DbConnection<'static>, RunError> {
    tracing::trace!("Acquiring database connection from pool");
    
    let result = DB_POOL
        .get()
        .expect("Database pool is not initialized - create_pool() must be called at startup")
        .get()
        .await;
    
    if result.is_ok() {
        tracing::trace!("Database connection acquired successfully");
    } else {
        tracing::error!("Failed to acquire database connection from pool");
    }
    
    result
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
