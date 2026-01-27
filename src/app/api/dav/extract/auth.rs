//! Authorization helpers for DAV handlers.
//!
//! Provides utility functions for checking authorization in HTTP handlers.

use salvo::Depot;
use salvo::http::StatusCode;

use crate::component::auth::{
    Action, Authorizer, ExpandedSubjects, PathSegment, ResourceId, ResourceType,
    authorizer_from_depot, get_resource_id_from_depot, get_subjects_from_depot,
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
    let subjects = get_subjects_from_depot(depot, conn).await.map_err(|e| {
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
/// Gets the ResourceId from the depot (populated by slug resolver middleware).
///
/// Falls back to constructing a ResourceId from collection_id if not found in depot.
///
/// ## Errors
/// Returns `StatusCode::INTERNAL_SERVER_ERROR` if ResourceId cannot be obtained.
pub fn get_or_build_resource_id(
    depot: &Depot,
    resource_type: ResourceType,
    collection_id: uuid::Uuid,
    uri: Option<&str>,
) -> Result<ResourceId, StatusCode> {
    // Try to get pre-resolved ResourceId from depot first
    if let Ok(resource_id) = get_resource_id_from_depot(depot) {
        return Ok(resource_id.clone());
    }

    // Fallback: build ResourceId using legacy UUID-based approach
    tracing::debug!("ResourceId not in depot, constructing from collection_id");
    Ok(resource_id_for(resource_type, collection_id, uri))
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
        ResourceType::Calendar
    } else if content_type.starts_with("text/vcard") {
        ResourceType::Addressbook
    } else {
        // Default to Calendar for unknown types
        ResourceType::Calendar
    }
}

/// Build a canonical resource identifier from pieces we have in DAV handlers.
///
/// This uses the new path-segment-based `ResourceId` abstraction. We don't yet
/// have owner/collection names at this layer, so we embed the collection UUID
/// as both the owner and collection segment to produce a stable, matchable path.
#[must_use]
pub fn resource_id_for(
    resource_type: ResourceType,
    collection_id: uuid::Uuid,
    uri: Option<&str>,
) -> ResourceId {
    let mut segments = vec![
        PathSegment::ResourceType(resource_type),
        PathSegment::Owner(collection_id.to_string()),
        PathSegment::Collection(collection_id.to_string()),
    ];

    if let Some(uri) = uri {
        segments.push(PathSegment::Item(uri.to_string()));
    } else {
        segments.push(PathSegment::Glob { recursive: true });
    }

    ResourceId::from_segments(segments)
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
