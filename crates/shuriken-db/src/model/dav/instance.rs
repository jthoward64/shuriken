use diesel::{pg::Pg, prelude::*};

use crate::db::{enums::ContentType, schema};

/// Per-collection resource identity that references a canonical `DavEntity`
#[derive(Debug, Clone, PartialEq, Eq, Queryable, Selectable, Identifiable, Associations)]
#[diesel(table_name = schema::dav_instance)]
#[diesel(check_for_backend(Pg))]
#[diesel(belongs_to(super::entity::DavEntity, foreign_key = entity_id))]
#[diesel(belongs_to(super::collection::DavCollection, foreign_key = collection_id))]
pub struct DavInstance {
    pub id: uuid::Uuid,
    pub collection_id: uuid::Uuid,
    pub entity_id: uuid::Uuid,
    pub content_type: ContentType,
    pub etag: String,
    pub sync_revision: i64,
    pub last_modified: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub deleted_at: Option<chrono::DateTime<chrono::Utc>>,
    pub schedule_tag: Option<String>,
    pub slug: String,
}

/// Insert struct for creating new DAV instances
#[derive(Debug, Clone, Insertable)]
#[diesel(table_name = schema::dav_instance)]
pub struct NewDavInstance<'a> {
    pub collection_id: uuid::Uuid,
    pub entity_id: uuid::Uuid,
    pub content_type: ContentType,
    pub etag: &'a str,
    pub sync_revision: i64,
    pub last_modified: chrono::DateTime<chrono::Utc>,
    pub slug: &'a str,
}
