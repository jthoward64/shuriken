//! Calendar object storage and retrieval service.

#![allow(clippy::too_many_lines)] // Service orchestration functions are inherently complex

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use diesel::prelude::*;
use diesel_async::RunQueryDsl;

use crate::component::caldav::recurrence::{extract_recurrence_data, ical_datetime_to_utc, ical_duration_to_chrono};
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
    let collection_data = collection::get_collection(conn, ctx.collection_id)
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

        // Create instance using the collection data we already fetched
        let new_instance = NewDavInstance {
            collection_id: ctx.collection_id,
            entity_id: created_entity.id,
            uri: &ctx.uri,
            content_type: "text/calendar",
            etag: &etag,
            sync_revision: collection_data.synctoken + 1,
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

/// Tolerance for matching RECURRENCE-ID values (in seconds).
///
/// When matching exception instances to their master events, we allow a small
/// tolerance to account for potential timezone conversion rounding differences.
const RECURRENCE_ID_MATCH_TOLERANCE_SECS: i64 = 2;

/// ## Summary
/// Expands recurrences for all VEVENT components in the iCalendar and stores them in `cal_occurrence`.
///
/// This function queries the database for VEVENT components with their UIDs,
/// matches them to the iCalendar components by UID, extracts RRULE properties,
/// expands recurrences, handles RECURRENCE-ID exceptions, and stores occurrences.
///
/// ## Side Effects
/// - **Synchronous expansion**: Recurrence expansion happens synchronously during PUT.
///   For events with very large recurrence sets (thousands of occurrences), this could
///   cause performance issues. Future enhancement: Move expansion to background task.
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
    use crate::component::db::schema::cal_index;
    use std::collections::HashMap;

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

    // Query cal_index to get component IDs with their UIDs and RECURRENCE-IDs
    let cal_index_entries: Vec<(uuid::Uuid, Option<String>, Option<DateTime<Utc>>)> = cal_index::table
        .filter(cal_index::entity_id.eq(entity_id))
        .filter(cal_index::component_type.eq("VEVENT"))
        .select((cal_index::component_id, cal_index::uid, cal_index::recurrence_id_utc))
        .load(conn)
        .await
        .context("failed to query cal_index for VEVENTs")?;

    tracing::debug!(
        cal_index_count = cal_index_entries.len(),
        "Queried cal_index entries"
    );

    // Build UID -> component_id mapping
    let mut uid_to_component_id: HashMap<String, uuid::Uuid> = HashMap::new();
    let mut exception_components: Vec<(String, DateTime<Utc>, uuid::Uuid)> = Vec::new();

    for (component_id, uid_opt, recurrence_id_opt) in cal_index_entries {
        if let Some(uid) = uid_opt {
            if let Some(recurrence_id) = recurrence_id_opt {
                // This is an exception instance
                exception_components.push((uid, recurrence_id, component_id));
            } else {
                // This is a master event
                uid_to_component_id.insert(uid, component_id);
            }
        }
    }

    // Expand recurrences for master events
    let mut all_occurrences = Vec::new();

    for vevent in &vevent_components {
        // Get UID from component
        let Some(uid_prop) = vevent.get_property("UID") else {
            tracing::warn!("VEVENT component missing UID property, skipping");
            continue;
        };
        let Some(uid) = uid_prop.as_text() else {
            tracing::warn!("VEVENT UID property has no text value, skipping");
            continue;
        };

        // Check if this is a RECURRENCE-ID exception
        let is_exception = vevent.get_property("RECURRENCE-ID").is_some();

        if is_exception {
            // Skip exception instances - they'll be handled separately
            tracing::debug!(uid = %uid, "Skipping exception instance (has RECURRENCE-ID)");
            continue;
        }

        // Match with database component by UID
        let Some(&component_id) = uid_to_component_id.get(uid) else {
            tracing::warn!(uid = %uid, "No matching database component found for UID");
            continue;
        };

        if let Some(mut occurrences) =
            expand_component_occurrences(vevent, entity_id, component_id)?
        {
            all_occurrences.append(&mut occurrences);
        }
    }

    // Handle RECURRENCE-ID exceptions
    // Exception occurrences are stored separately with recurrence_id_utc set
    for vevent in &vevent_components {
        if let Some(recurrence_id) = extract_recurrence_id(vevent) {
            let Some(uid_prop) = vevent.get_property("UID") else {
                continue;
            };
            let Some(uid) = uid_prop.as_text() else {
                continue;
            };

            // Find the exception component in the database
            let exception_comp = exception_components
                .iter()
                .find(|(ex_uid, ex_recurrence_id, _)| {
                    ex_uid == uid && (*ex_recurrence_id - recurrence_id).num_seconds().abs() < RECURRENCE_ID_MATCH_TOLERANCE_SECS
                });

            if let Some((_, _, component_id)) = exception_comp {
                // Extract DTSTART and duration for the exception
                if let Some(occ) = create_exception_occurrence(vevent, entity_id, *component_id, recurrence_id)? {
                    all_occurrences.push(occ);
                }
            }
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
fn expand_component_occurrences(
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

/// ## Summary
/// Extracts RECURRENCE-ID from a VEVENT component.
///
/// ## Errors
///
/// Returns `None` if RECURRENCE-ID is not present or cannot be parsed.
fn extract_recurrence_id(component: &Component) -> Option<DateTime<Utc>> {
    let recurrence_id_prop = component.get_property("RECURRENCE-ID")?;
    let tzid = recurrence_id_prop.get_param_value("TZID");
    let recurrence_id_ical = recurrence_id_prop.as_datetime()?;
    ical_datetime_to_utc(recurrence_id_ical, tzid)
}

/// ## Summary
/// Creates a calendar occurrence for a RECURRENCE-ID exception instance.
///
/// Extracts DTSTART and DTEND/DURATION from the exception component and
/// creates an occurrence record with the `recurrence_id_utc` set.
///
/// ## Errors
///
/// Returns an error if the component data is invalid.
fn create_exception_occurrence(
    component: &Component,
    entity_id: uuid::Uuid,
    component_id: uuid::Uuid,
    recurrence_id: DateTime<Utc>,
) -> Result<Option<NewCalOccurrence>> {
    // Extract DTSTART
    let Some(dtstart_prop) = component.get_property("DTSTART") else {
        return Ok(None);
    };
    let tzid = dtstart_prop.get_param_value("TZID");
    let Some(dtstart_ical) = dtstart_prop.as_datetime() else {
        return Ok(None);
    };
    let Some(dtstart_utc) = ical_datetime_to_utc(dtstart_ical, tzid) else {
        return Ok(None);
    };

    // Calculate end time from DTEND or DURATION
    let dtend_utc = if let Some(dtend_prop) = component.get_property("DTEND") {
        let dtend_ical = dtend_prop.as_datetime().ok_or_else(|| anyhow::anyhow!("invalid DTEND"))?;
        let dtend_tzid = dtend_prop.get_param_value("TZID");
        ical_datetime_to_utc(dtend_ical, dtend_tzid)
            .ok_or_else(|| anyhow::anyhow!("failed to convert DTEND to UTC"))?
    } else if let Some(duration_prop) = component.get_property("DURATION") {
        let duration_ical = duration_prop.as_duration()
            .ok_or_else(|| anyhow::anyhow!("invalid DURATION"))?;
        let duration = ical_duration_to_chrono(duration_ical);
        dtstart_utc + duration
    } else {
        // Zero duration
        dtstart_utc
    };

    let occurrence = NewCalOccurrence::new(entity_id, component_id, dtstart_utc, dtend_utc)
        .with_recurrence_id(recurrence_id);

    Ok(Some(occurrence))
}
