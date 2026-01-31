use salvo::{Depot, Request, Response, Router, handler, http::StatusCode, writing::Json};
use serde::{Deserialize, Serialize};
use tracing::error;

use crate::db_handler::get_db_from_depot;
use shuriken_db::dav_types::DepotUser;
use shuriken_service::auth::{
    PathSegment, action::Action, authorize::handler_require, depot::depot_keys,
    resource::ResourceLocation, subject::ExpandedSubjects,
};

/// ## Summary
/// Error response payload
#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
}

/// ## Summary
/// Create user request payload
#[derive(Debug, Deserialize)]
pub struct CreateUserRequest {
    pub name: String,
    pub email: String,
    pub password: String,
}

/// ## Summary
/// Update password request payload
#[derive(Debug, Deserialize)]
pub struct UpdatePasswordRequest {
    pub password: String,
}

/// ## Summary
/// User response payload
#[derive(Debug, Serialize)]
pub struct UserResponse {
    pub user_id: String,
    pub principal_id: String,
    pub email: String,
    pub name: String,
}

/// ## Summary
/// POST /app/users - Create a new user (requires write access to /principals/)
///
/// This endpoint is only accessible to authenticated users with write permissions
/// to the `/principals/` path. Typically this would be administrators.
///
/// ## Side Effects
/// - Creates a principal row
/// - Creates a user row
/// - Creates an `auth_user` row with hashed password
///
/// ## Errors
/// Returns HTTP 401 if not authenticated
/// Returns HTTP 403 if user lacks write access to /principals/
/// Returns HTTP 400 if the email is already registered
/// Returns HTTP 500 if database operations fail
#[handler]
async fn create_user_handler(req: &mut Request, depot: &mut Depot, res: &mut Response) {
    use diesel::{ExpressionMethods, OptionalExtension, QueryDsl, SelectableHelper};
    use diesel_async::RunQueryDsl;
    use shuriken_db::{
        db::schema,
        model::{
            principal::{NewPrincipal, PrincipalType},
            user::{NewUser, User, authuser::NewAuthUser},
        },
    };

    tracing::debug!("Processing create user request");

    // Get authenticated user from depot
    let Ok(DepotUser::User(authenticated_user)) =
        depot.get::<DepotUser>(depot_keys::AUTHENTICATED_PRINCIPAL)
    else {
        res.status_code(StatusCode::UNAUTHORIZED);
        res.render(Json(ErrorResponse {
            error: "Authentication required".to_string(),
        }));
        return;
    };

    // Check if user has write access to /principals/
    let subjects = ExpandedSubjects::from_user(authenticated_user);

    // For creating users, check if the authenticated user has admin/write access
    // We use a calendars path with glob to check general admin permissions
    let principals_resource = ResourceLocation::from_segments(vec![PathSegment::ResourceType(
        shuriken_service::auth::ResourceType::Principal,
    )]).expect("Valid resource location");

    if let Err(_e) = handler_require(depot, &subjects, &principals_resource, Action::Admin) {
        tracing::warn!(
            user_email = %authenticated_user.email,
            "User attempted to create user without write access to /principals/"
        );
        res.status_code(StatusCode::FORBIDDEN);
        res.render(Json(ErrorResponse {
            error: "Insufficient permissions to create users".to_string(),
        }));
        return;
    }

    // Extract JSON body
    let create_req: CreateUserRequest = match req.parse_json().await {
        Ok(r) => r,
        Err(e) => {
            error!(error = ?e, "Failed to parse create user request");
            res.status_code(StatusCode::BAD_REQUEST);
            res.render(Json(ErrorResponse {
                error: "Invalid request body".to_string(),
            }));
            return;
        }
    };

    // Validate input
    if create_req.email.is_empty() || create_req.name.is_empty() || create_req.password.is_empty() {
        res.status_code(StatusCode::BAD_REQUEST);
        res.render(Json(ErrorResponse {
            error: "Email, name, and password are required".to_string(),
        }));
        return;
    }

    // Get database provider
    let provider = match get_db_from_depot(depot) {
        Ok(p) => p,
        Err(e) => {
            error!(error = ?e, "Failed to get database provider");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            res.render(Json(ErrorResponse {
                error: "Internal server error".to_string(),
            }));
            return;
        }
    };

    let mut conn = match provider.get_connection().await {
        Ok(c) => c,
        Err(e) => {
            error!(error = ?e, "Failed to get database connection");
            res.status_code(StatusCode::SERVICE_UNAVAILABLE);
            res.render(Json(ErrorResponse {
                error: "Database unavailable".to_string(),
            }));
            return;
        }
    };

    // Check if user already exists
    let existing_user = match schema::user::table
        .filter(schema::user::email.eq(&create_req.email))
        .select(User::as_select())
        .first::<User>(&mut conn)
        .await
        .optional()
    {
        Ok(u) => u,
        Err(e) => {
            error!(error = ?e, "Failed to query existing user");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            res.render(Json(ErrorResponse {
                error: "Internal server error".to_string(),
            }));
            return;
        }
    };

    if existing_user.is_some() {
        res.status_code(StatusCode::BAD_REQUEST);
        res.render(Json(ErrorResponse {
            error: "Email already registered".to_string(),
        }));
        return;
    }

    // Hash the password
    let password_hash = match shuriken_service::auth::password::hash_password(&create_req.password)
    {
        Ok(h) => h,
        Err(e) => {
            error!(error = ?e, "Failed to hash password");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            res.render(Json(ErrorResponse {
                error: "Failed to process password".to_string(),
            }));
            return;
        }
    };

    // Create principal
    let principal_id = uuid::Uuid::now_v7();
    let principal_slug = shuriken_core::util::slug::generate_slug(&create_req.email);

    let new_principal = NewPrincipal {
        id: principal_id,
        principal_type: PrincipalType::User,
        slug: principal_slug.as_str(),
        display_name: Some(&create_req.name),
    };

    if let Err(e) = diesel::insert_into(schema::principal::table)
        .values(&new_principal)
        .execute(&mut conn)
        .await
    {
        error!(error = ?e, "Failed to create principal");
        res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
        res.render(Json(ErrorResponse {
            error: "Failed to create user".to_string(),
        }));
        return;
    }

    // Create user
    let new_user = NewUser {
        name: &create_req.name,
        email: &create_req.email,
        principal_id,
    };

    let user = match diesel::insert_into(schema::user::table)
        .values(&new_user)
        .returning(User::as_select())
        .get_result::<User>(&mut conn)
        .await
    {
        Ok(u) => u,
        Err(e) => {
            error!(error = ?e, "Failed to create user");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            res.render(Json(ErrorResponse {
                error: "Failed to create user".to_string(),
            }));
            return;
        }
    };

    // Create auth_user with password hash
    let new_auth_user = NewAuthUser {
        auth_source: "password".to_string(),
        auth_id: password_hash,
        user_id: user.id,
    };

    if let Err(e) = diesel::insert_into(schema::auth_user::table)
        .values(&new_auth_user)
        .execute(&mut conn)
        .await
    {
        error!(error = ?e, "Failed to create auth_user");
        res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
        res.render(Json(ErrorResponse {
            error: "Failed to create authentication record".to_string(),
        }));
        return;
    }

    tracing::info!(
        user_id = %user.id,
        email = %user.email,
        created_by = %authenticated_user.email,
        "User created successfully"
    );

    res.status_code(StatusCode::CREATED);
    res.render(Json(UserResponse {
        user_id: user.id.to_string(),
        principal_id: principal_id.to_string(),
        email: user.email,
        name: user.name,
    }));
}

/// ## Summary
/// PUT /`app/users/:user_id/password` - Update a user's password
///
/// This endpoint is only accessible to authenticated users with write permissions
/// to `/principals/{user_id}`. This allows:
/// - Administrators with write access to /principals/** to update any user's password
/// - Users to update their own password (if they have write access to their own principal)
///
/// ## Errors
/// Returns HTTP 401 if not authenticated
/// Returns HTTP 403 if user lacks write access to /`principals/{user_id`}
/// Returns HTTP 404 if user not found
/// Returns HTTP 500 if database operations fail
#[handler]
async fn update_password_handler(req: &mut Request, depot: &mut Depot, res: &mut Response) {
    use diesel::{ExpressionMethods, OptionalExtension, QueryDsl, SelectableHelper};
    use diesel_async::RunQueryDsl;
    use shuriken_db::{
        db::schema,
        model::user::{User, authuser::NewAuthUser},
    };

    tracing::debug!("Processing update password request");

    // Get authenticated user from depot
    let Ok(DepotUser::User(authenticated_user)) =
        depot.get::<DepotUser>(depot_keys::AUTHENTICATED_PRINCIPAL)
    else {
        res.status_code(StatusCode::UNAUTHORIZED);
        res.render(Json(ErrorResponse {
            error: "Authentication required".to_string(),
        }));
        return;
    };

    // Get target user_id from path parameter
    let Some(user_id_str) = req.param::<String>("user_id") else {
        res.status_code(StatusCode::BAD_REQUEST);
        res.render(Json(ErrorResponse {
            error: "User ID required".to_string(),
        }));
        return;
    };

    let Ok(target_user_id) = uuid::Uuid::parse_str(&user_id_str) else {
        res.status_code(StatusCode::BAD_REQUEST);
        res.render(Json(ErrorResponse {
            error: "Invalid user ID format".to_string(),
        }));
        return;
    };

    // Get database provider
    let provider = match get_db_from_depot(depot) {
        Ok(p) => p,
        Err(e) => {
            error!(error = ?e, "Failed to get database provider");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            res.render(Json(ErrorResponse {
                error: "Internal server error".to_string(),
            }));
            return;
        }
    };

    let mut conn = match provider.get_connection().await {
        Ok(c) => c,
        Err(e) => {
            error!(error = ?e, "Failed to get database connection");
            res.status_code(StatusCode::SERVICE_UNAVAILABLE);
            res.render(Json(ErrorResponse {
                error: "Database unavailable".to_string(),
            }));
            return;
        }
    };

    // Look up target user
    let target_user = match schema::user::table
        .filter(schema::user::id.eq(target_user_id))
        .select(User::as_select())
        .first::<User>(&mut conn)
        .await
        .optional()
    {
        Ok(Some(u)) => u,
        Ok(None) => {
            res.status_code(StatusCode::NOT_FOUND);
            res.render(Json(ErrorResponse {
                error: "User not found".to_string(),
            }));
            return;
        }
        Err(e) => {
            error!(error = ?e, "Failed to query user");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            res.render(Json(ErrorResponse {
                error: "Internal server error".to_string(),
            }));
            return;
        }
    };

    // Check if authenticated user has write access to /principals/{target_principal_id}
    let subjects = ExpandedSubjects::from_user(authenticated_user);

    let principal_resource = ResourceLocation::from_segments(vec![
        PathSegment::ResourceType(shuriken_service::auth::ResourceType::Principal),
        PathSegment::Owner(shuriken_service::auth::ResourceIdentifier::Id(target_user.principal_id)),
    ]).expect("Valid resource location");

    if let Err(_e) = handler_require(depot, &subjects, &principal_resource, Action::Edit) {
        tracing::warn!(
            authenticated_user = %authenticated_user.email,
            target_user = %target_user.email,
            "User attempted to update password without write access"
        );
        res.status_code(StatusCode::FORBIDDEN);
        res.render(Json(ErrorResponse {
            error: "Insufficient permissions to update this user's password".to_string(),
        }));
        return;
    }

    // Extract JSON body
    let update_req: UpdatePasswordRequest = match req.parse_json().await {
        Ok(r) => r,
        Err(e) => {
            error!(error = ?e, "Failed to parse update password request");
            res.status_code(StatusCode::BAD_REQUEST);
            res.render(Json(ErrorResponse {
                error: "Invalid request body".to_string(),
            }));
            return;
        }
    };

    // Validate input
    if update_req.password.is_empty() {
        res.status_code(StatusCode::BAD_REQUEST);
        res.render(Json(ErrorResponse {
            error: "Password is required".to_string(),
        }));
        return;
    }

    // Hash the new password
    let password_hash = match shuriken_service::auth::password::hash_password(&update_req.password)
    {
        Ok(h) => h,
        Err(e) => {
            error!(error = ?e, "Failed to hash password");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            res.render(Json(ErrorResponse {
                error: "Failed to process password".to_string(),
            }));
            return;
        }
    };

    // Update auth_user record
    let updated_rows = match diesel::update(schema::auth_user::table)
        .filter(schema::auth_user::user_id.eq(target_user_id))
        .filter(schema::auth_user::auth_source.eq("password"))
        .set(schema::auth_user::auth_id.eq(&password_hash))
        .execute(&mut conn)
        .await
    {
        Ok(rows) => rows,
        Err(e) => {
            error!(error = ?e, "Failed to update password");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            res.render(Json(ErrorResponse {
                error: "Failed to update password".to_string(),
            }));
            return;
        }
    };

    if updated_rows == 0 {
        // No auth_user record exists with auth_source="password", create one
        let new_auth_user = NewAuthUser {
            auth_source: "password".to_string(),
            auth_id: password_hash,
            user_id: target_user_id,
        };

        if let Err(e) = diesel::insert_into(schema::auth_user::table)
            .values(&new_auth_user)
            .execute(&mut conn)
            .await
        {
            error!(error = ?e, "Failed to create auth_user");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            res.render(Json(ErrorResponse {
                error: "Failed to create password record".to_string(),
            }));
            return;
        }
    }

    tracing::info!(
        target_user_id = %target_user_id,
        target_user_email = %target_user.email,
        updated_by = %authenticated_user.email,
        "Password updated successfully"
    );

    res.status_code(StatusCode::OK);
    res.render(Json(UserResponse {
        user_id: target_user.id.to_string(),
        principal_id: target_user.principal_id.to_string(),
        email: target_user.email,
        name: target_user.name,
    }));
}

#[must_use]
pub fn routes() -> Router {
    Router::with_path("users")
        .post(create_user_handler)
        .push(Router::with_path("<user_id>/password").put(update_password_handler))
}
