use diesel::prelude::*;
use diesel_async::RunQueryDsl;

use crate::app::db::connection::DbConnection;
use crate::app::db::schema::groups;

use super::Seeder;

pub struct GroupSeeder {
    pub count: usize,
}

impl GroupSeeder {
    #[must_use]
    pub fn new(count: usize) -> Self {
        Self { count }
    }
}

impl Seeder for GroupSeeder {
    async fn seed(&self, conn: &mut DbConnection<'_>) -> anyhow::Result<()> {
        // Check if groups already exist
        let existing_count: i64 = groups::table.count().get_result(conn).await?;

        if existing_count > 0 {
            println!("Groups already seeded, skipping");
            return Ok(());
        }

        // Insert groups - let database generate UUIDs
        for i in 1..=self.count {
            diesel::insert_into(groups::table)
                .default_values()
                .execute(conn)
                .await?;
            println!("Seeded group {}/{}", i, self.count);
        }

        Ok(())
    }
}
