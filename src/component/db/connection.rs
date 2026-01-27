use diesel_async::AsyncPgConnection;
use diesel_async::pooled_connection::AsyncDieselConnectionManager;
use diesel_async::pooled_connection::bb8::{Pool, PooledConnection};
use salvo::async_trait;
use std::sync::Arc;

use crate::component::db::DbProvider;
use crate::component::error::{AppError, AppResult};

pub type DbPool = Pool<AsyncPgConnection>;
pub type DbConnection<'pool> = PooledConnection<'pool, AsyncPgConnection>;

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
pub async fn create_pool(database_url: &str, size: u32) -> anyhow::Result<DbPool> {
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

    tracing::info!(
        pool_size = size,
        "Database connection pool created successfully"
    );

    Ok(pool)
}

impl DbProvider for DbPool {
    #[tracing::instrument(skip(self))]
    fn get_connection<'a>(
        &'a self,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = AppResult<DbConnection<'a>>> + Send + 'a>>
    {
        Box::pin(async move {
            let conn = self.get().await?;
            Ok(conn)
        })
    }
}

pub struct DbProviderHandler<T: DbProvider + Send + Sync + Clone> {
    pub provider: T,
}
#[async_trait]
impl<T: DbProvider + Send + Sync + Clone + 'static> salvo::Handler for DbProviderHandler<T> {
    #[tracing::instrument(skip(self, _req, depot, _res, _ctrl))]
    async fn handle(
        &self,
        _req: &mut salvo::Request,
        depot: &mut salvo::Depot,
        _res: &mut salvo::Response,
        _ctrl: &mut salvo::FlowCtrl,
    ) {
        // Insert a reference to the pool into the depot
        let provider: Arc<dyn DbProvider + Send + Sync> = Arc::new(self.provider.clone());
        depot.inject(provider);
    }
}

/// ## Summary
/// Retrieves the database provider from the depot.
///
/// ## Errors
/// Returns an error if the database provider is not found in the depot.
pub fn get_db_from_depot(
    depot: &salvo::Depot,
) -> AppResult<Arc<dyn DbProvider + Send + Sync + 'static>> {
    depot
        .obtain::<Arc<dyn DbProvider + Send + Sync>>()
        .cloned()
        .map_err(|_err| AppError::InvariantViolation("Database provider not found in depot"))
}
