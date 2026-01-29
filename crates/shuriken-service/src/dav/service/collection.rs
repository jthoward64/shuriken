//! Collection creation and management service.

use anyhow::{Context, Result};
use diesel::prelude::*;
use diesel_async::scoped_futures::ScopedFutureExt;
use diesel_async::{AsyncConnection, RunQueryDsl};

use shuriken_db::db::connection::DbConnection;
use shuriken_db::db::enums::CollectionType;
use shuriken_db::db::query::dav::collection;
use shuriken_db::model::dav::collection::{DavCollection, NewDavCollection};

/// Context for collection creation.
pub struct CreateCollectionContext {
    /// Owner principal ID.
    pub owner_principal_id: uuid::Uuid,
    /// Collection slug (e.g., "my-calendar").
    pub slug: String,
    /// Collection type ("collection", "calendar", or "addressbook").
    pub collection_type: CollectionType,
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
    /// Slug of the created collection.
    pub slug: String,
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
    let owner_principal_id = ctx.owner_principal_id;
    let slug = ctx.slug.clone();
    let collection_type = ctx.collection_type;
    let displayname = ctx.displayname.clone();
    let description = ctx.description.clone();

    conn.transaction::<_, anyhow::Error, _>(move |tx| {
        let slug = slug.clone();
        let displayname = displayname.clone();
        let description = description.clone();

        async move {
            // Check if collection already exists with same slug and owner
            let existing: Option<DavCollection> =
                collection::by_slug_and_principal(&slug, owner_principal_id)
                    .first(tx)
                    .await
                    .optional()
                    .context("failed to check for existing collection")?;

            if existing.is_some() {
                anyhow::bail!("collection with slug '{slug}' already exists");
            }

            let new_collection = NewDavCollection {
                owner_principal_id,
                collection_type,
                display_name: displayname.as_deref(),
                description: description.as_deref(),
                timezone_tzid: None,
                slug: &slug,
            };

            let created = collection::create_collection(tx, &new_collection)
                .await
                .context("failed to create collection")?;

            Ok(CreateCollectionResult {
                collection_id: created.id,
                slug: created.slug,
            })
        }
        .scope_boxed()
    })
    .await
}
