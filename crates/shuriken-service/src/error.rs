use thiserror::Error;

/// Service layer errors - combines all error types
#[derive(Error, Debug)]
pub enum ServiceError {
    #[error("Casbin error: {0}")]
    CasbinError(#[from] casbin::Error),

    #[error(transparent)]
    DatabaseError(#[from] shuriken_db::error::DbError),

    #[error(transparent)]
    RfcError(#[from] shuriken_rfc::error::RfcError),

    #[error(transparent)]
    CoreError(#[from] shuriken_core::error::CoreError),

    #[error("Not authenticated")]
    NotAuthenticated,

    #[error("Authorization error: {0}")]
    AuthorizationError(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Invalid configuration: {0}")]
    InvalidConfiguration(String),

    #[error("Invariant violation: {0}")]
    InvariantViolation(&'static str),

    #[error("Parse error: {0}")]
    ParseError(String),

    #[error("Validation error: {0}")]
    ValidationError(String),

    #[error("Conflict: {0}")]
    Conflict(String),

    #[error("Diesel error: {0}")]
    DieselError(#[from] diesel::result::Error),
}

pub type ServiceResult<T> = std::result::Result<T, ServiceError>;
