use diesel::{pg::Pg, prelude::*};

use crate::db::{enums::EntityType, schema};

/// Canonical content entity (shared across one or more DAV instances)
#[derive(Debug, Clone, PartialEq, Eq, Queryable, Selectable, Identifiable)]
#[diesel(table_name = schema::dav_entity)]
#[diesel(check_for_backend(Pg))]
pub struct DavEntity {
    pub id: uuid::Uuid,
    pub entity_type: EntityType,
    pub logical_uid: Option<String>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub deleted_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Insert struct for creating new DAV entities
#[derive(Debug, Clone, Insertable)]
#[diesel(table_name = schema::dav_entity)]
pub struct NewDavEntity {
    pub entity_type: EntityType,
    pub logical_uid: Option<String>,
}
