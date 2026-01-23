use crate::app::db::schema;
use diesel::prelude::*;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Identifiable, Queryable, Selectable, Associations)]
#[diesel(table_name = schema::auth_user)]
#[diesel(check_for_backend(diesel::pg::Pg))]
#[diesel(belongs_to(super::User, foreign_key = user_id))]
pub struct AuthUser {
    pub id: uuid::Uuid,
    pub auth_source: String,
    pub auth_id: String,
    pub user_id: uuid::Uuid,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Insertable)]
#[diesel(table_name = schema::auth_user)]
pub struct NewAuthUser {
    pub auth_source: String,
    pub auth_id: String,
    pub user_id: uuid::Uuid,
}
