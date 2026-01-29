use thiserror::Error;

/// Application-level errors (HTTP layer)
#[derive(Error, Debug)]
pub enum AppError {
    #[error(transparent)]
    ServiceError(#[from] shuriken_service::error::ServiceError),

    #[error(transparent)]
    DatabaseError(#[from] shuriken_db::error::DbError),

    #[error(transparent)]
    RfcError(#[from] shuriken_rfc::error::RfcError),

    #[error(transparent)]
    CoreError(#[from] shuriken_core::error::CoreError),
}

pub type AppResult<T> = std::result::Result<T, AppError>;
