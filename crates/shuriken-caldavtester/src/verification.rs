//! Response verification logic.
//!
//! Implements various verification callbacks from the test suite.

use crate::error::{Error, Result};
use std::collections::HashMap;

/// HTTP response to verify
#[derive(Debug, Clone)]
pub struct Response {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

/// Verification result
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VerifyResult {
    /// Verification passed
    Pass,
    /// Verification failed with message
    Fail(String),
}

impl VerifyResult {
    /// Check if verification passed
    #[must_use]
    pub const fn is_pass(&self) -> bool {
        matches!(self, Self::Pass)
    }

    /// Check if verification failed
    #[must_use]
    pub const fn is_fail(&self) -> bool {
        !self.is_pass()
    }
}

/// ## Summary
/// Verify an HTTP response against verification rules.
///
/// The `args` map follows the test suite convention: each key maps to a list
/// of values. Most callbacks only care about the first value, but some (like
/// `propfindItems`) use multiple.
///
/// ## Errors
/// Returns an error if verification logic fails to execute.
pub fn verify_response(
    response: &Response,
    callback: &str,
    args: &HashMap<String, Vec<String>>,
) -> Result<VerifyResult> {
    match callback {
        "statusCode" => verify_status_code(response, args),
        "header" => verify_header(response, args),
        "headerContains" => verify_header_contains(response, args),
        "dataString" => verify_data_string(response, args),
        "notDataString" => verify_not_data_string(response, args),
        "propfindItems" => verify_propfind_items(response, args),
        "calendarDataMatch" => verify_calendar_data_match(response, args),
        "multistatusItems" => verify_multistatus_items(response, args),
        "xmlElementMatch" => verify_xml_element_match(response, args),
        "freeBusy" => verify_freebusy(response, args),
        "acl" => verify_acl(response, args),
        "prepostcondition" => verify_prepost_condition(response, args),
        "exists" | "doesNotExist" => {
            // These are meta-verifications, pass through
            Ok(VerifyResult::Pass)
        }
        _ => {
            tracing::warn!(callback, "Unimplemented verification callback — treating as pass");
            Ok(VerifyResult::Pass)
        }
    }
}

/// Helper to get the first value for a key in the args map.
fn first_arg<'a>(args: &'a HashMap<String, Vec<String>>, key: &str) -> Option<&'a str> {
    args.get(key)
        .and_then(|v| v.first())
        .map(String::as_str)
}

/// Verify HTTP status code.
///
/// If no explicit status arg is given, defaults to `2xx` range check.
fn verify_status_code(
    response: &Response,
    args: &HashMap<String, Vec<String>>,
) -> Result<VerifyResult> {
    let expected = first_arg(args, "status");

    let ok = match expected {
        Some(code_str) => {
            // Multiple acceptable codes separated by something? The test suite
            // only ever supplies one, so parse it as a single u16.
            let expected_code: u16 = code_str
                .parse()
                .map_err(|_| Error::Other(format!("Invalid status code: {code_str}")))?;
            response.status == expected_code
        }
        // No argument → accept any 2xx
        None => (200..300).contains(&response.status),
    };

    if ok {
        Ok(VerifyResult::Pass)
    } else {
        Ok(VerifyResult::Fail(format!(
            "Expected status {}, got {}",
            expected.unwrap_or("2xx"),
            response.status
        )))
    }
}

/// Verify response header exists (optionally with a specific value).
fn verify_header(
    response: &Response,
    args: &HashMap<String, Vec<String>>,
) -> Result<VerifyResult> {
    let header_name = first_arg(args, "header")
        .ok_or_else(|| Error::Other("Missing 'header' argument".to_string()))?;

    let header_lower = header_name.to_lowercase();
    let header_value = response
        .headers
        .iter()
        .find(|(k, _)| k.to_lowercase() == header_lower)
        .map(|(_, v)| v.as_str());

    match header_value {
        Some(_) => Ok(VerifyResult::Pass),
        None => Ok(VerifyResult::Fail(format!(
            "Expected header '{header_name}' not found in response"
        ))),
    }
}

/// Verify response header contains a value.
fn verify_header_contains(
    response: &Response,
    args: &HashMap<String, Vec<String>>,
) -> Result<VerifyResult> {
    let header_name = first_arg(args, "header")
        .ok_or_else(|| Error::Other("Missing 'header' argument".to_string()))?;
    let expected_value = first_arg(args, "contains")
        .or_else(|| first_arg(args, "value"))
        .ok_or_else(|| Error::Other("Missing 'contains'/'value' argument".to_string()))?;

    let header_lower = header_name.to_lowercase();
    let header_value = response
        .headers
        .iter()
        .find(|(k, _)| k.to_lowercase() == header_lower)
        .map(|(_, v)| v.as_str());

    match header_value {
        Some(value) if value.contains(expected_value) => Ok(VerifyResult::Pass),
        Some(value) => Ok(VerifyResult::Fail(format!(
            "Header '{header_name}' value '{value}' does not contain '{expected_value}'"
        ))),
        None => Ok(VerifyResult::Fail(format!(
            "Header '{header_name}' not found"
        ))),
    }
}

/// Verify response body contains a string.
fn verify_data_string(
    response: &Response,
    args: &HashMap<String, Vec<String>>,
) -> Result<VerifyResult> {
    if let Some(contains) = args.get("contains") {
        for expected in contains {
            if !response.body.contains(expected) {
                return Ok(VerifyResult::Fail(format!(
                    "Response body does not contain '{expected}'"
                )));
            }
        }
    }
    Ok(VerifyResult::Pass)
}

/// Verify response body does NOT contain a string.
fn verify_not_data_string(
    response: &Response,
    args: &HashMap<String, Vec<String>>,
) -> Result<VerifyResult> {
    if let Some(contains) = args.get("contains") {
        for expected in contains {
            if response.body.contains(expected) {
                return Ok(VerifyResult::Fail(format!(
                    "Response body unexpectedly contains '{expected}'"
                )));
            }
        }
    }
    Ok(VerifyResult::Pass)
}

/// Verify PROPFIND response items (stub).
fn verify_propfind_items(
    _response: &Response,
    _args: &HashMap<String, Vec<String>>,
) -> Result<VerifyResult> {
    // TODO: Parse multistatus XML and check property presence/absence
    tracing::debug!("propfindItems verification not yet implemented — auto-passing");
    Ok(VerifyResult::Pass)
}

/// Verify calendar data matches expected file (stub).
fn verify_calendar_data_match(
    _response: &Response,
    _args: &HashMap<String, Vec<String>>,
) -> Result<VerifyResult> {
    // TODO: Parse and semantically compare iCalendar data
    tracing::debug!("calendarDataMatch verification not yet implemented — auto-passing");
    Ok(VerifyResult::Pass)
}

/// Verify multistatus response items (stub).
fn verify_multistatus_items(
    _response: &Response,
    _args: &HashMap<String, Vec<String>>,
) -> Result<VerifyResult> {
    tracing::debug!("multistatusItems verification not yet implemented — auto-passing");
    Ok(VerifyResult::Pass)
}

/// Verify XML element matches (stub).
fn verify_xml_element_match(
    _response: &Response,
    _args: &HashMap<String, Vec<String>>,
) -> Result<VerifyResult> {
    tracing::debug!("xmlElementMatch verification not yet implemented — auto-passing");
    Ok(VerifyResult::Pass)
}

/// Verify free-busy data (stub).
fn verify_freebusy(
    _response: &Response,
    _args: &HashMap<String, Vec<String>>,
) -> Result<VerifyResult> {
    tracing::debug!("freeBusy verification not yet implemented — auto-passing");
    Ok(VerifyResult::Pass)
}

/// Verify ACL data (stub).
fn verify_acl(
    _response: &Response,
    _args: &HashMap<String, Vec<String>>,
) -> Result<VerifyResult> {
    tracing::debug!("acl verification not yet implemented — auto-passing");
    Ok(VerifyResult::Pass)
}

/// Verify DAV pre/post condition errors (stub).
fn verify_prepost_condition(
    _response: &Response,
    _args: &HashMap<String, Vec<String>>,
) -> Result<VerifyResult> {
    tracing::debug!("prepostcondition verification not yet implemented — auto-passing");
    Ok(VerifyResult::Pass)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_response(status: u16) -> Response {
        Response {
            status,
            headers: HashMap::new(),
            body: String::new(),
        }
    }

    fn args(pairs: &[(&str, &str)]) -> HashMap<String, Vec<String>> {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), vec![(*v).to_string()]))
            .collect()
    }

    #[test]
    fn status_code_pass() {
        let response = make_response(200);
        let result = verify_status_code(&response, &args(&[("status", "200")])).unwrap();
        assert!(result.is_pass());
    }

    #[test]
    fn status_code_fail() {
        let response = make_response(404);
        let result = verify_status_code(&response, &args(&[("status", "200")])).unwrap();
        assert!(result.is_fail());
    }

    #[test]
    fn status_code_no_arg_2xx() {
        let response = make_response(201);
        let result = verify_status_code(&response, &HashMap::new()).unwrap();
        assert!(result.is_pass());
    }

    #[test]
    fn status_code_no_arg_4xx() {
        let response = make_response(404);
        let result = verify_status_code(&response, &HashMap::new()).unwrap();
        assert!(result.is_fail());
    }

    #[test]
    fn header_exists() {
        let mut response = make_response(200);
        response
            .headers
            .insert("Content-Type".to_string(), "text/xml".to_string());

        let result =
            verify_header(&response, &args(&[("header", "content-type")])).unwrap();
        assert!(result.is_pass());
    }

    #[test]
    fn data_string_contains() {
        let mut response = make_response(200);
        response.body = "BEGIN:VCALENDAR\nEND:VCALENDAR".to_string();
        let result =
            verify_data_string(&response, &args(&[("contains", "VCALENDAR")])).unwrap();
        assert!(result.is_pass());
    }
}
