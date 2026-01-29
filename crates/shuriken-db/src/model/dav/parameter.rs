use diesel::{pg::Pg, prelude::*};

use crate::db::schema;

/// Parameter associated with a property
#[derive(Debug, Clone, PartialEq, Eq, Queryable, Selectable, Identifiable, Associations)]
#[diesel(table_name = schema::dav_parameter)]
#[diesel(check_for_backend(Pg))]
#[diesel(belongs_to(super::property::DavProperty, foreign_key = property_id))]
pub struct DavParameter {
    pub id: uuid::Uuid,
    pub property_id: uuid::Uuid,
    pub name: String,
    pub value: String,
    pub ordinal: i32,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub deleted_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Insert struct for creating new DAV parameters
#[derive(Debug, Clone, Insertable)]
#[diesel(table_name = schema::dav_parameter)]
pub struct NewDavParameter<'a> {
    pub property_id: uuid::Uuid,
    pub name: &'a str,
    pub value: &'a str,
    pub ordinal: i32,
}
