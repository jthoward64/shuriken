pub mod authuser;
pub mod membership;

use crate::component::db::schema;
use diesel::{pg::Pg, prelude::*};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum UserUniqueCriteria {
    Id(uuid::Uuid),
    Email(String),
    AuthId {
        auth_source: String,
        auth_id: String,
    },
}

#[derive(
    Debug, Clone, PartialEq, Eq, Hash, Identifiable, Queryable, Selectable, Serialize, Deserialize,
)]
#[diesel(table_name = schema::user)]
#[diesel(check_for_backend(Pg))]
pub struct User {
    pub id: uuid::Uuid,
    pub name: String,
    pub email: String,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub principal_id: uuid::Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Insertable)]
#[diesel(table_name = schema::user)]
pub struct NewUser<'a> {
    pub name: &'a str,
    pub email: &'a str,
    pub principal_id: uuid::Uuid,
}
