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
    let depot_user = depot
        .get::<DepotUser>("user")
        .map_err(|_e| AppError::NotAuthenticated)?;

    match depot_user {
        DepotUser::User(user) => get_expanded_subjects(conn, user).await,
        DepotUser::Public => Ok(public_subjects()),
    }
}
