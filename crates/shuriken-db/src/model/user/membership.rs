use crate::{db::schema, model};
use diesel::{pg::Pg, prelude::*};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Identifiable, Queryable, Selectable, Associations)]
#[diesel(table_name = schema::membership)]
#[diesel(check_for_backend(Pg))]
#[diesel(primary_key(user_id, group_id))]
#[diesel(belongs_to(model::user::User, foreign_key = user_id))]
#[diesel(belongs_to(model::group::Group, foreign_key = group_id))]
pub struct Membership {
    pub user_id: uuid::Uuid,
    pub group_id: uuid::Uuid,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Insertable)]
#[diesel(table_name = schema::membership)]
pub struct NewMembership {
    pub user_id: uuid::Uuid,
    pub group_id: uuid::Uuid,
}
