//! Calendar object storage and retrieval service.

#![allow(clippy::too_many_lines)] // Service orchestration functions are inherently complex

use anyhow::{Context, Result};
use diesel::prelude::*;
use diesel_async::scoped_futures::ScopedFutureExt;
use diesel_async::{AsyncConnection, RunQueryDsl};

use shuriken_db::db::connection::DbConnection;
use shuriken_db::db::enums::EntityType;
use shuriken_db::db::map::caldav::build_cal_indexes;
use shuriken_db::db::query::caldav::event_index;
use shuriken_db::db::query::dav::{collection, entity, instance};
use shuriken_db::model::dav::instance::NewDavInstance;
use shuriken_rfc::rfc::ical::expand::build_timezone_resolver;
use shuriken_rfc::rfc::ical::parse::parse;

/// Result of a PUT operation on a calendar object.
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
    /// Slug of the object within the collection (e.g., "event").
    pub slug: String,
    /// Entity type for the object.
    pub entity_type: EntityType,
    /// Logical UID extracted from iCalendar.
    pub logical_uid: Option<String>,
    /// Precondition: If-None-Match header value.
    pub if_none_match: Option<String>,
    /// Precondition: If-Match header value.
    pub if_match: Option<String>,
}

/// ## Summary
/// Stores or updates a calendar object in the database.
///
/// Parses the iCalendar data, validates it, checks for UID conflicts,
/// and creates/updates the entity and instance records.
///
/// ## Side Effects
/// - Parses iCalendar data
/// - Creates or updates database entity and instance
/// - Bumps collection sync token (future implementation)
///
/// ## Errors
/// Returns an error if:
/// - iCalendar data is invalid
/// - UID conflict is detected
/// - Preconditions fail
/// - Database operations fail
#[tracing::instrument(skip(conn, ical_bytes), fields(
    collection_id = %ctx.collection_id,
    slug = %ctx.slug,
    entity_type = %ctx.entity_type,
    logical_uid = ?ctx.logical_uid,
    has_if_none_match = ctx.if_none_match.is_some(),
    has_if_match = ctx.if_match.is_some()
))]
pub async fn put_calendar_object(
    conn: &mut DbConnection<'_>,
    ctx: &PutObjectContext,
    ical_bytes: &[u8],
) -> Result<PutObjectResult> {
    tracing::debug!("Processing PUT calendar object");

    // Verify collection exists
    let collection_data = collection::get_collection(conn, ctx.collection_id)
        .await
        .context("failed to query collection")?
        .ok_or_else(|| anyhow::anyhow!("collection not found"))?;

    tracing::debug!("Collection verified");

    // Parse iCalendar data
    let ical_str = std::str::from_utf8(ical_bytes).context("iCalendar data is not valid UTF-8")?;

    let ical = parse(ical_str).map_err(|e| anyhow::anyhow!("invalid iCalendar: {e}"))?;

    let mut tz_resolver = build_timezone_resolver(&ical)
        .map_err(|e| anyhow::anyhow!("invalid VTIMEZONE component: {e}"))?;

    tracing::debug!("iCalendar data parsed successfully");

    // Extract UID for validation (optional, but recommended)
    let _uid = ical.root.uid().map(String::from);

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
            Ok(Some(conflicting_slug)) => {
                tracing::warn!(uid = %uid, conflicting_slug = %conflicting_slug, "UID conflict detected");
                anyhow::bail!(
                    "UID conflict: UID '{uid}' is already used by resource '{conflicting_slug}' in this collection"
                );
            }
            Ok(None) => {
                tracing::trace!("No UID conflict detected");
            }
            Err(e) => {
                tracing::error!(error = %e, "Failed to check UID conflict");
                anyhow::bail!("failed to check UID conflict: {e}");
            }
        }
    }

    let created = existing_instance.is_none();

    // Generate ETag from canonical bytes
    let etag = instance::generate_etag(ical_bytes);

    tracing::debug!(etag = %etag, "Generated ETag");

    let collection_id = ctx.collection_id;
    let slug = ctx.slug.clone();
    let entity_type = ctx.entity_type;
    let logical_uid = ctx.logical_uid.clone();
    let etag_for_tx = etag.clone();
    let collection_synctoken = collection_data.synctoken;

    conn.transaction::<_, anyhow::Error, _>(move |tx| {
        async move {
            if let Some(existing_inst) = existing_instance {
                tracing::debug!("Updating existing instance");

                // Update existing instance
                // For now, just update the ETag and sync revision
                // Full entity tree replacement will be implemented once proper ID mapping is in place

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

                // Delete old index entries for this entity
                event_index::delete_by_entity_id(tx, existing_inst.entity_id)
                    .await
                    .context("failed to delete old index entries")?;

                // Insert new component tree and get component ID mapping
                let component_map = entity::insert_ical_tree(tx, existing_inst.entity_id, &ical)
                    .await
                    .context("failed to insert component tree")?;

                // Build and insert calendar index entries using real component IDs
                let cal_indexes = build_cal_indexes(
                    existing_inst.entity_id,
                    &ical,
                    &component_map,
                    &mut tz_resolver,
                );
                tracing::trace!(
                    index_count = cal_indexes.len(),
                    component_map_size = component_map.len(),
                    "Built calendar indexes for update"
                );
                event_index::insert_batch(tx, &cal_indexes)
                    .await
                    .context("failed to insert calendar index entries")?;
                tracing::trace!("Inserted {} calendar index entries", cal_indexes.len());

                tracing::info!("Calendar object updated successfully");
            } else {
                tracing::debug!("Creating new instance");

                // Create new entity and instance
                // For now, create a minimal entity without the full tree
                // Full tree insertion will be implemented once proper ID mapping is in place

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
                    content_type: shuriken_db::db::enums::ContentType::TextCalendar,
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

                // Insert component tree for the new entity and get component ID mapping
                let component_map = entity::insert_ical_tree(tx, created_entity.id, &ical)
                    .await
                    .context("failed to insert component tree")?;

                // Build and insert calendar index entries using real component IDs
                let cal_indexes =
                    build_cal_indexes(created_entity.id, &ical, &component_map, &mut tz_resolver);
                tracing::trace!(
                    index_count = cal_indexes.len(),
                    component_map_size = component_map.len(),
                    "Built calendar indexes for create"
                );
                event_index::insert_batch(tx, &cal_indexes)
                    .await
                    .context("failed to insert calendar index entries")?;
                tracing::trace!("Inserted {} calendar index entries", cal_indexes.len());

                tracing::info!("Calendar object created successfully");
            }

            Ok(())
        }
        .scope_boxed()
    })
    .await?;

    tracing::debug!(created = %created, "PUT calendar object completed successfully");
    Ok(PutObjectResult { etag, created })
}
