use diesel::{
    ExpressionMethods, OptionalExtension, SelectableHelper,
    query_dsl::methods::{FilterDsl, SelectDsl},
};
use diesel_async::AsyncConnection;
use diesel_async::scoped_futures::ScopedFutureExt;

use crate::component::{
    config::{AuthMethod, get_config_from_depot},
    db::{
        connection::{DbConnection, get_db_from_depot},
        schema,
    },
    error::{AppError, AppResult},
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
async fn authenticate_single_user(depot: &salvo::Depot) -> AppResult<User> {
    tracing::debug!("Authenticating single user");

    use diesel_async::RunQueryDsl;

    let config = get_config_from_depot(depot)?;
    let single_user_config =
        config
            .auth
            .single_user
            .as_ref()
            .ok_or(AppError::InvalidConfiguration(
                "Single user config is missing".to_string(),
            ))?;

    let provider = get_db_from_depot(depot)?;
    let mut conn = provider.get_connection().await?;
    let single_user_name = single_user_config.name.clone();
    let single_user_email = single_user_config.email.clone();

    conn.transaction::<_, AppError, _>(move |tx| {
        let single_user_name = single_user_name.clone();
        let single_user_email = single_user_email.clone();

        async move {
            // Check if the user already exists
            if let Some(user) = schema::user::table
                .filter(schema::user::email.eq(&single_user_email))
                .select(User::as_select())
                .first::<User>(tx)
                .await
                .optional()?
            {
                tracing::debug!(user_email = %user.email, "Single user already exists");
                return Ok(user);
            }

            tracing::debug!(email = %single_user_email, "Creating single user");
            create_single_user(tx, &single_user_name, &single_user_email).await
        }
        .scope_boxed()
    })
    .await
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
) -> AppResult<User> {
    use diesel_async::RunQueryDsl;

    let principal_id = uuid::Uuid::now_v7();
    let principal_slug = crate::util::slug::generate_slug(email);

    let new_principal = NewPrincipal {
        id: principal_id,
        principal_type: PrincipalType::User.as_str(),
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
async fn authenticate_proxy(req: &salvo::Request) -> AppResult<User> {
    let _ = req;

    Err(AppError::InvalidConfiguration(
        "Proxy authentication is not configured".to_string(),
    ))
}

/// ## Summary
/// Authenticate a user based on the configured authentication method.
///
/// ## Errors
/// Returns an error if authentication fails.
#[tracing::instrument(skip(req))]
pub async fn authenticate(req: &salvo::Request, depot: &salvo::Depot) -> AppResult<User> {
    let config = get_config_from_depot(depot)?;

    tracing::trace!(auth_method = ?config.auth.method, "Authenticating request");

    match config.auth.method {
        AuthMethod::SingleUser => authenticate_single_user(depot).await,
        AuthMethod::Proxy => authenticate_proxy(req).await,
    }
}
