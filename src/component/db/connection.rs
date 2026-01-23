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
pub async fn create_pool(database_url: &str, size: u32) -> anyhow::Result<DbPool> {
    let config = AsyncDieselConnectionManager::<AsyncPgConnection>::new(database_url);

    Ok(Pool::builder()
        .max_size(size)
        .min_idle(Some(size))
        .test_on_check_out(false)
        .idle_timeout(None)
        .max_lifetime(None)
        .build(config)
        .await?)
}

/// Get a connection from the database pool.
///
/// ## Panics
///
/// Panics if the database pool is not initialized.
///
/// ## Errors
///
/// Returns a `PoolError` if unable to get a connection from the pool.
pub async fn connect() -> Result<DbConnection<'static>, RunError> {
    #[expect(clippy::expect_used)]
    DB_POOL
        .get()
        .expect("Database pool is not initialized")
        .get()
        .await
}

/// ## Summary
/// Get a reference to the global database pool.
///
/// ## Panics
/// Panics if the database pool is not initialized.
pub fn get_pool() -> DbPool {
    #[expect(clippy::expect_used)]
    DB_POOL
        .get()
        .expect("Database pool is not initialized")
        .clone()
}
