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
    InvariantViolation(&'static str),

    #[error("Parse error: {0}")]
    ParseError(String),

    #[error("Path resolution error: {0}")]
    PathResolutionError(#[from] PathResolutionError),
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

pub type AppResult<T> = std::result::Result<T, AppError>;
