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

/// ## Summary
/// Errors that can occur during CardDAV PUT operations.
///
/// Each error maps to an RFC 6352 precondition that gets serialized
/// as an XML error element in the 403 response body.
pub(super) enum PutError {
    /// ## Summary
    /// Invalid vCard data format (RFC 6352 §5.3.4 `valid-address-data`).
    ///
    /// The submitted vCard does not conform to RFC 6350 syntax.
    InvalidVcardData(String),

    /// ## Summary
    /// Unsupported media type for address objects (RFC 6352 §5.3.4 `supported-address-data`).
    ///
    /// The Content-Type must be "text/vcard" or not specified. Other media types are rejected.
    UnsupportedAddressData(String),

    /// ## Summary
    /// Resource size exceeds maximum allowed (RFC 6352 §5.3.4 `max-resource-size`).
    ///
    /// The vCard size exceeds the addressbook's max-resource-size (100KB).
    MaxResourceSizeExceeded { size: usize, max: usize },

    /// UID conflict with another resource (RFC 6352 §5.3.4 `no-uid-conflict`).
    UidConflict(String),

    /// Database error.
    DatabaseError(anyhow::Error),
}

impl From<anyhow::Error> for PutError {
    fn from(e: anyhow::Error) -> Self {
        Self::DatabaseError(e)
    }
}
