pub mod authuser;
pub mod membership;

use crate::app::db::schema;
use diesel::prelude::*;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum UserUniqueCriteria {
    Id(uuid::Uuid),
    Email(String),
    AuthId {
        auth_source: String,
        auth_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Identifiable, Queryable, Selectable)]
#[diesel(table_name = schema::user)]
#[diesel(check_for_backend(diesel::pg::Pg))]
pub struct User {
    pub id: uuid::Uuid,
    pub name: String,
    pub email: String,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Insertable)]
#[diesel(table_name = schema::user)]
pub struct NewUser {
    pub name: String,
    pub email: String,
}
