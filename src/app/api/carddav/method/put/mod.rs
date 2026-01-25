//! PUT method handler for `CardDAV` vCard objects.

mod types;

use salvo::http::{HeaderValue, StatusCode};
use salvo::{Request, Response, handler};

use crate::component::carddav::service::object::{PutObjectContext, put_address_object};
use crate::component::db::connection;

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
#[tracing::instrument(skip(req, res), fields(path = %req.uri().path()))]
pub async fn put(req: &mut Request, res: &mut Response) {
    tracing::info!("Handling PUT request for vCard object");
    
    // Get path before borrowing req mutably
    let path = req.uri().path().to_string();
    
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
    let mut conn = match connection::connect().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::error!(error = %e, "Failed to get database connection");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };
    
    // Check preconditions
    let if_none_match = req.headers()
        .get("If-None-Match")
        .and_then(|h| h.to_str().ok())
        .map(String::from);
    let if_match = req.headers()
        .get("If-Match")
        .and_then(|h| h.to_str().ok())
        .map(String::from);
    
    if if_none_match.is_some() {
        tracing::debug!("If-None-Match header present");
    }
    if if_match.is_some() {
        tracing::debug!("If-Match header present");
    }
    
    // Perform the PUT operation
    match perform_put(&mut conn, &path, &body, if_none_match, if_match).await {
        Ok(PutResult::Created(etag)) => {
            tracing::info!(etag = %etag, "vCard object created");
            res.status_code(StatusCode::CREATED);
            if let Ok(etag_value) = HeaderValue::from_str(&etag) {
                if res.add_header("ETag", etag_value, true).is_err() {
                    tracing::warn!("Failed to add ETag header to response");
                }
            }
        }
        Ok(PutResult::Updated(etag)) => {
            tracing::info!(etag = %etag, "vCard object updated");
            res.status_code(StatusCode::NO_CONTENT);
            if let Ok(etag_value) = HeaderValue::from_str(&etag) {
                if res.add_header("ETag", etag_value, true).is_err() {
                    tracing::warn!("Failed to add ETag header to response");
                }
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
    conn: &mut connection::DbConnection<'_>,
    path: &str,
    body: &[u8],
    if_none_match: Option<String>,
    if_match: Option<String>,
) -> Result<PutResult, PutError> {
    // Parse path to extract collection_id and uri
    // For now, use a placeholder UUID for collection_id
    // TODO: Implement proper path parsing to extract collection_id from the route
    let collection_id = parse_collection_id_from_path(path)?;
    let uri = parse_uri_from_path(path)?;
    
    // Parse vCard to extract UID early for context
    let vcard_str = std::str::from_utf8(body)
        .map_err(|e| PutError::InvalidVcardData(format!("not valid UTF-8: {e}")))?;
    let vcard = crate::component::rfc::vcard::parse::parse_single(vcard_str)
        .map_err(|e| PutError::InvalidVcardData(format!("invalid vCard: {e}")))?;
    let logical_uid = vcard.uid().map(String::from);
    
    // Create PUT context
    let ctx = PutObjectContext {
        collection_id,
        uri,
        entity_type: "addressbook".to_string(),
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
/// Parses the collection ID from the request path.
///
/// ## Errors
/// Returns an error if the path format is invalid.
fn parse_collection_id_from_path(path: &str) -> Result<uuid::Uuid, PutError> {
    // TODO: Implement proper path parsing based on your routing structure
    // Expected path format: /api/carddav/addressbooks/{collection_id}/{resource_name}.vcf
    
    let parts: Vec<&str> = path.split('/').collect();
    if parts.len() < 5 {
        return Err(PutError::InvalidVcardData(
            "path must contain at least 5 segments to extract collection ID (e.g., /api/carddav/addressbooks/{id}/file.vcf)".to_string(),
        ));
    }
    
    // Try to parse the collection_id (assuming it's the 4th segment)
    parts
        .get(4)
        .and_then(|s| uuid::Uuid::parse_str(s).ok())
        .ok_or_else(|| {
            PutError::InvalidVcardData("could not parse collection_id as UUID from path segment 4".to_string())
        })
}

/// ## Summary
/// Parses the resource URI from the request path.
///
/// ## Errors
/// Returns an error if the path format is invalid.
fn parse_uri_from_path(path: &str) -> Result<String, PutError> {
    // TODO: Implement proper URI extraction
    // For now, use the last path segment as the URI
    
    path.split('/')
        .next_back()
        .filter(|s| !s.is_empty())
        .map(String::from)
        .ok_or_else(|| {
            PutError::InvalidVcardData("could not extract resource URI from path (last non-empty segment)".to_string())
        })
}
