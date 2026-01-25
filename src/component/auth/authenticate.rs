use diesel::{
    ExpressionMethods, OptionalExtension, SelectableHelper,
    query_dsl::methods::{FilterDsl, SelectDsl},
};

use crate::component::{
    config::{AuthMethod, get_config},
    db::{connection::connect, schema},
    error::{Error, Result},
    model::principal::{NewPrincipal, PrincipalType},
    model::user::{NewUser, User},
};

/// Get the user configured in settings for single user authentication.
///
/// If it doesn't exist, insert it into the database.
///
/// ## Errors
///
/// Returns an error if the user cannot be created or retrieved from the database.
#[tracing::instrument]
async fn authenticate_single_user() -> Result<User> {
    tracing::debug!("Authenticating single user");

    use diesel_async::RunQueryDsl;

    let config = get_config();
    let single_user_config =
        config
            .auth
            .single_user
            .as_ref()
            .ok_or(Error::InvalidConfiguration(
                "Single user config is missing".to_string(),
            ))?;

    let mut conn = connect().await?;

    // Check if the user already exists
    if let Some(user) = schema::user::table
        .filter(schema::user::email.eq(&single_user_config.email))
        .select(User::as_select())
        .first::<User>(&mut conn)
        .await
        .optional()?
    {
        tracing::debug!(user_email = %user.email, "Single user already exists");
        return Ok(user);
    }

    tracing::debug!(email = %single_user_config.email, "Creating single user");

    // If not, create the user
    let principal_id = uuid::Uuid::now_v7();
    let principal_uri = format!("/principals/users/{principal_id}");

    let new_principal = NewPrincipal {
        id: principal_id,
        principal_type: PrincipalType::User.as_str(),
        uri: principal_uri.as_str(),
        display_name: Some(single_user_config.name.as_str()),
    };

    let _principal_row_count = diesel::insert_into(schema::principal::table)
        .values(&new_principal)
        .execute(&mut conn)
        .await?;

    let new_user = NewUser {
        name: single_user_config.name.as_str(),
        email: single_user_config.email.as_str(),
        principal_id,
    };

    let user = diesel::insert_into(schema::user::table)
        .values(&new_user)
        .returning(User::as_select())
        .get_result::<User>(&mut conn)
        .await?;

    tracing::info!(user_id = %user.id, user_email = %user.email, "Single user created");

    Ok(user)
}

#[expect(clippy::unused_async)]
async fn authenticate_proxy(req: &salvo::Request) -> Result<User> {
    let _ = req;
    todo!("Implement configuration for proxy authentication")
}

/// ## Summary
/// Authenticate a user based on the configured authentication method.
///
/// ## Errors
/// Returns an error if authentication fails.
#[tracing::instrument(skip(req))]
pub async fn authenticate(req: &salvo::Request) -> Result<User> {
    let config = get_config();

    tracing::trace!(auth_method = ?config.auth.method, "Authenticating request");

    match config.auth.method {
        AuthMethod::SingleUser => authenticate_single_user().await,
        AuthMethod::Proxy => authenticate_proxy(req).await,
    }
}
