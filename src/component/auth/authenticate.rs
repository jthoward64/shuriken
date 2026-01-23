use diesel::{
    ExpressionMethods, OptionalExtension, SelectableHelper,
    query_dsl::methods::{FilterDsl, SelectDsl},
};

use crate::component::{
    config::{AuthMethod, get_config},
    db::{connection::connect, schema},
    error::{Error, Result},
    model::user::{NewUser, User},
};

/// Get the user configured in settings for single user authentication.
///
/// If it doesn't exist, insert it into the database.
///
/// ## Errors
///
/// Returns an error if the user cannot be created or retrieved from the database.
async fn authenticate_single_user() -> Result<User> {
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
        return Ok(user);
    }

    // If not, create the user
    let new_user = NewUser {
        name: single_user_config.name.as_str(),
        email: single_user_config.email.as_str(),
    };

    let user = diesel::insert_into(schema::user::table)
        .values(&new_user)
        .returning(User::as_select())
        .get_result::<User>(&mut conn)
        .await?;

    Ok(user)
}

#[expect(unused)]
async fn authenticate_proxy(req: &salvo::Request) -> Result<User> {
    use diesel_async::RunQueryDsl;

    todo!("Implement configuration for proxy authentication");

    // Extract user information from request headers
    let name = req
        .headers()
        .get("X-User-Name")
        .and_then(|v| v.to_str().ok())
        .ok_or(Error::AuthenticationError(
            "Missing X-User-Name header".to_string(),
        ))?;

    let email = req
        .headers()
        .get("X-User-Email")
        .and_then(|v| v.to_str().ok())
        .ok_or(Error::AuthenticationError(
            "Missing X-User-Email header".to_string(),
        ))?;

    let mut conn = connect().await?;

    // Check if the user already exists
    if let Some(user) = schema::user::table
        .filter(schema::user::email.eq(email))
        .select(User::as_select())
        .first::<User>(&mut conn)
        .await
        .optional()?
    {
        return Ok(user);
    }

    // If not, create the user
    let new_user = NewUser { name, email };

    let user = diesel::insert_into(schema::user::table)
        .values(&new_user)
        .returning(User::as_select())
        .get_result::<User>(&mut conn)
        .await?;

    Ok(user)
}

/// ## Summary
/// Authenticate a user based on the configured authentication method.
///
/// ## Errors
/// Returns an error if authentication fails.
pub async fn authenticate(req: &salvo::Request) -> Result<User> {
    let config = get_config();

    match config.auth.method {
        AuthMethod::SingleUser => authenticate_single_user().await,
        AuthMethod::Proxy => authenticate_proxy(req).await,
    }
}
