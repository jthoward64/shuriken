pub mod group_name;

use diesel::prelude::*;

use crate::component::db::schema;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Queryable, Selectable, Identifiable, AsChangeset)]
#[diesel(table_name = schema::group)]
#[diesel(check_for_backend(diesel::pg::Pg))]
pub struct Group {
    pub id: uuid::Uuid,
    pub primary_name: Option<uuid::Uuid>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Insertable)]
#[diesel(table_name = schema::group)]
pub struct NewGroup {
    pub primary_name: Option<uuid::Uuid>,
}
