use diesel_async::AsyncPgConnection;
use diesel_async::pooled_connection::AsyncDieselConnectionManager;
use diesel_async::pooled_connection::bb8::{Pool, PooledConnection};

pub type DbPool = Pool<AsyncPgConnection>;
pub type DbConnection<'pool> = PooledConnection<'pool, AsyncPgConnection>;

/// Creates a new database connection pool.
///
/// ## Errors
/// Returns an error if the pool cannot be created with the provided database URL.
pub async fn create_pool(database_url: &str) -> anyhow::Result<DbPool> {
    let config = AsyncDieselConnectionManager::<AsyncPgConnection>::new(database_url);
    let pool = Pool::builder().build(config).await?;
    Ok(pool)
}
