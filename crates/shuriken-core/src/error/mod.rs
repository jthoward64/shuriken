use thiserror::Error;

/// Core error type with minimal dependencies
#[derive(Error, Debug)]
pub enum CoreError {
    #[error("Authentication error: {0}")]
    AuthenticationError(String),
    #[error("Not Authenticated")]
    NotAuthenticated,
    #[error("Authorization error: {0}")]
    AuthorizationError(String),

    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Validation error: {0}")]
    ValidationError(String),
    #[error("Invalid configuration: {0}")]
    InvalidConfiguration(String),

    #[error("Invariant violation: {0}")]
    InvariantViolation(&'static str),

    #[error("Parse error: {0}")]
    ParseError(String),
}

pub type CoreResult<T> = std::result::Result<T, CoreError>;
