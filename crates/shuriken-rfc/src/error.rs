use thiserror::Error;

/// RFC parsing and validation errors
#[derive(Error, Debug)]
pub enum RfcError {
    #[error("Parse error: {0}")]
    ParseError(String),

    #[error("Validation error: {0}")]
    ValidationError(String),

    #[error("RRule validation error: {0}")]
    RRuleValidationError(#[from] rrule::ValidationError),

    #[error(transparent)]
    CoreError(#[from] shuriken_core::error::CoreError),
}

pub type RfcResult<T> = std::result::Result<T, RfcError>;
