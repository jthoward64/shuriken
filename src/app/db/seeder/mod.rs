pub mod group;
pub mod user;

use super::connection::DbConnection;

/// Trait for database seeders that populate tables with initial or test data.
pub trait Seeder {
    /// Seeds the database with data.
    ///
    /// ## Errors
    /// Returns an error if the seeding operation fails.
    fn seed(&self, conn: &mut DbConnection<'_>) -> impl Future<Output = anyhow::Result<()>>;
}
