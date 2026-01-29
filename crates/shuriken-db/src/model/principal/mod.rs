use diesel::{pg::Pg, prelude::*};
use serde::{Deserialize, Serialize};

use crate::db::schema;

// Re-export PrincipalType for public API
pub use crate::db::enums::PrincipalType;

#[derive(
    Debug, Clone, PartialEq, Eq, Hash, Identifiable, Queryable, Selectable, Serialize, Deserialize,
)]
#[diesel(table_name = schema::principal)]
#[diesel(check_for_backend(Pg))]
pub struct Principal {
    pub id: uuid::Uuid,
    pub principal_type: PrincipalType,
    pub display_name: Option<String>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub deleted_at: Option<chrono::DateTime<chrono::Utc>>,
    pub slug: String,
}

#[derive(Debug, Clone, Insertable)]
#[diesel(table_name = schema::principal)]
pub struct NewPrincipal<'a> {
    pub id: uuid::Uuid,
    pub principal_type: PrincipalType,
    pub display_name: Option<&'a str>,
    pub slug: &'a str,
}
