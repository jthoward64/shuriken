use diesel::{pg::Pg, prelude::*};

use crate::db::{enums::CollectionType, schema};

/// DAV collection (`CalDAV` calendar or `CardDAV` addressbook)
#[derive(Debug, Clone, PartialEq, Eq, Queryable, Selectable, Identifiable)]
#[diesel(table_name = schema::dav_collection)]
#[diesel(check_for_backend(Pg))]
pub struct DavCollection {
    pub id: uuid::Uuid,
    pub owner_principal_id: uuid::Uuid,
    pub collection_type: CollectionType,
    pub display_name: Option<String>,
    pub description: Option<String>,
    pub timezone_tzid: Option<String>,
    pub synctoken: i64,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub deleted_at: Option<chrono::DateTime<chrono::Utc>>,
    pub supported_components: Option<Vec<Option<String>>>,
    pub slug: String,
    pub parent_collection_id: Option<uuid::Uuid>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DavCollectionWithParent {
    pub collection: DavCollection,
    pub parent_collection: Option<Box<DavCollection>>,
}

/// Insert struct for creating new DAV collections
#[derive(Debug, Clone, Insertable)]
#[diesel(table_name = schema::dav_collection)]
pub struct NewDavCollection<'a> {
    pub owner_principal_id: uuid::Uuid,
    pub collection_type: CollectionType,
    pub display_name: Option<&'a str>,
    pub description: Option<&'a str>,
    pub timezone_tzid: Option<&'a str>,
    pub slug: &'a str,
}
