//! Collection creation and management service.

use anyhow::{Context, Result};
use diesel::prelude::*;
use diesel_async::scoped_futures::ScopedFutureExt;
use diesel_async::{AsyncConnection, RunQueryDsl};

use crate::component::db::connection::DbConnection;
use crate::component::db::query::dav::collection;
use crate::component::model::dav::collection::{DavCollection, NewDavCollection};

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
    // Validate collection type
    if ctx.collection_type != "calendar" && ctx.collection_type != "addressbook" {
        anyhow::bail!(
            "invalid collection type '{}': must be 'calendar' or 'addressbook'",
            ctx.collection_type
        );
    }

    let owner_principal_id = ctx.owner_principal_id;
    let uri = ctx.uri.clone();
    let collection_type = ctx.collection_type.clone();
    let displayname = ctx.displayname.clone();
    let description = ctx.description.clone();

    conn.transaction::<_, anyhow::Error, _>(move |tx| {
        let uri = uri.clone();
        let collection_type = collection_type.clone();
        let displayname = displayname.clone();
        let description = description.clone();

        async move {
            // Check if collection already exists with same URI and owner
            let existing: Option<DavCollection> = collection::by_uri_and_principal(&uri, owner_principal_id)
                .first(tx)
                .await
                .optional()
                .context("failed to check for existing collection")?;

            if existing.is_some() {
                anyhow::bail!("collection with URI '{}' already exists", uri);
            }

            let new_collection = NewDavCollection {
                owner_principal_id,
                uri: &uri,
                collection_type: &collection_type,
                display_name: displayname.as_deref(),
                description: description.as_deref(),
                timezone_tzid: None,
            };

            let created = collection::create_collection(tx, &new_collection)
                .await
                .context("failed to create collection")?;

            Ok(CreateCollectionResult {
                collection_id: created.id,
                uri: created.uri,
            })
        }
        .scope_boxed()
    })
    .await
}
