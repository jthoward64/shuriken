//! PUT operation result and error types.

/// Result of a PUT operation.
pub(super) enum PutResult {
    /// Resource was created with the given `ETag`.
    Created(String),
    /// Resource was updated with the given `ETag`.
    Updated(String),
    /// Precondition failed (If-Match or If-None-Match).
    PreconditionFailed,
}

/// Errors that can occur during PUT.
#[expect(
    dead_code,
    reason = "Unsupported variants reserved for future RFC compliance"
)]
pub(super) enum PutError {
    /// Invalid iCalendar data (RFC 4791 §5.3.2.1).
    InvalidCalendarData(String),
    /// Invalid calendar object resource (RFC 4791 §5.3.2.1).
    InvalidCalendarObjectResource(String),
    /// Unsupported calendar data format (RFC 4791 §5.3.2.1).
    UnsupportedCalendarData(String),
    /// Unsupported calendar component (RFC 4791 §5.3.2.1).
    UnsupportedCalendarComponent(String),
    /// UID conflict with another resource.
    UidConflict(String),
    /// Database error.
    DatabaseError(anyhow::Error),
}

impl From<anyhow::Error> for PutError {
    fn from(e: anyhow::Error) -> Self {
        Self::DatabaseError(e)
    }
}
