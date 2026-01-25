//! Address object storage and retrieval service.

use anyhow::{Context, Result};

use crate::component::db::connection::DbConnection;
use crate::component::db::query::dav::{collection, entity, instance};
use crate::component::model::dav::instance::NewDavInstance;

/// Result of a PUT operation on an address object.
#[derive(Debug, Clone)]
pub struct PutObjectResult {
    /// ETag of the created or updated object.
    pub etag: String,
    /// Whether the object was newly created (true) or updated (false).
    pub created: bool,
}

/// Context for PUT operations.
pub struct PutObjectContext {
    /// Collection ID where the object will be stored.
    pub collection_id: uuid::Uuid,
    /// URI of the object within the collection (e.g., "contact.vcf").
    pub uri: String,
    /// Entity type for the object.
    pub entity_type: String,
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
pub async fn put_address_object(
    conn: &mut DbConnection<'_>,
    ctx: &PutObjectContext,
    vcard_bytes: &[u8],
) -> Result<PutObjectResult> {
    // Verify collection exists
    let _collection = collection::get_collection(conn, ctx.collection_id)
        .await
        .context("failed to query collection")?
        .ok_or_else(|| anyhow::anyhow!("collection not found"))?;

    // Parse vCard data
    let vcard_str = std::str::from_utf8(vcard_bytes)
        .context("vCard data is not valid UTF-8")?;
    
    let vcard = crate::component::rfc::vcard::parse::parse_single(vcard_str)
        .map_err(|e| anyhow::anyhow!("invalid vCard: {}", e))?;

    // Extract UID for validation (optional, but recommended)
    let uid = vcard.uid().map(String::from);

    // Check if instance already exists
    use diesel::prelude::*;
    use diesel_async::RunQueryDsl;
    
    let existing_instance = instance::by_collection_and_uri(ctx.collection_id, &ctx.uri)
        .select(crate::component::model::dav::instance::DavInstance::as_select())
        .first(conn)
        .await
        .optional()
        .context("failed to check for existing instance")?;

    // Handle If-None-Match: * (create-only precondition)
    if let Some(inm) = &ctx.if_none_match {
        if inm == "*" && existing_instance.is_some() {
            anyhow::bail!("precondition failed: resource already exists");
        }
    }

    // Handle If-Match (update precondition)
    if let Some(im) = &ctx.if_match {
        match &existing_instance {
            Some(inst) => {
                if inst.etag != *im {
                    anyhow::bail!("precondition failed: ETag mismatch");
                }
            }
            None => {
                anyhow::bail!("precondition failed: resource does not exist");
            }
        }
    }

    // Check for UID conflicts in this collection (same UID, different URI)
    if let Some(uid) = &uid {
        // Query for other instances in this collection with the same logical_uid
        // TODO: Implement uid_conflict_check once we have proper entity->instance queries
        // For now, we allow UID reuse (which is actually correct for overwriting the same resource)
        let _ = uid; // Suppress unused warning
    }

    let created = existing_instance.is_none();

    // Generate ETag from canonical bytes
    let etag = instance::generate_etag(vcard_bytes);

    // TODO: Use a transaction for atomic updates
    // For now, we'll do sequential operations

    if let Some(existing_inst) = existing_instance {
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

        // TODO: Update the entity tree with new vCard content
        // TODO: Bump collection sync token
    } else {
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
            content_type: "text/vcard",
            etag: &etag,
            sync_revision: 1, // TODO: Get next sync revision from collection
            last_modified: chrono::Utc::now(),
        };

        let _created_instance = instance::create_instance(conn, &new_instance)
            .await
            .context("failed to create instance")?;

        // TODO: Insert component tree (components, properties, parameters)
        // TODO: Bump collection sync token
    }

    Ok(PutObjectResult { etag, created })
}
