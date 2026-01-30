use salvo::{Depot, Request, Response, Router, http::StatusCode, writing::Json, handler};
use serde::{Deserialize, Serialize};
use tracing::error;

use crate::db_handler::get_db_from_depot;

/// ## Summary
/// Registration request payload
#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub name: String,
    pub email: String,
    pub password: String,
}

/// ## Summary
/// Registration response payload
#[derive(Debug, Serialize)]
pub struct RegisterResponse {
    pub user_id: String,
    pub email: String,
    pub name: String,
}

/// ## Summary
/// Error response payload
#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
}

/// ## Summary
/// Login request payload
#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

/// ## Summary
/// Login response payload
#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub success: bool,
    pub user_id: String,
    pub email: String,
    pub name: String,
    pub message: String,
}

/// ## Summary
/// POST /app/auth/register - Register a new user with email and password
///
/// ## Side Effects
/// - Creates a principal row
/// - Creates a user row
/// - Creates an auth_user row with hashed password
///
/// ## Errors
/// Returns HTTP 400 if the email is already registered
/// Returns HTTP 500 if database operations fail
#[handler]
async fn register_handler(
    req: &mut Request,
    depot: &mut Depot,
    res: &mut Response,
) {
    use diesel_async::RunQueryDsl;
    use diesel::{ExpressionMethods, OptionalExtension, QueryDsl, SelectableHelper};
    use shuriken_db::{
        db::schema,
        model::{
            principal::{NewPrincipal, PrincipalType},
            user::{authuser::NewAuthUser, NewUser, User},
        },
    };

    tracing::debug!("Processing user registration request");

    // Extract JSON body
    let register_req: RegisterRequest = match req.parse_json().await {
        Ok(r) => r,
        Err(e) => {
            error!(error = ?e, "Failed to parse registration request");
            res.status_code(StatusCode::BAD_REQUEST);
            res.render(Json(ErrorResponse {
                error: "Invalid request body".to_string(),
            }));
            return;
        }
    };

    // Validate input
    if register_req.email.is_empty()
        || register_req.name.is_empty()
        || register_req.password.is_empty()
    {
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
        .filter(schema::user::email.eq(&register_req.email))
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
    let password_hash = match shuriken_service::auth::password::hash_password(&register_req.password)
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
    let principal_slug = shuriken_core::util::slug::generate_slug(&register_req.email);

    let new_principal = NewPrincipal {
        id: principal_id,
        principal_type: PrincipalType::User,
        slug: principal_slug.as_str(),
        display_name: Some(&register_req.name),
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
        name: &register_req.name,
        email: &register_req.email,
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
        auth_id: password_hash, // Store the Argon2 hash in auth_id
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

    tracing::info!(user_id = %user.id, email = %user.email, "User registered successfully");

    res.status_code(StatusCode::CREATED);
    res.render(Json(RegisterResponse {
        user_id: user.id.to_string(),
        email: user.email,
        name: user.name,
    }));
}

/// ## Summary
/// POST /app/auth/login - Test login endpoint (verifies credentials)
///
/// This endpoint allows testing basic authentication by verifying
/// email/password combinations. In production, CalDAV/CardDAV clients
/// will use HTTP Basic Auth on actual API endpoints.
///
/// ## Errors
/// Returns HTTP 401 if credentials are invalid
/// Returns HTTP 500 if database operations fail
#[handler]
async fn login_handler(
    req: &mut Request,
    depot: &mut Depot,
    res: &mut Response,
) {
    use diesel_async::RunQueryDsl;
    use diesel::{ExpressionMethods, OptionalExtension, QueryDsl, SelectableHelper};
    use shuriken_db::{
        db::schema,
        model::user::{authuser::AuthUser, User},
    };

    tracing::debug!("Processing login request");

    // Extract JSON body
    let login_req: LoginRequest = match req.parse_json().await {
        Ok(r) => r,
        Err(e) => {
            error!(error = ?e, "Failed to parse login request");
            res.status_code(StatusCode::BAD_REQUEST);
            res.render(Json(ErrorResponse {
                error: "Invalid request body".to_string(),
            }));
            return;
        }
    };

    // Validate input
    if login_req.email.is_empty() || login_req.password.is_empty() {
        res.status_code(StatusCode::BAD_REQUEST);
        res.render(Json(ErrorResponse {
            error: "Email and password are required".to_string(),
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

    // Look up user by email
    let user = match schema::user::table
        .filter(schema::user::email.eq(&login_req.email))
        .select(User::as_select())
        .first::<User>(&mut conn)
        .await
        .optional()
    {
        Ok(Some(u)) => u,
        Ok(None) => {
            res.status_code(StatusCode::UNAUTHORIZED);
            res.render(Json(ErrorResponse {
                error: "Invalid email or password".to_string(),
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

    // Look up auth_user entry with source "password"
    let auth_user = match schema::auth_user::table
        .filter(schema::auth_user::user_id.eq(user.id))
        .filter(schema::auth_user::auth_source.eq("password"))
        .select(AuthUser::as_select())
        .first::<AuthUser>(&mut conn)
        .await
        .optional()
    {
        Ok(Some(au)) => au,
        Ok(None) => {
            res.status_code(StatusCode::UNAUTHORIZED);
            res.render(Json(ErrorResponse {
                error: "Invalid email or password".to_string(),
            }));
            return;
        }
        Err(e) => {
            error!(error = ?e, "Failed to query auth_user");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            res.render(Json(ErrorResponse {
                error: "Internal server error".to_string(),
            }));
            return;
        }
    };

    // Verify password
    if shuriken_service::auth::password::verify_password(&login_req.password, &auth_user.auth_id)
        .is_err()
    {
        res.status_code(StatusCode::UNAUTHORIZED);
        res.render(Json(ErrorResponse {
            error: "Invalid email or password".to_string(),
        }));
        return;
    }

    tracing::info!(user_id = %user.id, email = %user.email, "User logged in successfully");

    res.status_code(StatusCode::OK);
    res.render(Json(LoginResponse {
        success: true,
        user_id: user.id.to_string(),
        email: user.email,
        name: user.name,
        message: "Login successful. Use HTTP Basic Auth for CalDAV/CardDAV requests.".to_string(),
    }));
}

#[must_use]
pub fn routes() -> Router {
    Router::with_path("auth")
        .push(Router::with_path("register").post(register_handler))
        .push(Router::with_path("login").post(login_handler))
}
