//! Error types for caldavtester.

use std::path::PathBuf;

/// Specialized Result type for caldavtester operations.
pub type Result<T> = std::result::Result<T, Error>;

/// Errors that can occur during test execution.
#[derive(thiserror::Error, Debug)]
pub enum Error {
    /// XML parsing error
    #[error("XML parse error in {file}: {source}")]
    XmlParse {
        file: PathBuf,
        source: quick_xml::Error,
    },

    /// Test file not found
    #[error("Test file not found: {0}")]
    TestFileNotFound(PathBuf),

    /// Invalid test structure
    #[error("Invalid test structure: {0}")]
    InvalidTestStructure(String),

    /// HTTP request failed
    #[error("HTTP request failed: {0}")]
    HttpRequest(#[from] reqwest::Error),

    /// Invalid HTTP method
    #[error("Invalid HTTP method: {0}")]
    InvalidMethod(#[from] http::method::InvalidMethod),

    /// Verification failed
    #[error("Verification failed: {0}")]
    VerificationFailed(String),

    /// Variable not found
    #[error("Variable not found: {0}")]
    VariableNotFound(String),

    /// Server error
    #[error("Server error: {0}")]
    Server(String),

    /// I/O error
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    /// Generic error
    #[error("{0}")]
    Other(String),
}
