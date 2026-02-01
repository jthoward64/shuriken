use diesel::{
    ExpressionMethods, OptionalExtension, SelectableHelper,
    query_dsl::methods::{FilterDsl, SelectDsl},
};

use crate::error::{ServiceError, ServiceResult};
use shuriken_core::config::AuthMethod;
use shuriken_db::{
    db::{connection::DbConnection, schema},
    model::{
        principal::{NewPrincipal, PrincipalType},
        user::{NewUser, User, authuser::AuthUser},
    },
};

/// Get the user configured in settings for single user authentication.
///
/// If it doesn't exist, insert it into the database.
///
/// ## Errors
///
/// Returns an error if the user cannot be created or retrieved from the database.
#[tracing::instrument(skip(conn, config))]
async fn authenticate_single_user(
    conn: &mut DbConnection<'_>,
    config: &shuriken_core::config::Settings,
) -> ServiceResult<User> {
    tracing::debug!("Authenticating single user");

    use diesel_async::RunQueryDsl;

    let single_user_config =
        config
            .auth
            .single_user
            .as_ref()
            .ok_or(ServiceError::InvalidConfiguration(
                "Single user config is missing".to_string(),
            ))?;
    let single_user_name = single_user_config.name.clone();
    let single_user_email = single_user_config.email.clone();

    // Check if the user already exists
    if let Some(user) = schema::user::table
        .filter(schema::user::email.eq(&single_user_email))
        .select(User::as_select())
        .first::<User>(conn)
        .await
        .optional()?
    {
        tracing::debug!(user_email = %user.email, "Single user already exists");
        return Ok(user);
    }

    tracing::debug!(email = %single_user_email, "Creating single user");
    create_single_user(conn, &single_user_name, &single_user_email).await
}

/// ## Summary
/// Creates the configured single user and principal.
///
/// ## Side Effects
/// - Inserts a principal row
/// - Inserts a user row
///
/// ## Errors
/// Returns an error if database inserts fail.
async fn create_single_user(
    conn: &mut DbConnection<'_>,
    name: &str,
    email: &str,
) -> ServiceResult<User> {
    use diesel_async::RunQueryDsl;

    let principal_id = uuid::Uuid::now_v7();
    let principal_slug = shuriken_core::util::slug::generate_slug(email);

    let new_principal = NewPrincipal {
        id: principal_id,
        principal_type: PrincipalType::User,
        slug: principal_slug.as_str(),
        display_name: Some(name),
    };

    let _principal_row_count = diesel::insert_into(schema::principal::table)
        .values(&new_principal)
        .execute(conn)
        .await?;

    let new_user = NewUser {
        name,
        email,
        principal_id,
    };

    let user = diesel::insert_into(schema::user::table)
        .values(&new_user)
        .returning(User::as_select())
        .get_result::<User>(conn)
        .await?;

    tracing::info!(user_id = %user.id, user_email = %user.email, "Single user created");

    Ok(user)
}

#[expect(clippy::unused_async)]
async fn authenticate_proxy(
    _req: &salvo::Request,
    _config: &shuriken_core::config::Settings,
) -> ServiceResult<User> {
    Err(ServiceError::InvalidConfiguration(
        "Proxy authentication is not configured".to_string(),
    ))
}

/// ## Summary
/// Authenticate a user via HTTP Basic Authentication.
///
/// Extracts credentials from the Authorization header, looks up the user by email,
/// and verifies the password against the stored Argon2 hash in the `auth_user` table.
///
/// ## Errors
/// Returns an error if:
/// - Authorization header is missing or malformed
/// - User is not found
/// - Password verification fails
/// - Database query fails
#[tracing::instrument(skip(req, conn))]
async fn authenticate_basic_auth(
    req: &salvo::Request,
    conn: &mut DbConnection<'_>,
) -> ServiceResult<User> {
    use base64::Engine;
    use diesel_async::RunQueryDsl;
    use salvo::http::header::AUTHORIZATION;

    tracing::trace!("Attempting basic authentication");

    // Extract Basic Auth credentials from Authorization header
    let auth_header = req
        .headers()
        .get(AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .ok_or(ServiceError::NotAuthenticated)?;

    if !auth_header.starts_with("Basic ") {
        return Err(ServiceError::NotAuthenticated);
    }

    let credentials = auth_header
        .strip_prefix("Basic ")
        .ok_or(ServiceError::NotAuthenticated)?;

    let decoded = base64::prelude::BASE64_STANDARD
        .decode(credentials)
        .map_err(|err| {
            tracing::trace!("Failed to decode Basic Auth credentials: {}", err);
            ServiceError::NotAuthenticated
        })?;

    let credentials_str = String::from_utf8(decoded).map_err(|err| {
        tracing::trace!("Failed to decode Basic Auth credentials: {}", err);
        ServiceError::NotAuthenticated
    })?;

    let (email, password) = credentials_str
        .split_once(':')
        .ok_or(ServiceError::NotAuthenticated)?;

    tracing::debug!(email = %email, "Extracted credentials from Basic Auth header");

    // Look up user by email
    let user = schema::user::table
        .filter(schema::user::email.eq(email))
        .select(User::as_select())
        .first::<User>(conn)
        .await
        .optional()?
        .ok_or(ServiceError::NotAuthenticated)?;

    tracing::debug!(user_id = %user.id, user_email = %user.email, "User found for Basic Auth");

    // Look up auth_user entry with source "password"
    let auth_user = schema::auth_user::table
        .filter(schema::auth_user::user_id.eq(user.id))
        .filter(schema::auth_user::auth_source.eq("password"))
        .select(AuthUser::as_select())
        .first::<AuthUser>(conn)
        .await
        .optional()?
        .ok_or_else(|| {
            tracing::warn!(user_id = %user.id, user_email = %user.email, "No auth_user entry found for Basic Auth");
            ServiceError::NotAuthenticated
        })?;

    tracing::debug!(user_id = %user.id, "Found auth_user entry for Basic Auth");

    // Verify password (auth_credential contains the Argon2 hash)
    let password_hash = auth_user
        .auth_credential
        .as_ref()
        .ok_or(ServiceError::NotAuthenticated)?;

    crate::auth::password::verify_password(password, password_hash)?;

    tracing::info!(user_id = %user.id, user_email = %user.email, "User authenticated via basic auth");

    Ok(user)
}

/// ## Summary
/// Authenticate a user based on the configured authentication method.
///
/// ## Errors
/// Returns an error if authentication fails.
#[tracing::instrument(skip(req, conn, config))]
pub async fn authenticate(
    req: &salvo::Request,
    conn: &mut DbConnection<'_>,
    config: &shuriken_core::config::Settings,
) -> ServiceResult<User> {
    tracing::trace!(auth_method = ?config.auth.method, "Authenticating request");

    match config.auth.method {
        AuthMethod::SingleUser => authenticate_single_user(conn, config).await,
        AuthMethod::BasicAuth => authenticate_basic_auth(req, conn).await,
        AuthMethod::Proxy => authenticate_proxy(req, config).await,
    }
}
