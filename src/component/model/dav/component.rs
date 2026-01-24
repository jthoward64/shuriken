use diesel::{pg::Pg, prelude::*};

use crate::component::db::schema;

/// Component tree for iCalendar/vCard content
#[derive(Debug, Clone, PartialEq, Eq, Queryable, Selectable, Identifiable, Associations)]
#[diesel(table_name = schema::dav_component)]
#[diesel(check_for_backend(Pg))]
#[diesel(belongs_to(super::entity::DavEntity, foreign_key = entity_id))]
pub struct DavComponent {
    pub id: uuid::Uuid,
    pub entity_id: uuid::Uuid,
    pub parent_component_id: Option<uuid::Uuid>,
    pub name: String,
    pub ordinal: i32,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub deleted_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Insert struct for creating new DAV components
#[derive(Debug, Clone, Insertable)]
#[diesel(table_name = schema::dav_component)]
pub struct NewDavComponent<'a> {
    pub entity_id: uuid::Uuid,
    pub parent_component_id: Option<uuid::Uuid>,
    pub name: &'a str,
    pub ordinal: i32,
}
