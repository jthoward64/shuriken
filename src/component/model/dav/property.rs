use diesel::{pg::Pg, prelude::*};

use crate::component::db::schema;

/// Property for a component with typed value storage
#[derive(Debug, Clone, PartialEq, Queryable, Selectable, Identifiable, Associations)]
#[diesel(table_name = schema::dav_property)]
#[diesel(check_for_backend(Pg))]
#[diesel(belongs_to(super::component::DavComponent, foreign_key = component_id))]
pub struct DavProperty {
    pub id: uuid::Uuid,
    pub component_id: uuid::Uuid,
    pub name: String,
    pub value_type: String,
    pub value_text: Option<String>,
    pub value_int: Option<i64>,
    pub value_float: Option<f64>,
    pub value_bool: Option<bool>,
    pub value_date: Option<chrono::NaiveDate>,
    pub value_tstz: Option<chrono::DateTime<chrono::Utc>>,
    pub value_bytes: Option<Vec<u8>>,
    pub value_json: Option<serde_json::Value>,
    pub ordinal: i32,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub deleted_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Insert struct for creating new DAV properties
#[derive(Debug, Clone, Insertable)]
#[diesel(table_name = schema::dav_property)]
pub struct NewDavProperty<'a> {
    pub component_id: uuid::Uuid,
    pub name: &'a str,
    pub value_type: &'a str,
    pub value_text: Option<&'a str>,
    pub value_int: Option<i64>,
    pub value_float: Option<f64>,
    pub value_bool: Option<bool>,
    pub value_date: Option<chrono::NaiveDate>,
    pub value_tstz: Option<chrono::DateTime<chrono::Utc>>,
    pub value_bytes: Option<&'a [u8]>,
    pub value_json: Option<&'a serde_json::Value>,
    pub ordinal: i32,
}
