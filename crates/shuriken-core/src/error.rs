use thiserror::Error;

/// Core-level errors
#[derive(Error, Debug)]
pub enum CoreError {
    #[error("Configuration error: {0}")]
    ConfigError(String),

    #[error("Validation error: {0}")]
    ValidationError(String),

    #[error("Invalid input: {0}")]
    InvalidInput(String),

    #[error("Invariant violation: {0}")]
    InvariantViolation(&'static str),
}

pub type CoreResult<T> = std::result::Result<T, CoreError>;
