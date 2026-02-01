use crate::error::DbResult;
use std::future::Future;
use std::pin::Pin;

pub mod connection;
pub mod carddav_keys;
pub mod caldav_keys;
pub mod enums;
pub mod map;
pub mod pg_types;
pub mod query;
pub mod schema;
pub mod transaction;

pub trait DbProvider: Send + Sync {
    fn get_connection<'a>(
        &'a self,
    ) -> Pin<Box<dyn Future<Output = DbResult<connection::DbConnection<'a>>> + Send + 'a>>;
}
