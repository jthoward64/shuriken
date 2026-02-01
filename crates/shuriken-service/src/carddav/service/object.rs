//! Address object storage and retrieval service.

#![allow(clippy::too_many_lines)] // Service orchestration functions are inherently complex

use anyhow::{Context, Result};
use diesel::prelude::*;
use diesel_async::scoped_futures::ScopedFutureExt;
use diesel_async::{AsyncConnection, RunQueryDsl};

use shuriken_db::db::connection::DbConnection;
use shuriken_db::db::enums::EntityType;
use shuriken_db::db::map::carddav::build_card_index;
use shuriken_db::db::query::carddav::card_index;
use shuriken_db::db::query::dav::{collection, entity, instance};
use shuriken_db::model::dav::instance::NewDavInstance;

/// Result of a PUT operation on an address object.
#[derive(Debug, Clone)]
pub struct PutObjectResult {
    /// `ETag` of the created or updated object.
    pub etag: String,
    /// Whether the object was newly created (true) or updated (false).
    pub created: bool,
}

/// Context for PUT operations.
#[derive(Debug)]
pub struct PutObjectContext {
    /// Collection ID where the object will be stored.
    pub collection_id: uuid::Uuid,
    /// Slug of the object within the collection (e.g., "contact").
    pub slug: String,
    /// Entity type for the object.
    pub entity_type: EntityType,
    /// Logical UID extracted from vCard.
    pub logical_uid: Option<String>,
    /// Precondition: If-None-Match header value.
    pub if_none_match: Option<String>,
    /// Precondition: If-Match header value.
    pub if_match: Option<String>,
}

/// ## Summary
/// Stores or updates an address object in the database.
///
/// Parses the vCard data, validates it, checks for UID conflicts,
/// and creates/updates the entity and instance records.
///
/// ## Side Effects
/// - Parses vCard data
/// - Creates or updates database entity and instance
/// - Bumps collection sync token (future implementation)
///
/// ## Errors
/// Returns an error if:
/// - vCard data is invalid
/// - UID conflict is detected
/// - Preconditions fail
/// - Database operations fail
#[tracing::instrument(skip(conn, vcard_bytes), fields(
    collection_id = %ctx.collection_id,
    slug = %ctx.slug,
    entity_type = %ctx.entity_type,
    logical_uid = ?ctx.logical_uid,
    has_if_none_match = ctx.if_none_match.is_some(),
    has_if_match = ctx.if_match.is_some()
))]
pub async fn put_address_object(
    conn: &mut DbConnection<'_>,
    ctx: &PutObjectContext,
    vcard_bytes: &[u8],
) -> Result<PutObjectResult> {
    tracing::debug!("Processing PUT address object");

    // Verify collection exists
    let collection_data = collection::get_collection(conn, ctx.collection_id)
        .await
        .context("failed to query collection")?
        .ok_or_else(|| anyhow::anyhow!("collection not found"))?;

    tracing::debug!("Collection verified");

    // Parse vCard data
    let vcard_str = std::str::from_utf8(vcard_bytes).context("vCard data is not valid UTF-8")?;

    let vcard = shuriken_rfc::rfc::vcard::parse::parse_single(vcard_str)
        .map_err(|e| anyhow::anyhow!("invalid vCard: {e}"))?;

    tracing::debug!("vCard data parsed successfully");

    // Extract UID for validation (optional, but recommended)
    let _uid = vcard.uid().map(String::from);

    // Check if instance already exists
    let existing_instance = instance::by_slug_and_collection(ctx.collection_id, &ctx.slug)
        .select(shuriken_db::model::dav::instance::DavInstance::as_select())
        .first(conn)
        .await
        .optional()
        .context("failed to check for existing instance")?;

    // Handle If-None-Match: * (create-only precondition)
    if let Some(inm) = &ctx.if_none_match
        && inm == "*"
        && existing_instance.is_some()
    {
        tracing::warn!("Precondition failed: resource already exists");
        anyhow::bail!("precondition failed: resource already exists");
    }

    // Handle If-Match (update precondition)
    if let Some(im) = &ctx.if_match {
        if let Some(inst) = &existing_instance {
            if inst.etag != *im {
                tracing::warn!(expected = %inst.etag, got = %im, "Precondition failed: ETag mismatch");
                anyhow::bail!("precondition failed: ETag mismatch");
            }
        } else {
            tracing::warn!("Precondition failed: resource does not exist");
            anyhow::bail!("precondition failed: resource does not exist");
        }
    }

    // Check for UID conflicts in this collection (same UID, different slug)
    if let Some(ref uid) = ctx.logical_uid {
        match entity::check_uid_conflict(conn, ctx.collection_id, uid, &ctx.slug).await {
            Ok(Some(conflicting_uri)) => {
                tracing::warn!(uid = %uid, conflicting_uri = %conflicting_uri, "UID conflict detected");
                anyhow::bail!(
                    "UID conflict: UID '{uid}' is already used by resource '{conflicting_uri}' in this collection"
                );
            }
            Ok(None) => {
                // No conflict, proceed
            }
            Err(e) => {
                tracing::error!(error = %e, "Failed to check UID conflict");
                anyhow::bail!("failed to check UID conflict: {e}");
            }
        }
    }

    let created = existing_instance.is_none();

    // Generate ETag from canonical bytes
    let etag = instance::generate_etag(vcard_bytes);

    let collection_id = ctx.collection_id;
    let slug = ctx.slug.clone();
    let entity_type = ctx.entity_type;
    let logical_uid = ctx.logical_uid.clone();
    let etag_for_tx = etag.clone();
    let collection_synctoken = collection_data.synctoken;

    conn.transaction::<_, anyhow::Error, _>(move |tx| {
        async move {
            if let Some(existing_inst) = existing_instance {
                // Update existing instance

                let sync_revision = existing_inst.sync_revision + 1;
                let _updated_instance = instance::update_instance(
                    tx,
                    existing_inst.id,
                    &etag_for_tx,
                    sync_revision,
                    chrono::Utc::now(),
                )
                .await
                .context("failed to update instance")?;

                // Update the collection sync token
                let _new_synctoken = collection::update_synctoken(tx, collection_id)
                    .await
                    .context("failed to update collection sync token")?;

                // Delete old component tree
                entity::replace_entity_tree(tx, existing_inst.entity_id, &[], &[], &[])
                    .await
                    .context("failed to delete old component tree")?;

                // Delete old index entry for this entity
                card_index::delete_by_entity_id(tx, existing_inst.entity_id)
                    .await
                    .context("failed to delete old index entry")?;

                // Insert new vCard tree
                entity::insert_vcard_tree(tx, existing_inst.entity_id, &vcard)
                    .await
                    .context("failed to insert vCard tree")?;

                // Build and insert card index entry
                let card_idx = build_card_index(existing_inst.entity_id, &vcard);
                card_index::insert(tx, &card_idx)
                    .await
                    .context("failed to insert card index entry")?;
            } else {
                // Create new entity and instance

                let entity_model = shuriken_db::model::dav::entity::NewDavEntity {
                    entity_type,
                    logical_uid,
                };

                let created_entity = entity::create_entity(tx, &entity_model)
                    .await
                    .context("failed to create entity")?;

                // Create instance using the collection data we already fetched
                let new_instance = NewDavInstance {
                    collection_id,
                    entity_id: created_entity.id,
                    slug: &slug,
                    content_type: shuriken_db::db::enums::ContentType::TextVCard,
                    etag: &etag_for_tx,
                    sync_revision: collection_synctoken + 1,
                    last_modified: chrono::Utc::now(),
                };

                let _created_instance = instance::create_instance(tx, &new_instance)
                    .await
                    .context("failed to create instance")?;

                // Update the collection sync token
                let _new_synctoken = collection::update_synctoken(tx, collection_id)
                    .await
                    .context("failed to update collection sync token")?;

                // Insert vCard tree for the new entity
                entity::insert_vcard_tree(tx, created_entity.id, &vcard)
                    .await
                    .context("failed to insert vCard tree")?;

                // Build and insert card index entry
                let card_idx = build_card_index(created_entity.id, &vcard);
                card_index::insert(tx, &card_idx)
                    .await
                    .context("failed to insert card index entry")?;
            }

            Ok(())
        }
        .scope_boxed()
    })
    .await?;

    Ok(PutObjectResult { etag, created })
}
