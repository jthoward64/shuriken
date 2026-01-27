//! DAV XML error body builders for precondition/postcondition failures.
//!
//! This module provides utilities for writing RFC 4918 §16 compliant error
//! responses with precondition/postcondition XML elements.

use salvo::Response;

use crate::component::rfc::dav::core::PreconditionError;

/// Writes a precondition error response to the HTTP response.
///
/// Sets the appropriate HTTP status code and serializes the error to an
/// RFC 4918 §16 compliant XML error body.
///
/// ## Example
///
/// ```ignore
/// use crate::component::rfc::dav::core::PreconditionError;
/// use crate::app::api::dav::response::error::write_precondition_error;
///
/// let err = PreconditionError::CalendarSupportedCollation("i;unknown".into());
/// write_precondition_error(res, &err);
/// ```
#[allow(dead_code)]
pub fn write_precondition_error(res: &mut Response, error: &PreconditionError) {
    res.status_code(error.status_code());

    #[expect(
        clippy::let_underscore_must_use,
        reason = "Header addition failure is non-fatal"
    )]
    let _ = res.add_header(
        "Content-Type",
        salvo::http::HeaderValue::from_static("application/xml; charset=utf-8"),
        true,
    );

    let xml = error.to_xml();
    tracing::debug!("Precondition error response: {}", xml);

    #[expect(
        clippy::let_underscore_must_use,
        reason = "Write body failure is non-fatal"
    )]
    let _ = res.write_body(xml);
}

/// Extension trait for `Response` to simplify precondition error handling.
#[allow(dead_code)]
pub trait PreconditionErrorExt {
    /// Writes a precondition error to the response.
    fn precondition_error(&mut self, error: &PreconditionError);
}

impl PreconditionErrorExt for Response {
    fn precondition_error(&mut self, error: &PreconditionError) {
        write_precondition_error(self, error);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_write_precondition_error() {
        // Just verify the function compiles and the logic is sound
        // Actual HTTP response testing would require integration tests
        let err = PreconditionError::CalendarSupportedCollation("i;unknown".into());
        assert_eq!(err.status_code(), salvo::http::StatusCode::FORBIDDEN);
        assert!(err.to_xml().contains("supported-collation"));
    }
}
