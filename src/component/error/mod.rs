use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Database error: {0}")]
    DatabaseError(#[from] diesel::result::Error),
    #[error("Pool error: {0}")]
    PoolError(#[from] diesel_async::pooled_connection::bb8::RunError),

    #[error("Authentication error: {0}")]
    AuthenticationError(String),
    #[error("Not Authenticated")]
    NotAuthenticated,
    #[error("Authorization error: {0}")]
    AuthorizationError(String),
    #[error("Casbin error: {0}")]
    CasbinError(#[from] casbin::Error),

    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Validation error: {0}")]
    ValidationError(String),
    #[error("Invalid configuration: {0}")]
    InvalidConfiguration(String),

    #[error("Invariant violation: {0}")]
    InvariantViolation(String),
}

pub type AppResult<T> = std::result::Result<T, AppError>;
