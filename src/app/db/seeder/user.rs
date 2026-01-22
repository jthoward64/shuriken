use diesel::prelude::*;
use diesel_async::RunQueryDsl;
use uuid::Uuid;

use crate::app::db::connection::DbConnection;
use crate::app::db::schema::{groups, users};

use super::Seeder;

pub struct UserSeeder {
    pub users: Vec<UserSeed>,
}

pub struct UserSeed {
    pub name: String,
    pub email: String,
    pub group_id: Option<Uuid>,
}

impl UserSeeder {
    #[must_use]
    pub fn new(users: Vec<UserSeed>) -> Self {
        Self { users }
    }

    /// Creates a seeder with sample users for testing
    #[must_use]
    pub fn sample() -> Self {
        Self {
            users: vec![
                UserSeed {
                    name: "Alice".to_string(),
                    email: "alice@example.com".to_string(),
                    group_id: None,
                },
                UserSeed {
                    name: "Bob".to_string(),
                    email: "bob@example.com".to_string(),
                    group_id: None,
                },
                UserSeed {
                    name: "Charlie".to_string(),
                    email: "charlie@example.com".to_string(),
                    group_id: None,
                },
            ],
        }
    }
}

impl Seeder for UserSeeder {
    async fn seed(&self, conn: &mut DbConnection<'_>) -> anyhow::Result<()> {
        // Check if users already exist
        let existing_count: i64 = users::table.count().get_result(conn).await?;

        if existing_count > 0 {
            println!("Users already seeded, skipping");
            return Ok(());
        }

        // Get first group if exists (optional assignment)
        let first_group: Option<Uuid> = groups::table
            .select(groups::id)
            .first(conn)
            .await
            .optional()?;

        // Insert users
        for (idx, user_seed) in self.users.iter().enumerate() {
            diesel::insert_into(users::table)
                .values((
                    users::name.eq(&user_seed.name),
                    users::email.eq(&user_seed.email),
                    users::group_id.eq(user_seed.group_id.or(first_group)),
                ))
                .execute(conn)
                .await?;
            println!(
                "Seeded user {}/{}: {}",
                idx + 1,
                self.users.len(),
                user_seed.name
            );
        }

        Ok(())
    }
}
