//! Authorization helpers for DAV handlers.
//!
//! Provides utility functions for checking authorization in HTTP handlers.

use salvo::Depot;
use salvo::http::StatusCode;

use shuriken_db::db::connection::DbConnection;
use shuriken_db::db::query::dav::instance;
use shuriken_db::model::dav::instance::DavInstance;
use shuriken_service::auth::{
    Action, Authorizer, ExpandedSubjects, ResourceLocation, ResourceType, authorizer_from_depot,
    get_subjects_from_depot,
};

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
/// Loads an instance and determines its resource type.
///
/// ## Deprecated
/// This function is no longer used. Handlers should retrieve `ResourceId` from depot
/// populated by the `slug_resolver` middleware. Kept for reference only.
///
/// ## Errors
/// Returns `StatusCode::INTERNAL_SERVER_ERROR` for database errors.
#[expect(
    dead_code,
    reason = "Deprecated in favor of depot-based resource resolution"
)]
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
        let resource_type = resource_type_from_content_type(inst.content_type);
        (inst, resource_type)
    }))
}

/// ## Summary
/// Determines resource type from content-type.
#[must_use]
pub fn resource_type_from_content_type(
    content_type: shuriken_db::db::enums::ContentType,
) -> ResourceType {
    use shuriken_db::db::enums::ContentType;
    match content_type {
        ContentType::TextCalendar => ResourceType::Calendar,
        ContentType::TextVCard => ResourceType::Addressbook,
    }
}

// Replace with ResouceLocation:
// /// Build a canonical resource identifier from pieces we have in DAV handlers.
// ///
// /// This uses the new path-segment-based `ResourceId` abstraction. We don't yet
// /// have owner/collection names at this layer, so we embed the collection UUID
// /// as both the owner and collection segment to produce a stable, matchable path.
// #[must_use]
// pub fn resource_id_for(
//     resource_type: ResourceType,
//     collection_id: uuid::Uuid,
//     uri: Option<&str>,
// ) -> ResourceLocation {
//     let mut segments = vec![
//         PathSegment::ResourceType(resource_type),
//         PathSegment::Owner(collection_id.to_string()),
//         PathSegment::Collection(collection_id.to_string()),
//     ];

//     if let Some(uri) = uri {
//         segments.push(PathSegment::Item(uri.to_string()));
//     } else {
//         segments.push(PathSegment::Glob { recursive: true });
//     }

//     ResourceLocation::from_segments(segments)
// }

/// ## Summary
/// Checks authorization and returns an appropriate HTTP status on denial.
///
/// ## Errors
/// Returns `StatusCode::FORBIDDEN` with resource context if denied.
/// Returns `StatusCode::INTERNAL_SERVER_ERROR` for evaluation errors.
pub fn check_authorization(
    authorizer: &Authorizer,
    subjects: &ExpandedSubjects,
    resource: &ResourceLocation,
    action: Action,
    operation_name: &str,
) -> Result<(), (StatusCode, ResourceLocation, Action)> {
    match authorizer.require(subjects, resource, action) {
        Ok(_level) => Ok(()),
        Err(shuriken_service::error::ServiceError::AuthorizationError(msg)) => {
            tracing::warn!(
                resource = %resource,
                reason = %msg,
                "Authorization denied for {}", operation_name
            );
            Err((StatusCode::FORBIDDEN, resource.clone(), action))
        }
        Err(e) => {
            tracing::error!(error = %e, "Authorization check failed");
            Err((StatusCode::INTERNAL_SERVER_ERROR, resource.clone(), action))
        }
    }
}
