use diesel::{pg::Pg, prelude::*};

use crate::component::db::schema;

/// Deletion tombstone for sync correctness after purge
#[derive(Debug, Clone, PartialEq, Eq, Queryable, Selectable, Identifiable, Associations)]
#[diesel(table_name = schema::dav_tombstone)]
#[diesel(check_for_backend(Pg))]
#[diesel(belongs_to(super::collection::DavCollection, foreign_key = collection_id))]
pub struct DavTombstone {
    pub id: uuid::Uuid,
    pub collection_id: uuid::Uuid,
    pub entity_id: Option<uuid::Uuid>,
    pub synctoken: i64,
    pub sync_revision: i64,
    pub deleted_at: chrono::DateTime<chrono::Utc>,
    pub last_etag: Option<String>,
    pub logical_uid: Option<String>,
    pub uri_variants: Vec<Option<String>>,
}

/// Insert struct for creating new DAV tombstones
#[derive(Debug, Clone, Insertable)]
#[diesel(table_name = schema::dav_tombstone)]
pub struct NewDavTombstone<'a> {
    pub collection_id: uuid::Uuid,
    pub entity_id: Option<uuid::Uuid>,
    pub synctoken: i64,
    pub sync_revision: i64,
    pub deleted_at: chrono::DateTime<chrono::Utc>,
    pub last_etag: Option<&'a str>,
    pub logical_uid: Option<&'a str>,
    pub uri_variants: Vec<String>,
}
