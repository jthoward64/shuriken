//! PUT method handler for `CardDAV` vCard objects.

mod types;

use salvo::http::{HeaderValue, StatusCode};
use salvo::{Depot, Request, Response, handler};

use shuriken_service::auth::{
    Action, authorizer_from_depot,
    depot::{get_path_location_from_depot, get_terminal_collection_from_depot},
    get_resolved_location_from_depot, get_subjects_from_depot,
};
use shuriken_service::carddav::service::object::{PutObjectContext, put_address_object};

use types::{PutError, PutResult};

/// ## Summary
/// Handles PUT requests for vCard objects (`.vcf` files).
///
/// Parses the vCard request body, validates it, checks preconditions
/// (`If-Match`, `If-None-Match`), stores the entity/instance in the database,
/// and generates an `ETag`.
///
/// ## Side Effects
/// - Parses vCard data
/// - Creates or updates database entity and instance
/// - Bumps collection sync token
/// - Returns 201 Created or 204 No Content
///
/// ## Errors
/// Returns 400 for invalid data, 412 for precondition failures, 500 for server errors.
#[handler]
#[tracing::instrument(skip_all, fields(path = %req.uri().path()))]
pub async fn put(req: &mut Request, res: &mut Response, depot: &Depot) {
    tracing::info!("Handling PUT request for vCard object");

    // Get the collection from the depot (set by SlugResolverHandler)
    let collection = match get_terminal_collection_from_depot(depot) {
        Ok(c) => c.clone(),
        Err(e) => {
            tracing::error!(error = %e, "Terminal collection not found in depot");
            res.status_code(StatusCode::NOT_FOUND);
            return;
        }
    };

    // Get the resource slug from the depot (populated by DavPathMiddleware)
    // Use the original location (PATH_LOCATION) which contains the slug from the URL,
    // not the resolved UUID. The slug is what we need for database lookups.
    let slug = if let Ok(original) = get_path_location_from_depot(depot) {
        original
            .segments()
            .iter()
            .find_map(|seg| {
                if let shuriken_service::auth::PathSegment::Item(s) = seg {
                    // Strip file extensions (.ics, .vcf) to get base slug
                    let cleaned = s.trim_end_matches(".ics").trim_end_matches(".vcf");
                    Some(cleaned.to_string())
                } else {
                    None
                }
            })
            .unwrap_or_else(|| "unknown".to_string())
    } else {
        tracing::error!("Item slug not found in original location");
        res.status_code(StatusCode::BAD_REQUEST);
        return;
    };

    // Read request body
    let body = match req.payload().await {
        Ok(bytes) => bytes.to_vec(),
        Err(e) => {
            tracing::error!(error = %e, "Failed to read request body");
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };

    tracing::debug!(bytes = body.len(), "Request body read successfully");

    // Get database connection
    let provider = match crate::db_handler::get_db_from_depot(depot) {
        Ok(provider) => provider,
        Err(e) => {
            tracing::error!(error = %e, "Failed to get database provider");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    let mut conn = match provider.get_connection().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::error!(error = %e, "Failed to get database connection");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    // Check preconditions
    let if_none_match = req
        .headers()
        .get("If-None-Match")
        .and_then(|h| h.to_str().ok())
        .map(String::from);
    let if_match = req
        .headers()
        .get("If-Match")
        .and_then(|h| h.to_str().ok())
        .map(String::from);

    if if_none_match.is_some() {
        tracing::debug!("If-None-Match header present");
    }
    if if_match.is_some() {
        tracing::debug!("If-Match header present");
    }

    // Check authorization: need write permission
    if let Err(status) = check_put_authorization(depot, &mut conn).await {
        res.status_code(status);
        return;
    }

    // Perform the PUT operation
    match perform_put(
        &mut conn,
        collection.id,
        &slug,
        &body,
        if_none_match,
        if_match,
    )
    .await
    {
        Ok(PutResult::Created(etag)) => {
            tracing::info!(etag = %etag, "vCard object created");
            res.status_code(StatusCode::CREATED);
            if let Ok(etag_value) = HeaderValue::from_str(&etag)
                && res.add_header("ETag", etag_value, true).is_err()
            {
                tracing::warn!("Failed to add ETag header to response");
            }
        }
        Ok(PutResult::Updated(etag)) => {
            tracing::info!(etag = %etag, "vCard object updated");
            res.status_code(StatusCode::NO_CONTENT);
            if let Ok(etag_value) = HeaderValue::from_str(&etag)
                && res.add_header("ETag", etag_value, true).is_err()
            {
                tracing::warn!("Failed to add ETag header to response");
            }
        }
        Ok(PutResult::PreconditionFailed) => {
            res.status_code(StatusCode::PRECONDITION_FAILED);
        }
        Err(PutError::InvalidVcardData(msg)) => {
            tracing::error!(message = %msg, "Invalid vCard data");
            res.status_code(StatusCode::BAD_REQUEST);
            // TODO: Return proper CardDAV error XML with valid-address-data precondition
        }
        Err(PutError::UidConflict(uid)) => {
            tracing::error!(uid = %uid, "UID conflict");
            res.status_code(StatusCode::CONFLICT);
            // TODO: Return proper CardDAV error XML with no-uid-conflict precondition
        }
        Err(PutError::DatabaseError(e)) => {
            tracing::error!(error = %e, "Database error");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
        }
    }
}

/// ## Summary
/// Performs the PUT operation for a vCard object.
///
/// ## Errors
/// Returns `PutError` for validation failures, conflicts, or database errors.
async fn perform_put(
    conn: &mut shuriken_db::db::connection::DbConnection<'_>,
    collection_id: uuid::Uuid,
    slug: &str,
    body: &[u8],
    if_none_match: Option<String>,
    if_match: Option<String>,
) -> Result<PutResult, PutError> {
    // Parse vCard to extract UID early for context
    let vcard_str = std::str::from_utf8(body)
        .map_err(|e| PutError::InvalidVcardData(format!("not valid UTF-8: {e}")))?;
    let vcard = shuriken_rfc::rfc::vcard::parse::parse_single(vcard_str)
        .map_err(|e| PutError::InvalidVcardData(format!("invalid vCard: {e}")))?;
    let logical_uid = vcard.uid().map(String::from);

    // Create PUT context
    let ctx = PutObjectContext {
        collection_id,
        slug: slug.to_string(),
        entity_type: shuriken_db::db::enums::EntityType::VCard,
        logical_uid,
        if_none_match,
        if_match,
    };

    // Call the service layer
    match put_address_object(conn, &ctx, body).await {
        Ok(result) => {
            if result.created {
                Ok(PutResult::Created(result.etag))
            } else {
                Ok(PutResult::Updated(result.etag))
            }
        }
        Err(e) => {
            let err_msg = e.to_string();
            if err_msg.contains("invalid vCard") || err_msg.contains("not valid UTF-8") {
                Err(PutError::InvalidVcardData(err_msg))
            } else if err_msg.contains("precondition failed") {
                Ok(PutResult::PreconditionFailed)
            } else if err_msg.contains("UID conflict") {
                Err(PutError::UidConflict(err_msg))
            } else {
                Err(PutError::DatabaseError(e))
            }
        }
    }
}

/// ## Summary
/// Checks if the current user has write permission for the PUT operation.
///
/// For updates: checks Write permission on the existing Vcard resource.
/// For creates: checks Write permission on the Addressbook collection.
///
/// ## Errors
/// Returns `StatusCode::FORBIDDEN` if authorization is denied.
/// Returns `StatusCode::INTERNAL_SERVER_ERROR` for database or auth errors.
async fn check_put_authorization(
    depot: &Depot,
    conn: &mut shuriken_db::db::connection::DbConnection<'_>,
) -> Result<(), StatusCode> {
    // Get expanded subjects for the current user
    let subjects = get_subjects_from_depot(depot, conn).await.map_err(|e| {
        tracing::error!(error = %e, "Failed to get subjects from depot");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Get ResourceLocation from depot (populated by slug_resolver middleware)
    let resource = get_resolved_location_from_depot(depot).map_err(|e| {
        tracing::error!(error = %e, "ResourceLocation not found in depot; slug_resolver middleware may not have run");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Get the authorizer
    let authorizer = authorizer_from_depot(depot).map_err(|e| {
        tracing::error!(error = %e, "Failed to get authorizer");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Check edit permission
    match authorizer.require(&subjects, resource, Action::Edit) {
        Ok(_level) => Ok(()),
        Err(shuriken_service::error::ServiceError::AuthorizationError(msg)) => {
            tracing::warn!(
                resource = %resource,
                reason = %msg,
                "Authorization denied for PUT"
            );
            Err(StatusCode::FORBIDDEN)
        }
        Err(e) => {
            tracing::error!(error = %e, "Authorization check failed");
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}
