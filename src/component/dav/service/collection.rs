//! Collection creation and management service.

use anyhow::{Context, Result};

use crate::component::db::connection::DbConnection;
use crate::component::db::query::dav::collection;
use crate::component::model::dav::collection::NewDavCollection;

/// Context for collection creation.
pub struct CreateCollectionContext {
    /// Owner principal ID.
    pub owner_principal_id: uuid::Uuid,
    /// Collection URI (e.g., "my-calendar").
    pub uri: String,
    /// Collection type ("calendar" or "addressbook").
    pub collection_type: String,
    /// Optional display name.
    pub displayname: Option<String>,
    /// Optional description.
    pub description: Option<String>,
}

/// Result of a collection creation operation.
#[derive(Debug, Clone)]
pub struct CreateCollectionResult {
    /// ID of the created collection.
    pub collection_id: uuid::Uuid,
    /// URI of the created collection.
    pub uri: String,
}

/// ## Summary
/// Creates a new DAV collection (calendar or addressbook).
///
/// ## Side Effects
/// - Creates collection record in database
/// - Sets initial sync token to 0
///
/// ## Errors
/// Returns an error if:
/// - Collection already exists
/// - Database operations fail
pub async fn create_collection(
    conn: &mut DbConnection<'_>,
    ctx: &CreateCollectionContext,
) -> Result<CreateCollectionResult> {
    // TODO: Check if collection already exists (409 Conflict)

    // TODO: Validate collection type is either "calendar" or "addressbook"

    let new_collection = NewDavCollection {
        owner_principal_id: ctx.owner_principal_id,
        uri: &ctx.uri,
        collection_type: &ctx.collection_type,
        display_name: ctx.displayname.as_deref(),
        description: ctx.description.as_deref(),
        timezone_tzid: None,
    };

    let created = collection::create_collection(conn, &new_collection)
        .await
        .context("failed to create collection")?;

    Ok(CreateCollectionResult {
        collection_id: created.id,
        uri: created.uri,
    })
}
