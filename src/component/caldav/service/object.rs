//! Calendar object storage and retrieval service.

#![allow(clippy::too_many_lines)] // Service orchestration functions are inherently complex

use anyhow::{Context, Result};
use diesel::prelude::*;
use diesel_async::RunQueryDsl;

use crate::component::caldav::recurrence::extract_recurrence_data;
use crate::component::db::connection::DbConnection;
use crate::component::db::query::caldav::occurrence;
use crate::component::db::query::dav::{collection, entity, instance};
use crate::component::model::dav::instance::NewDavInstance;
use crate::component::model::dav::occurrence::NewCalOccurrence;
use crate::component::rfc::ical::core::{Component, ComponentKind};
use crate::component::rfc::ical::expand::{expand_rrule, ExpansionOptions};
use crate::component::rfc::ical::parse::parse;

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
    /// URI of the object within the collection (e.g., "event.ics").
    pub uri: String,
    /// Entity type for the object.
    pub entity_type: String,
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
    uri = %ctx.uri,
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
    let _collection = collection::get_collection(conn, ctx.collection_id)
        .await
        .context("failed to query collection")?
        .ok_or_else(|| anyhow::anyhow!("collection not found"))?;

    tracing::debug!("Collection verified");

    // Parse iCalendar data
    let ical_str = std::str::from_utf8(ical_bytes).context("iCalendar data is not valid UTF-8")?;

    let ical = parse(ical_str).map_err(|e| anyhow::anyhow!("invalid iCalendar: {e}"))?;

    tracing::debug!("iCalendar data parsed successfully");

    // Extract UID for validation (optional, but recommended)
    let _uid = ical.root.uid().map(String::from);

    // Check if instance already exists
    let existing_instance = instance::by_collection_and_uri(ctx.collection_id, &ctx.uri)
        .select(crate::component::model::dav::instance::DavInstance::as_select())
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

    // Check for UID conflicts in this collection (same UID, different URI)
    if let Some(ref uid) = ctx.logical_uid {
        match entity::check_uid_conflict(conn, ctx.collection_id, uid, &ctx.uri).await {
            Ok(Some(conflicting_uri)) => {
                tracing::warn!(uid = %uid, conflicting_uri = %conflicting_uri, "UID conflict detected");
                anyhow::bail!(
                    "UID conflict: UID '{uid}' is already used by resource '{conflicting_uri}' in this collection"
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

    // TODO: Use a transaction for atomic updates
    // For now, we'll do sequential operations

    if let Some(existing_inst) = existing_instance {
        tracing::debug!("Updating existing instance");

        // Update existing instance
        // For now, just update the ETag and sync revision
        // Full entity tree replacement will be implemented once proper ID mapping is in place

        let sync_revision = existing_inst.sync_revision + 1;
        let _updated_instance = instance::update_instance(
            conn,
            existing_inst.id,
            &etag,
            sync_revision,
            chrono::Utc::now(),
        )
        .await
        .context("failed to update instance")?;

        // Update the collection sync token
        let _new_synctoken = collection::update_synctoken(conn, ctx.collection_id)
            .await
            .context("failed to update collection sync token")?;

        // Delete old component tree
        entity::replace_entity_tree(conn, existing_inst.entity_id, &[], &[], &[])
            .await
            .context("failed to delete old component tree")?;

        // Delete old occurrences for this entity
        occurrence::delete_by_entity_id(conn, existing_inst.entity_id)
            .await
            .context("failed to delete old occurrences")?;

        // Insert new component tree
        entity::insert_ical_tree(conn, existing_inst.entity_id, &ical)
            .await
            .context("failed to insert component tree")?;

        // Expand and store recurrences for the updated entity
        expand_and_store_occurrences(conn, existing_inst.entity_id, &ical)
            .await
            .context("failed to expand recurrences")?;

        tracing::info!("Calendar object updated successfully");
    } else {
        tracing::debug!("Creating new instance");

        // Create new entity and instance
        // For now, create a minimal entity without the full tree
        // Full tree insertion will be implemented once proper ID mapping is in place

        let entity_model = crate::component::model::dav::entity::NewDavEntity {
            entity_type: &ctx.entity_type,
            logical_uid: ctx.logical_uid.as_deref(),
        };

        let created_entity = entity::create_entity(conn, &entity_model)
            .await
            .context("failed to create entity")?;

        // Create instance
        let new_instance = NewDavInstance {
            collection_id: ctx.collection_id,
            entity_id: created_entity.id,
            uri: &ctx.uri,
            content_type: "text/calendar",
            etag: &etag,
            sync_revision: 1, // TODO: Get next sync revision from collection
            last_modified: chrono::Utc::now(),
        };

        let _created_instance = instance::create_instance(conn, &new_instance)
            .await
            .context("failed to create instance")?;

        // Update the collection sync token
        let _new_synctoken = collection::update_synctoken(conn, ctx.collection_id)
            .await
            .context("failed to update collection sync token")?;

        // Insert component tree for the new entity
        entity::insert_ical_tree(conn, created_entity.id, &ical)
            .await
            .context("failed to insert component tree")?;

        // Expand and store recurrences for the new entity
        expand_and_store_occurrences(conn, created_entity.id, &ical)
            .await
            .context("failed to expand recurrences")?;

        tracing::info!("Calendar object created successfully");
    }

    tracing::debug!(created = %created, "PUT calendar object completed successfully");
    Ok(PutObjectResult { etag, created })
}

/// ## Summary
/// Expands recurrences for all VEVENT components in the iCalendar and stores them in `cal_occurrence`.
///
/// This function queries the database for VEVENT components that were just inserted,
/// extracts their RRULE properties, expands the recurrences, and stores the occurrences.
///
/// ## Errors
/// Returns an error if:
/// - Database queries fail
/// - Recurrence expansion fails
/// - Occurrence insertion fails
async fn expand_and_store_occurrences(
    conn: &mut DbConnection<'_>,
    entity_id: uuid::Uuid,
    ical: &crate::component::rfc::ical::core::ICalendar,
) -> Result<()> {
    use crate::component::db::schema::dav_component;

    // Find all VEVENT components in the iCalendar
    let vevent_components: Vec<&Component> = ical
        .root
        .children
        .iter()
        .filter(|c| c.kind == Some(ComponentKind::Event))
        .collect();

    if vevent_components.is_empty() {
        return Ok(());
    }

    tracing::debug!(count = vevent_components.len(), "Found VEVENT components");

    // Query all components for this entity that are VEVENTs
    let db_components: Vec<crate::component::model::dav::component::DavComponent> =
        dav_component::table
            .filter(dav_component::entity_id.eq(entity_id))
            .filter(dav_component::name.eq("VEVENT"))
            .filter(dav_component::deleted_at.is_null())
            .select(crate::component::model::dav::component::DavComponent::as_select())
            .load(conn)
            .await
            .context("failed to query VEVENT components")?;

    tracing::debug!(
        db_count = db_components.len(),
        "Queried VEVENT components from database"
    );

    // For each VEVENT component, expand recurrences
    let mut all_occurrences = Vec::new();

    for (idx, vevent) in vevent_components.iter().enumerate() {
        // Match with database component (by index for now - not ideal but works for simple cases)
        let Some(db_component) = db_components.get(idx) else {
            continue;
        };

        if let Some(mut occurrences) =
            expand_component_occurrences(vevent, entity_id, db_component.id).await?
        {
            all_occurrences.append(&mut occurrences);
        }
    }

    if !all_occurrences.is_empty() {
        tracing::debug!(count = all_occurrences.len(), "Inserting recurrence occurrences");
        occurrence::insert_occurrences(conn, &all_occurrences)
            .await
            .context("failed to insert occurrences")?;
    }

    Ok(())
}

/// ## Summary
/// Expands recurrences for a single VEVENT component.
///
/// Extracts RRULE, DTSTART, DURATION/DTEND, EXDATE, and RDATE from the component,
/// expands the recurrence rule, and generates occurrence records.
///
/// ## Errors
/// Returns an error if recurrence expansion fails.
async fn expand_component_occurrences(
    component: &Component,
    entity_id: uuid::Uuid,
    component_id: uuid::Uuid,
) -> Result<Option<Vec<NewCalOccurrence>>> {
    // Extract recurrence data
    let Some(recurrence_data) = extract_recurrence_data(component) else {
        // No RRULE, skip
        return Ok(None);
    };

    tracing::debug!(
        rrule = %recurrence_data.rrule,
        dtstart = %recurrence_data.dtstart_utc,
        duration = ?recurrence_data.duration,
        "Expanding recurrence rule"
    );

    // Expand RRULE with a limit of 1000 occurrences for safety
    let options = ExpansionOptions::default().with_max_instances(1000);

    let occurrence_dates = expand_rrule(
        &recurrence_data.rrule,
        recurrence_data.dtstart_utc,
        &recurrence_data.exdates,
        &recurrence_data.rdates,
        options,
    )
    .map_err(|e| anyhow::anyhow!("failed to expand RRULE: {e}"))?;

    tracing::debug!(count = occurrence_dates.len(), "Generated occurrences");

    let occurrences: Vec<NewCalOccurrence> = occurrence_dates
        .iter()
        .map(|&start| {
            let end = start + recurrence_data.duration;
            NewCalOccurrence::new(entity_id, component_id, start, end)
        })
        .collect();

    Ok(Some(occurrences))
}
