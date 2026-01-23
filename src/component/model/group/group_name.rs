use diesel::prelude::*;

use crate::component::db::schema;

#[derive(
    Debug,
    Clone,
    PartialEq,
    Eq,
    Hash,
    Queryable,
    Selectable,
    Identifiable,
    AsChangeset,
    Associations,
)]
#[diesel(table_name = schema::group_name)]
#[diesel(belongs_to(super::Group, foreign_key = group_id))]
#[diesel(check_for_backend(diesel::pg::Pg))]
pub struct GroupName {
    pub id: uuid::Uuid,
    pub group_id: uuid::Uuid,
    pub name: String,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Insertable)]
#[diesel(table_name = schema::group_name)]
pub struct NewGroupName {
    pub group_id: uuid::Uuid,
    pub name: String,
}
