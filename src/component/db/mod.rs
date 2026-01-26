use crate::component::error::AppResult;
use std::future::Future;
use std::pin::Pin;

pub mod connection;
pub mod map;
pub mod query;
pub mod schema;
pub mod transaction;

pub trait DbProvider: Send + Sync {
    fn get_connection<'a>(
        &'a self,
    ) -> Pin<Box<dyn Future<Output = AppResult<connection::DbConnection<'a>>> + Send + 'a>>;
}
