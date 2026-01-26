//! PUT method handler for `CalDAV` calendar objects.

mod types;

use salvo::http::{HeaderValue, StatusCode};
use salvo::{Depot, Request, Response, handler};

use crate::component::auth::{
    Action, ResourceId, ResourceType, authorizer_from_depot, get_subjects_from_depot,
};
use crate::component::caldav::service::object::{PutObjectContext, put_calendar_object};
use crate::component::db::connection;
use crate::component::db::query::dav::instance;
use crate::component::error::AppError;
use crate::component::model::dav::instance::DavInstance;
use crate::util::path;

use types::{PutError, PutResult};

/// ## Summary
/// Handles PUT requests for calendar objects (`.ics` files).
///
/// Parses the iCalendar request body, validates it, checks preconditions
/// (`If-Match`, `If-None-Match`), stores the entity/instance in the database,
/// and generates an `ETag`.
///
/// ## Side Effects
/// - Parses iCalendar data
/// - Creates or updates database entity and instance
/// - Bumps collection sync token
/// - Returns 201 Created or 204 No Content
///
/// ## Errors
/// Returns 400 for invalid data, 412 for precondition failures, 500 for server errors.
#[handler]
#[tracing::instrument(skip(req, res), fields(path = %req.uri().path()))]
pub async fn put(req: &mut Request, res: &mut Response, depot: &Depot) {
    tracing::info!("Handling PUT request for calendar object");

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

    if let Ok(collection_id) = path::extract_collection_id(&path)
        && collection_id.is_nil()
    {
        res.status_code(StatusCode::NOT_FOUND);
        return;
    }

    // Get database connection
    let provider = match connection::get_db_from_depot(depot) {
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
    if let Err(status) = check_put_authorization(depot, &mut conn, &path).await {
        res.status_code(status);
        return;
    }

    // Perform the PUT operation
    match perform_put(&mut conn, &path, &body, if_none_match, if_match).await {
        Ok(PutResult::Created(etag)) => {
            tracing::info!(etag = %etag, "Calendar object created");
            res.status_code(StatusCode::CREATED);
            if let Ok(etag_value) = HeaderValue::from_str(&etag)
                && res.add_header("ETag", etag_value, true).is_err()
            {
                tracing::warn!("Failed to add ETag header to response");
            }
        }
        Ok(PutResult::Updated(etag)) => {
            tracing::info!(etag = %etag, "Calendar object updated");
            res.status_code(StatusCode::NO_CONTENT);
            if let Ok(etag_value) = HeaderValue::from_str(&etag)
                && res.add_header("ETag", etag_value, true).is_err()
            {
                tracing::warn!("Failed to add ETag header to response");
            }
        }
        Ok(PutResult::PreconditionFailed) => {
            tracing::warn!("Precondition failed for PUT request");
            res.status_code(StatusCode::PRECONDITION_FAILED);
        }
        Err(PutError::InvalidCalendarData(msg)) => {
            tracing::error!(message = %msg, "Invalid calendar data");
            res.status_code(StatusCode::BAD_REQUEST);
            // TODO: Return proper CalDAV error XML with valid-calendar-data precondition
        }
        Err(PutError::UidConflict(uid)) => {
            tracing::error!(uid = %uid, "UID conflict");
            res.status_code(StatusCode::CONFLICT);
            // TODO: Return proper CalDAV error XML with no-uid-conflict precondition
        }
        Err(PutError::DatabaseError(e)) => {
            tracing::error!(error = %e, "Database error");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
        }
    }
}

/// ## Summary
/// Performs the PUT operation for a calendar object.
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
    let (collection_id, uri) = path::parse_collection_and_uri(path)
        .map_err(|e| PutError::InvalidCalendarData(format!("Invalid path: {e}")))?;

    // Parse iCalendar to extract UID early for context
    let ical_str = std::str::from_utf8(body)
        .map_err(|e| PutError::InvalidCalendarData(format!("not valid UTF-8: {e}")))?;
    let ical = crate::component::rfc::ical::parse::parse(ical_str)
        .map_err(|e| PutError::InvalidCalendarData(format!("invalid iCalendar: {e}")))?;
    let logical_uid = ical.root.uid().map(String::from);

    // Create PUT context
    let ctx = PutObjectContext {
        collection_id,
        uri,
        entity_type: "calendar".to_string(),
        logical_uid,
        if_none_match,
        if_match,
    };

    // Call the service layer
    match put_calendar_object(conn, &ctx, body).await {
        Ok(result) => {
            if result.created {
                Ok(PutResult::Created(result.etag))
            } else {
                Ok(PutResult::Updated(result.etag))
            }
        }
        Err(e) => {
            let err_msg = e.to_string();
            if err_msg.contains("invalid iCalendar") || err_msg.contains("not valid UTF-8") {
                Err(PutError::InvalidCalendarData(err_msg))
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
/// For updates: checks Write permission on the existing `CalendarEvent` resource.
/// For creates: checks Write permission on the Calendar collection.
///
/// ## Errors
/// Returns `StatusCode::FORBIDDEN` if authorization is denied.
/// Returns `StatusCode::INTERNAL_SERVER_ERROR` for database or auth errors.
async fn check_put_authorization(
    depot: &Depot,
    conn: &mut connection::DbConnection<'_>,
    path: &str,
) -> Result<(), StatusCode> {
    use diesel::prelude::*;
    use diesel_async::RunQueryDsl;

    // Parse path to extract collection_id and uri
    let (collection_id, uri) = match path::parse_collection_and_uri(path) {
        Ok(parsed) => parsed,
        Err(e) => {
            tracing::debug!(error = %e, path = %path, "Failed to parse path for authorization");
            // Let the main handler deal with path parsing errors
            return Ok(());
        }
    };

    // Get expanded subjects for the current user
    let subjects = get_subjects_from_depot(depot, conn).await.map_err(|e| {
        tracing::error!(error = %e, "Failed to get subjects from depot");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Try to load existing instance to determine if this is create or update
    let existing: Option<DavInstance> = instance::by_collection_and_uri(collection_id, &uri)
        .select(DavInstance::as_select())
        .first::<DavInstance>(conn)
        .await
        .optional()
        .map_err(|e| {
            tracing::error!(error = %e, "Failed to check existing instance for authorization");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let resource = if let Some(inst) = existing {
        // Update: check permission on the entity
        ResourceId::new(ResourceType::CalendarEvent, inst.entity_id)
    } else {
        // Create: check permission on the collection
        ResourceId::new(ResourceType::Calendar, collection_id)
    };

    // Get the authorizer
    let authorizer = authorizer_from_depot(depot).map_err(|e| {
        tracing::error!(error = %e, "Failed to get authorizer");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Check write permission
    match authorizer.require(&subjects, &resource, Action::Write) {
        Ok(_level) => Ok(()),
        Err(AppError::AuthorizationError(msg)) => {
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
