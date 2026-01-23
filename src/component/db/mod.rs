use std::sync::OnceLock;

use diesel::{
    PgConnection,
    r2d2::{ConnectionManager, Pool, PoolError, PooledConnection},
};

pub mod connection;
pub mod map;
pub mod query;
pub mod schema;

type PgPool = Pool<ConnectionManager<PgConnection>>;
static DB_POOL: OnceLock<PgPool> = OnceLock::new();
/// Build a database connection pool.
///
/// ## Errors
///
/// Returns a `PoolError` if the pool cannot be constructed.
pub fn build_pool(database_url: &str, size: u32) -> Result<PgPool, PoolError> {
    let manager = ConnectionManager::<PgConnection>::new(database_url);
    Pool::builder()
        .max_size(size)
        .min_idle(Some(size))
        .test_on_check_out(false)
        .idle_timeout(None)
        .max_lifetime(None)
        .build(manager)
}
