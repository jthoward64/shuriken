use diesel::{pg::Pg, prelude::*};
use serde::{Deserialize, Serialize};

use crate::component::db::schema;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum PrincipalType {
    User,
    Group,
    Public,
}

impl PrincipalType {
    #[must_use]
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Group => "group",
            Self::Public => "public",
        }
    }
}

#[derive(
    Debug, Clone, PartialEq, Eq, Hash, Identifiable, Queryable, Selectable, Serialize, Deserialize,
)]
#[diesel(table_name = schema::principal)]
#[diesel(check_for_backend(Pg))]
pub struct Principal {
    pub id: uuid::Uuid,
    pub principal_type: String,
    pub uri: String,
    pub display_name: Option<String>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub deleted_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Clone, Insertable)]
#[diesel(table_name = schema::principal)]
pub struct NewPrincipal<'a> {
    pub id: uuid::Uuid,
    pub principal_type: &'a str,
    pub uri: &'a str,
    pub display_name: Option<&'a str>,
}
