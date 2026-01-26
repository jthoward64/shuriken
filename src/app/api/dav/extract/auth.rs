//! Authorization helpers for DAV handlers.
//!
//! Provides utility functions for checking authorization in HTTP handlers.

use salvo::Depot;
use salvo::http::StatusCode;

use crate::component::auth::{
    Action, Authorizer, ResourceId, ResourceType, ExpandedSubjects, authorizer_from_depot,
    get_subjects_from_depot,
};
use crate::component::db::connection::DbConnection;
use crate::component::db::query::dav::instance;
use crate::component::error::AppError;
use crate::component::model::dav::instance::DavInstance;

/// ## Summary
/// Gets authorization context (subjects and authorizer) from the depot.
///
/// ## Errors
/// Returns `StatusCode::INTERNAL_SERVER_ERROR` if subjects or authorizer cannot be retrieved.
pub async fn get_auth_context(
    depot: &Depot,
    conn: &mut DbConnection<'_>,
) -> Result<(ExpandedSubjects, Authorizer), StatusCode> {
    let subjects = get_subjects_from_depot(depot, conn)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Failed to get subjects from depot");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let authorizer = authorizer_from_depot(depot).map_err(|e| {
        tracing::error!(error = %e, "Failed to get authorizer");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok((subjects, authorizer))
}

/// ## Summary
/// Loads an instance and determines its resource type.
///
/// ## Errors
/// Returns `StatusCode::INTERNAL_SERVER_ERROR` for database errors.
pub async fn load_instance_resource(
    conn: &mut DbConnection<'_>,
    collection_id: uuid::Uuid,
    uri: &str,
) -> Result<Option<(DavInstance, ResourceType)>, StatusCode> {
    use diesel::prelude::*;
    use diesel_async::RunQueryDsl;

    let instance_row: Option<DavInstance> = instance::by_collection_and_uri(collection_id, uri)
        .select(DavInstance::as_select())
        .first::<DavInstance>(conn)
        .await
        .optional()
        .map_err(|e| {
            tracing::error!(error = %e, "Failed to load instance for authorization");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(instance_row.map(|inst| {
        let resource_type = resource_type_from_content_type(&inst.content_type);
        (inst, resource_type)
    }))
}

/// ## Summary
/// Determines resource type from content-type header.
#[must_use]
pub fn resource_type_from_content_type(content_type: &str) -> ResourceType {
    if content_type.starts_with("text/calendar") {
        ResourceType::CalendarEvent
    } else if content_type.starts_with("text/vcard") {
        ResourceType::Vcard
    } else {
        // Default to CalendarEvent for unknown types
        ResourceType::CalendarEvent
    }
}

/// ## Summary
/// Checks authorization and returns an appropriate HTTP status on denial.
///
/// ## Errors
/// Returns `StatusCode::FORBIDDEN` if denied.
/// Returns `StatusCode::INTERNAL_SERVER_ERROR` for evaluation errors.
pub fn check_authorization(
    authorizer: &Authorizer,
    subjects: &ExpandedSubjects,
    resource: &ResourceId,
    action: Action,
    operation_name: &str,
) -> Result<(), StatusCode> {
    match authorizer.require(subjects, resource, action) {
        Ok(_level) => Ok(()),
        Err(AppError::AuthorizationError(msg)) => {
            tracing::warn!(
                resource = %resource,
                reason = %msg,
                "Authorization denied for {}", operation_name
            );
            Err(StatusCode::FORBIDDEN)
        }
        Err(e) => {
            tracing::error!(error = %e, "Authorization check failed");
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}
