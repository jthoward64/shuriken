//! PUT operation result and error types.

/// Result of a PUT operation.
#[expect(dead_code)]
pub(super) enum PutResult {
    /// Resource was created with the given `ETag`.
    Created(String),
    /// Resource was updated with the given `ETag`.
    Updated(String),
    /// Precondition failed (If-Match or If-None-Match).
    PreconditionFailed,
}

/// Errors that can occur during PUT.
#[expect(dead_code)]
pub(super) enum PutError {
    /// Invalid iCalendar data.
    InvalidCalendarData(String),
    /// UID conflict with another resource.
    UidConflict(String),
    /// Database error.
    DatabaseError(anyhow::Error),
}

#[expect(dead_code)]
impl From<anyhow::Error> for PutError {
    fn from(e: anyhow::Error) -> Self {
        Self::DatabaseError(e)
    }
}
