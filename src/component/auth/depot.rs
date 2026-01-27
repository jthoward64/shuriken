//! Depot helpers for extracting authorization context from Salvo requests.
//!
//! This module provides functions to extract the authenticated user and build
//! `ExpandedSubjects` for authorization checks.

use diesel::prelude::*;
use diesel_async::RunQueryDsl;

use crate::component::{
    db::{connection::DbConnection, schema},
    error::{AppError, AppResult},
    middleware::auth::DepotUser,
    model::group::Group,
};

use super::subject::ExpandedSubjects;

/// Get the authenticated user from the depot.
///
/// ## Errors
///
/// Returns `NotAuthenticated` if no user is found in the depot or if the user is public.
pub fn get_user_from_depot(
    depot: &salvo::Depot,
) -> AppResult<&crate::component::model::user::User> {
    let depot_user = depot
        .get::<DepotUser>("user")
        .map_err(|_e| AppError::NotAuthenticated)?;

    match depot_user {
        DepotUser::User(user) => Ok(user),
        DepotUser::Public => Err(AppError::NotAuthenticated),
    }
}

/// Check if the request is from an authenticated user (not public).
#[must_use]
pub fn is_authenticated(depot: &salvo::Depot) -> bool {
    depot
        .get::<DepotUser>("user")
        .is_ok_and(|u| matches!(u, DepotUser::User(_)))
}

/// Get expanded subjects for public access only.
///
/// Use this when the user is not authenticated but you still want to check
/// if public access is allowed.
#[must_use]
pub fn public_subjects() -> ExpandedSubjects {
    ExpandedSubjects::public_only()
}

/// Get expanded subjects for the authenticated user including group memberships.
///
/// This queries the database for the user's group memberships and builds
/// an `ExpandedSubjects` set containing:
/// - The user's principal
/// - All group principals the user belongs to
/// - The public pseudo-principal
///
/// ## Errors
///
/// Returns database errors if the membership query fails.
pub async fn get_expanded_subjects(
    conn: &mut DbConnection<'_>,
    user: &crate::component::model::user::User,
) -> AppResult<ExpandedSubjects> {
    // Query for group memberships via join
    let group_principal_ids: Vec<uuid::Uuid> = schema::membership::table
        .inner_join(schema::group::table.on(schema::membership::group_id.eq(schema::group::id)))
        .filter(schema::membership::user_id.eq(user.id))
        .select(Group::as_select())
        .load::<Group>(conn)
        .await?
        .into_iter()
        .map(|g| g.principal_id)
        .collect();

    tracing::trace!(
        user_id = %user.id,
        group_count = group_principal_ids.len(),
        "Expanded user subjects"
    );

    Ok(ExpandedSubjects::from_user_with_groups(
        user,
        group_principal_ids,
    ))
}

/// Get expanded subjects from the depot, handling both authenticated and public cases.
///
/// If the user is authenticated, queries for group memberships and returns the full
/// expanded subject set. If the user is public, returns only the public pseudo-principal.
///
/// ## Errors
///
/// Returns database errors if the membership query fails.
pub async fn get_subjects_from_depot(
    depot: &salvo::Depot,
    conn: &mut DbConnection<'_>,
) -> AppResult<ExpandedSubjects> {
    let depot_user = depot.get::<DepotUser>("user");

    match depot_user {
        Ok(DepotUser::User(user)) => get_expanded_subjects(conn, user).await,
        Ok(DepotUser::Public) => Ok(public_subjects()),
        Err(_missing) => {
            tracing::warn!("Depot missing user context; defaulting to public subjects");
            Ok(public_subjects())
        }
    }
}

/// Get the resolved ResourceId from the depot.
///
/// The slug resolver middleware should populate this when it resolves the request path.
///
/// ## Errors
///
/// Returns an error if no ResourceId is found in the depot.
pub fn get_resource_id_from_depot(depot: &salvo::Depot) -> AppResult<&super::ResourceId> {
    depot
        .get::<super::ResourceId>(
            crate::component::middleware::slug_resolver::depot_keys::RESOURCE_ID,
        )
        .map_err(|_| {
            AppError::NotFound(
                "ResourceId not found in depot - slug resolver may not have run".to_string(),
            )
        })
}

/// Get the resolved owner `Principal` from the depot.
///
/// ## Errors
/// Returns `NotFound` if the principal is not present.
pub fn get_owner_principal_from_depot(
    depot: &salvo::Depot,
) -> AppResult<&crate::component::model::principal::Principal> {
    depot
        .get::<crate::component::model::principal::Principal>(
            crate::component::middleware::slug_resolver::depot_keys::OWNER_PRINCIPAL,
        )
        .map_err(|_| AppError::NotFound("Owner principal not found in depot".to_string()))
}

/// Get the precedence-ordered collection chain from the depot.
/// Deepest collection first, then parents up to root.
///
/// ## Errors
/// Returns `NotFound` if the collection chain is not present.
pub fn get_collection_chain_from_depot(
    depot: &salvo::Depot,
) -> AppResult<&Vec<crate::component::model::dav::collection::DavCollection>> {
    depot
        .get::<Vec<crate::component::model::dav::collection::DavCollection>>(
            crate::component::middleware::slug_resolver::depot_keys::COLLECTION,
        )
        .map_err(|_| AppError::NotFound("Collection chain not found in depot".to_string()))
}

/// Get the final resolved collection id from the depot.
///
/// ## Errors
/// Returns `NotFound` if the id is not present.
pub fn get_parsed_collection_id_from_depot(depot: &salvo::Depot) -> AppResult<uuid::Uuid> {
    depot
        .get::<uuid::Uuid>(
            crate::component::middleware::slug_resolver::depot_keys::PARSED_COLLECTION_ID,
        )
        .map(|id| *id)
        .map_err(|_| AppError::NotFound("Collection id not found in depot".to_string()))
}

/// Get the parsed instance slug from the depot if present.
///
/// ## Errors
/// Returns `NotFound` if the slug is not present.
pub fn get_parsed_instance_slug_from_depot(depot: &salvo::Depot) -> AppResult<String> {
    depot
        .get::<String>(
            crate::component::middleware::slug_resolver::depot_keys::PARSED_INSTANCE_SLUG,
        )
        .map(|s| s.clone())
        .map_err(|_| AppError::NotFound("Instance slug not found in depot".to_string()))
}

/// Get the resolved instance from the depot if present.
#[must_use]
pub fn get_instance_from_depot(
    depot: &salvo::Depot,
) -> Option<&crate::component::model::dav::instance::DavInstance> {
    depot
        .get::<crate::component::model::dav::instance::DavInstance>(
            crate::component::middleware::slug_resolver::depot_keys::INSTANCE,
        )
        .ok()
}
