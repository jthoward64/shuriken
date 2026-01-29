use thiserror::Error;

/// Database layer errors
#[derive(Error, Debug)]
pub enum DbError {
    #[error("Database error: {0}")]
    DatabaseError(#[from] diesel::result::Error),

    #[error("Pool error: {0}")]
    PoolError(#[from] diesel_async::pooled_connection::bb8::RunError),

    #[error("Path resolution error: {0}")]
    PathResolutionError(#[from] PathResolutionError),

    #[error(transparent)]
    CoreError(#[from] shuriken_core::error::CoreError),
}

#[derive(Error, Debug)]
pub enum PathResolutionError {
    #[error("Invalid path format: {0}")]
    InvalidPathFormat(String),

    #[error("Principal not found: {0}")]
    PrincipalNotFound(String),

    #[error("Collection not found: owner={owner}, slug={slug}")]
    CollectionNotFound { owner: String, slug: String },

    #[error("Instance not found: collection_id={collection_id}, slug={slug}")]
    InstanceNotFound {
        collection_id: uuid::Uuid,
        slug: String,
    },

    #[error("Database error during path resolution: {0}")]
    DatabaseError(#[from] diesel::result::Error),
}

pub type DbResult<T> = std::result::Result<T, DbError>;
