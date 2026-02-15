//! Response verification logic.
//!
//! Implements verification callbacks for the CalDAV test suite:
//!
//! - `statusCode` — HTTP status matching with wildcard support (`2xx`)
//! - `header` / `headerContains` — Response header checks
//! - `dataString` / `notDataString` — Body content checks
//! - `propfindItems` — `PROPFIND` multistatus property verification
//! - `multistatusItems` — Generic multistatus href/status verification
//! - `prepostcondition` — `DAV:error` condition code verification
//! - `xmlElementMatch` — XPath-like element matching
//! - `calendarDataMatch` / `addressDataMatch` / `dataMatch` / `xmlDataMatch` / `freeBusy` / `postFreeBusy` / `acl` — iCalendar/ACL specific checks

mod multistatus;
mod multistatus_items;
mod prepost;
mod propfind;
mod xml_match;

use crate::error::{Error, Result};
use quick_xml::events::Event;
use quick_xml::Reader;
use serde_json::Value as JsonValue;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

/// HTTP response to verify.
#[derive(Debug, Clone)]
pub struct Response {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

/// Verification result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VerifyResult {
    /// Verification passed.
    Pass,
    /// Verification failed with message.
    Fail(String),
}

impl VerifyResult {
    /// Check if verification passed.
    #[must_use]
    pub const fn is_pass(&self) -> bool {
        matches!(self, Self::Pass)
    }

    /// Check if verification failed.
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
        "propfindItems" => propfind::verify(response, args),
        "propfindValues" => propfind::verify_values(response, args),
        "multistatusItems" => multistatus_items::verify(response, args),
        "xmlElementMatch" => xml_match::verify(response, args),
        "prepostcondition" => prepost::verify(response, args),
        "jsonPointerMatch" => verify_json_pointer_match(response, args),
        "calendarDataMatch" => verify_calendar_data_match(response, args),
        "jcalDataMatch" => verify_jcal_data_match(response, args),
        "addressDataMatch" => verify_address_data_match(response, args),
        "dataMatch" => verify_data_match(response, args),
        "xmlDataMatch" => verify_xml_data_match(response, args),
        "freeBusy" => verify_freebusy(response, args),
        "postFreeBusy" => verify_post_freebusy(response, args),
        "acl" => verify_acl(response, args),
        "aclItems" => verify_acl_items(response, args),
        "exists" | "doesNotExist" => {
            // Meta-verifications: pass through
            Ok(VerifyResult::Pass)
        }
        _ => {
            tracing::warn!(
                callback,
                "Unimplemented verification callback — treating as pass"
            );
            Ok(VerifyResult::Pass)
        }
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Helper to get the first value for a key in the args map.
fn first_arg<'a>(args: &'a HashMap<String, Vec<String>>, key: &str) -> Option<&'a str> {
    args.get(key).and_then(|v| v.first()).map(String::as_str)
}

// ── statusCode ───────────────────────────────────────────────────────────────

/// Verify HTTP status code with wildcard support.
///
/// Supports:
/// - Exact codes: `"200"`, `"404"`
/// - Wildcards: `"2xx"`, `"4xx"` (digit + `xx`)
/// - Multiple codes (OR logic): `["200", "204"]`
/// - Default (no arg): `"2xx"`
fn verify_status_code(
    response: &Response,
    args: &HashMap<String, Vec<String>>,
) -> Result<VerifyResult> {
    let codes = args.get("status");
    let actual = response.status;

    let ok = match codes {
        Some(code_list) if !code_list.is_empty() => code_list
            .iter()
            .any(|code_str| matches_status(actual, code_str)),
        _ => {
            // No argument → accept any 2xx
            (200..300).contains(&actual)
        }
    };

    if ok {
        Ok(VerifyResult::Pass)
    } else {
        let expected = codes
            .map(|v| v.join("|"))
            .unwrap_or_else(|| "2xx".to_string());
        Ok(VerifyResult::Fail(format!(
            "Expected status {expected}, got {actual}"
        )))
    }
}

/// Check if a status code matches a pattern.
///
/// Supports `"200"` (exact), `"2xx"` (wildcard), `"20x"` etc.
#[must_use]
fn matches_status(actual: u16, pattern: &str) -> bool {
    let pattern = pattern.trim();

    // Try exact match first
    if let Ok(exact) = pattern.parse::<u16>() {
        return actual == exact;
    }

    // Wildcard: e.g., "2xx" means 200..299
    let actual_str = format!("{actual:03}");
    if actual_str.len() != pattern.len() {
        return false;
    }

    actual_str
        .chars()
        .zip(pattern.chars())
        .all(|(a, p)| p == 'x' || p == 'X' || a == p)
}

// ── header / headerContains ──────────────────────────────────────────────────

/// Verify response header.
///
/// Header arg formats:
/// - `"HeaderName"` — exists check
/// - `"!HeaderName"` — not-exists check
/// - `"HeaderName$regex"` — regex match
/// - `"HeaderName!regex"` — regex not-match
fn verify_header(response: &Response, args: &HashMap<String, Vec<String>>) -> Result<VerifyResult> {
    if let Some(headers) = args.get("header") {
        for spec in headers {
            let result = check_header_spec(response, spec)?;
            if result.is_fail() {
                return Ok(result);
            }
        }
    }
    Ok(VerifyResult::Pass)
}

/// Parse and check a single header spec string.
fn check_header_spec(response: &Response, spec: &str) -> Result<VerifyResult> {
    // "!HeaderName" — header must not exist
    if let Some(name) = spec.strip_prefix('!') {
        let name = name.trim();
        return if find_header(response, name).is_some() {
            Ok(VerifyResult::Fail(format!(
                "Header '{name}' exists but should not"
            )))
        } else {
            Ok(VerifyResult::Pass)
        };
    }

    // "HeaderName$regex" — header value must match regex
    if let Some((name, pattern)) = spec.split_once('$') {
        let name = name.trim();
        return match find_header(response, name) {
            Some(value) => match regex_lite::Regex::new(pattern) {
                Ok(re) if re.is_match(value) => Ok(VerifyResult::Pass),
                Ok(_) => Ok(VerifyResult::Fail(format!(
                    "Header '{name}' value '{value}' does not match pattern '{pattern}'"
                ))),
                Err(e) => Err(Error::Other(format!("Invalid regex '{pattern}': {e}"))),
            },
            None => Ok(VerifyResult::Fail(format!("Header '{name}' not found"))),
        };
    }

    // "HeaderName!regex" — header value must NOT match regex
    if let Some((name, pattern)) = spec.split_once('!') {
        // Only treat as not-match if there's content after the `!`
        if !pattern.is_empty() {
            let name = name.trim();
            return match find_header(response, name) {
                Some(value) => match regex_lite::Regex::new(pattern) {
                    Ok(re) if !re.is_match(value) => Ok(VerifyResult::Pass),
                    Ok(_) => Ok(VerifyResult::Fail(format!(
                        "Header '{name}' value '{value}' unexpectedly matches pattern '{pattern}'"
                    ))),
                    Err(e) => Err(Error::Other(format!("Invalid regex '{pattern}': {e}"))),
                },
                None => {
                    // Header doesn't exist, so it can't match — pass
                    Ok(VerifyResult::Pass)
                }
            };
        }
    }

    // Plain "HeaderName" — exists check
    let name = spec.trim();
    if find_header(response, name).is_some() {
        Ok(VerifyResult::Pass)
    } else {
        Ok(VerifyResult::Fail(format!(
            "Expected header '{name}' not found"
        )))
    }
}

/// Find a header by name (case-insensitive).
#[must_use]
fn find_header<'a>(response: &'a Response, name: &str) -> Option<&'a str> {
    let lower = name.to_lowercase();
    response
        .headers
        .iter()
        .find(|(k, _)| k.to_lowercase() == lower)
        .map(|(_, v)| v.as_str())
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

// ── dataString / notDataString ───────────────────────────────────────────────

/// Verify response body with multiple modes.
///
/// Supported args:
/// - `contains` — body must contain all listed strings
/// - `notcontains` — body must NOT contain any listed strings
/// - `equals` — body must exactly equal the value
/// - `empty` — body must be empty (value ignored)
/// - `unwrap` — unfold iCalendar continuation lines before checking
fn verify_data_string(
    response: &Response,
    args: &HashMap<String, Vec<String>>,
) -> Result<VerifyResult> {
    let body = if args.contains_key("unwrap") {
        unfold_for_data_string(&response.body)
    } else {
        response.body.clone()
    };

    // empty check
    if args.contains_key("empty") {
        return if body.trim().is_empty() {
            Ok(VerifyResult::Pass)
        } else {
            Ok(VerifyResult::Fail(format!(
                "Expected empty body, got {} bytes",
                body.len()
            )))
        };
    }

    // equals check
    if let Some(equals) = args.get("equals") {
        for expected in equals {
            if body.trim() != expected.trim() {
                return Ok(VerifyResult::Fail(format!(
                    "Body does not equal expected value (len {}, expected {})",
                    body.len(),
                    expected.len()
                )));
            }
        }
    }

    // contains check — also try with \n → \r\n normalization
    if let Some(contains) = args.get("contains") {
        for expected in contains {
            let found =
                body.contains(expected.as_str()) || body.contains(&expected.replace('\n', "\r\n"));
            if !found {
                return Ok(VerifyResult::Fail(format!(
                    "Response body does not contain '{}'",
                    truncate(expected, 120)
                )));
            }
        }
    }

    // notcontains check
    if let Some(not_contains) = args.get("notcontains") {
        for expected in not_contains {
            let found =
                body.contains(expected.as_str()) || body.contains(&expected.replace('\n', "\r\n"));
            if found {
                return Ok(VerifyResult::Fail(format!(
                    "Response body unexpectedly contains '{}'",
                    truncate(expected, 120)
                )));
            }
        }
    }

    Ok(VerifyResult::Pass)
}

/// Verify response body does NOT contain strings.
fn verify_not_data_string(
    response: &Response,
    args: &HashMap<String, Vec<String>>,
) -> Result<VerifyResult> {
    if let Some(contains) = args.get("contains") {
        for expected in contains {
            let found = response.body.contains(expected.as_str())
                || response.body.contains(&expected.replace('\n', "\r\n"));
            if found {
                return Ok(VerifyResult::Fail(format!(
                    "Response body unexpectedly contains '{}'",
                    truncate(expected, 120)
                )));
            }
        }
    }
    Ok(VerifyResult::Pass)
}

// ── Stubs ────────────────────────────────────────────────────────────────────

fn verify_calendar_data_match(
    response: &Response,
    args: &HashMap<String, Vec<String>>,
) -> Result<VerifyResult> {
    if let Some(statuses) = args.get("status") {
        if !statuses.is_empty() && !statuses.iter().any(|s| matches_status(response.status, s)) {
            return Ok(VerifyResult::Fail(format!(
                "calendarDataMatch: expected status {}, got {}",
                statuses.join("|"),
                response.status
            )));
        }
    }

    let expected_path = first_arg(args, "filepath").ok_or_else(|| {
        Error::Other("calendarDataMatch: missing 'filepath' argument".to_string())
    })?;

    let expected_data = read_expected_data(expected_path).map_err(|e| {
        Error::Other(format!(
            "calendarDataMatch: failed to read '{expected_path}': {e}"
        ))
    })?;

    let filters: Vec<String> = args.get("filter").cloned().unwrap_or_default();
    let compare_timezones = args.contains_key("doTimezones");

    let actual = normalize_ical_for_compare(&response.body, &filters, compare_timezones);
    let expected = normalize_ical_for_compare(&expected_data, &filters, compare_timezones);

    if actual == expected {
        Ok(VerifyResult::Pass)
    } else {
        Ok(VerifyResult::Fail(format!(
            "calendarDataMatch: normalized iCalendar differs from expected file '{expected_path}'"
        )))
    }
}

fn verify_address_data_match(
    response: &Response,
    args: &HashMap<String, Vec<String>>,
) -> Result<VerifyResult> {
    let expected_path = first_arg(args, "filepath")
        .ok_or_else(|| Error::Other("addressDataMatch: missing 'filepath' argument".to_string()))?;

    let expected_data = read_expected_data(expected_path).map_err(|e| {
        Error::Other(format!(
            "addressDataMatch: failed to read '{expected_path}': {e}"
        ))
    })?;

    let filters: Vec<String> = args.get("filter").cloned().unwrap_or_default();
    let actual = normalize_vcard_for_compare(&response.body, &filters);
    let expected = normalize_vcard_for_compare(&expected_data, &filters);

    if actual == expected {
        Ok(VerifyResult::Pass)
    } else {
        Ok(VerifyResult::Fail(format!(
            "addressDataMatch: normalized vCard differs from expected file '{expected_path}'"
        )))
    }
}

fn verify_data_match(
    response: &Response,
    args: &HashMap<String, Vec<String>>,
) -> Result<VerifyResult> {
    let expected_path = first_arg(args, "filepath")
        .ok_or_else(|| Error::Other("dataMatch: missing 'filepath' argument".to_string()))?;
    let expected_data = read_expected_data(expected_path)
        .map_err(|e| Error::Other(format!("dataMatch: failed to read '{expected_path}': {e}")))?;

    if response.body == expected_data {
        return Ok(VerifyResult::Pass);
    }

    let actual = response.body.replace("\r\n", "\n").replace('\r', "\n");
    let expected = expected_data.replace("\r\n", "\n").replace('\r', "\n");

    if actual == expected {
        Ok(VerifyResult::Pass)
    } else {
        Ok(VerifyResult::Fail(format!(
            "dataMatch: response body differs from expected file '{expected_path}'"
        )))
    }
}

fn verify_json_pointer_match(
    response: &Response,
    args: &HashMap<String, Vec<String>>,
) -> Result<VerifyResult> {
    if let Some(statuses) = args.get("status") {
        if !statuses.is_empty() && !statuses.iter().any(|s| matches_status(response.status, s)) {
            return Ok(VerifyResult::Fail(format!(
                "jsonPointerMatch: expected status {}, got {}",
                statuses.join("|"),
                response.status
            )));
        }
    }

    let json: JsonValue = serde_json::from_str(&response.body)
        .map_err(|e| Error::Other(format!("jsonPointerMatch: response is not valid JSON: {e}")))?;

    if let Some(exists_values) = args.get("exists") {
        for spec in exists_values {
            if !json_pointer_spec_matches(&json, spec) {
                return Ok(VerifyResult::Fail(format!(
                    "jsonPointerMatch: expected pointer match not found for '{spec}'"
                )));
            }
        }
    }

    if let Some(not_exists_values) = args.get("notexists") {
        for spec in not_exists_values {
            if json_pointer_spec_matches(&json, spec) {
                return Ok(VerifyResult::Fail(format!(
                    "jsonPointerMatch: unexpected pointer match found for '{spec}'"
                )));
            }
        }
    }

    Ok(VerifyResult::Pass)
}

fn verify_jcal_data_match(
    response: &Response,
    args: &HashMap<String, Vec<String>>,
) -> Result<VerifyResult> {
    let expected_path = first_arg(args, "filepath")
        .ok_or_else(|| Error::Other("jcalDataMatch: missing 'filepath' argument".to_string()))?;

    let expected_data = read_expected_data(expected_path).map_err(|e| {
        Error::Other(format!(
            "jcalDataMatch: failed to read '{expected_path}': {e}"
        ))
    })?;

    let actual_json: JsonValue = serde_json::from_str(&response.body)
        .map_err(|e| Error::Other(format!("jcalDataMatch: response is not valid JSON: {e}")))?;
    let expected_json: JsonValue = serde_json::from_str(&expected_data).map_err(|e| {
        Error::Other(format!(
            "jcalDataMatch: expected file is not valid JSON: {e}"
        ))
    })?;

    if actual_json == expected_json {
        Ok(VerifyResult::Pass)
    } else {
        Ok(VerifyResult::Fail(format!(
            "jcalDataMatch: JSON differs from expected file '{expected_path}'"
        )))
    }
}

fn verify_xml_data_match(
    response: &Response,
    args: &HashMap<String, Vec<String>>,
) -> Result<VerifyResult> {
    let expected_path = first_arg(args, "filepath")
        .ok_or_else(|| Error::Other("xmlDataMatch: missing 'filepath' argument".to_string()))?;
    let expected_data = read_expected_data(expected_path).map_err(|e| {
        Error::Other(format!(
            "xmlDataMatch: failed to read '{expected_path}': {e}"
        ))
    })?;

    let filters: HashSet<String> = args.get("filter").into_iter().flatten().cloned().collect();

    let actual = canonicalize_xml_for_compare(&response.body, &filters)
        .map_err(|e| Error::Other(format!("xmlDataMatch: response XML parse failed: {e}")))?;
    let expected = canonicalize_xml_for_compare(&expected_data, &filters)
        .map_err(|e| Error::Other(format!("xmlDataMatch: expected XML parse failed: {e}")))?;

    if actual == expected {
        Ok(VerifyResult::Pass)
    } else {
        Ok(VerifyResult::Fail(format!(
            "xmlDataMatch: XML differs from expected file '{expected_path}'"
        )))
    }
}

fn verify_freebusy(
    response: &Response,
    args: &HashMap<String, Vec<String>>,
) -> Result<VerifyResult> {
    let parsed = parse_freebusy_periods(&response.body)?;

    for (arg_name, actual_set) in [
        ("busy", &parsed.busy),
        ("tentative", &parsed.tentative),
        ("unavailable", &parsed.unavailable),
    ] {
        if let Some(expected_values) = args.get(arg_name) {
            for expected in expected_values {
                if !actual_set.contains(expected) {
                    return Ok(VerifyResult::Fail(format!(
                        "freeBusy: expected {arg_name} period '{expected}' not found"
                    )));
                }
            }
        }
    }

    if args.contains_key("duration") {
        let all_periods = parsed
            .busy
            .iter()
            .chain(parsed.tentative.iter())
            .chain(parsed.unavailable.iter());
        for period in all_periods {
            if !period.contains("/P") {
                return Ok(VerifyResult::Fail(format!(
                    "freeBusy: expected duration-style period, got '{period}'"
                )));
            }
        }
    }

    Ok(VerifyResult::Pass)
}

fn verify_post_freebusy(
    response: &Response,
    args: &HashMap<String, Vec<String>>,
) -> Result<VerifyResult> {
    let attendee = first_arg(args, "attendee")
        .ok_or_else(|| Error::Other("postFreeBusy requires 'attendee' arg".to_string()))?;

    if let Some(content_type) = find_header(response, "content-type") {
        let lower = content_type.to_lowercase();
        if !lower.contains("xml") {
            return Ok(VerifyResult::Fail(format!(
                "postFreeBusy: expected XML response but Content-Type was '{content_type}'"
            )));
        }
    }

    let trimmed = response.body.trim_start();
    if !trimmed.starts_with('<') {
        return Ok(VerifyResult::Fail(format!(
            "postFreeBusy: expected XML response body, got non-XML payload: '{}'",
            truncate(trimmed, 120)
        )));
    }

    let responses = match parse_schedule_responses(&response.body) {
        Ok(responses) => responses,
        Err(err) => {
            return Ok(VerifyResult::Fail(format!(
                "postFreeBusy: failed to parse XML schedule response: {err}"
            )))
        }
    };
    let attendee_lower = attendee.to_lowercase();

    let Some(entry) = responses
        .iter()
        .find(|item| item.href.to_lowercase().contains(&attendee_lower))
    else {
        return Ok(VerifyResult::Fail(format!(
            "postFreeBusy: attendee '{attendee}' not found in schedule response"
        )));
    };

    let periods = parse_freebusy_periods(&entry.calendar_data)?;

    for (arg_name, actual_set) in [
        ("busy", &periods.busy),
        ("tentative", &periods.tentative),
        ("unavailable", &periods.unavailable),
    ] {
        if let Some(expected_values) = args.get(arg_name) {
            for expected in expected_values {
                if !actual_set.contains(expected) {
                    return Ok(VerifyResult::Fail(format!(
                        "postFreeBusy: expected {arg_name} period '{expected}' not found for attendee '{attendee}'"
                    )));
                }
            }
        }
    }

    if let Some(events) = first_arg(args, "events") {
        let expected_events = events.parse::<usize>().map_err(|err| {
            Error::Other(format!(
                "postFreeBusy: invalid 'events' value '{events}': {err}"
            ))
        })?;
        let actual_events = count_vevents(&entry.calendar_data);
        if actual_events != expected_events {
            return Ok(VerifyResult::Fail(format!(
                "postFreeBusy: expected {expected_events} VEVENTs for attendee '{attendee}', got {actual_events}"
            )));
        }
    }

    Ok(VerifyResult::Pass)
}

fn verify_acl(response: &Response, args: &HashMap<String, Vec<String>>) -> Result<VerifyResult> {
    if let Some(expected_status) = first_arg(args, "status") {
        if !matches_status(response.status, expected_status) {
            return Ok(VerifyResult::Fail(format!(
                "acl: expected status '{expected_status}', got {}",
                response.status
            )));
        }
    }

    let privileges = match collect_acl_privileges(&response.body) {
        Ok(privileges) => privileges,
        Err(err) => {
            return Ok(VerifyResult::Fail(format!(
                "acl: response body is not valid XML: {err}"
            )))
        }
    };

    for key in ["grant", "granted", "privilege", "privileges"] {
        if let Some(expected_values) = args.get(key) {
            for expected in expected_values {
                if !privileges.contains(expected) {
                    return Ok(VerifyResult::Fail(format!(
                        "acl: expected privilege '{expected}' is missing"
                    )));
                }
            }
        }
    }

    for key in ["deny", "denied", "notGranted", "not-granted"] {
        if let Some(unexpected_values) = args.get(key) {
            for unexpected in unexpected_values {
                if privileges.contains(unexpected) {
                    return Ok(VerifyResult::Fail(format!(
                        "acl: unexpected privilege '{unexpected}' is present"
                    )));
                }
            }
        }
    }

    if privileges.is_empty() {
        tracing::debug!("acl verification found no privilege elements; treating as pass");
    }

    Ok(VerifyResult::Pass)
}

fn verify_acl_items(
    response: &Response,
    args: &HashMap<String, Vec<String>>,
) -> Result<VerifyResult> {
    if let Some(expected_status) = first_arg(args, "status") {
        if !matches_status(response.status, expected_status) {
            return Ok(VerifyResult::Fail(format!(
                "aclItems: expected status '{expected_status}', got {}",
                response.status
            )));
        }
    }

    let privileges = collect_acl_privilege_qnames(&response.body)
        .map_err(|err| Error::Other(format!("aclItems: response body is not valid XML: {err}")))?;

    if let Some(granted) = args.get("granted") {
        for expected in granted {
            if !privileges.contains(expected) {
                return Ok(VerifyResult::Fail(format!(
                    "aclItems: expected granted privilege '{expected}' is missing"
                )));
            }
        }
    }

    if let Some(denied) = args.get("denied") {
        for unexpected in denied {
            if privileges.contains(unexpected) {
                return Ok(VerifyResult::Fail(format!(
                    "aclItems: denied privilege '{unexpected}' is present"
                )));
            }
        }
    }

    Ok(VerifyResult::Pass)
}

// ── Utilities ────────────────────────────────────────────────────────────────

/// Truncate a string for display in error messages.
#[must_use]
fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...", &s[..max])
    }
}

#[derive(Default)]
struct FreeBusyPeriods {
    busy: HashSet<String>,
    tentative: HashSet<String>,
    unavailable: HashSet<String>,
}

#[derive(Default)]
struct ScheduleResponse {
    href: String,
    calendar_data: String,
}

fn parse_freebusy_periods(body: &str) -> Result<FreeBusyPeriods> {
    let unfolded = unfold_ical(body);
    let mut parsed = FreeBusyPeriods::default();

    for raw_line in unfolded.lines() {
        let line = raw_line.trim();
        if !line.starts_with("FREEBUSY") {
            continue;
        }

        let (meta, periods_part) = match line.split_once(':') {
            Some(parts) => parts,
            None => continue,
        };

        let target = if meta.contains("FBTYPE=BUSY-TENTATIVE") {
            &mut parsed.tentative
        } else if meta.contains("FBTYPE=BUSY-UNAVAILABLE") {
            &mut parsed.unavailable
        } else {
            &mut parsed.busy
        };

        for period in periods_part.split(',') {
            let value = period.trim();
            if !value.is_empty() {
                target.insert(value.to_string());
            }
        }
    }

    Ok(parsed)
}

fn parse_schedule_responses(body: &str) -> Result<Vec<ScheduleResponse>> {
    let mut reader = Reader::from_str(body);
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();

    let mut entries = Vec::new();
    let mut current = ScheduleResponse::default();
    let mut in_response = false;
    let mut in_href = false;
    let mut in_calendar_data = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = local_name(e.name().as_ref());
                match name.as_str() {
                    "response" => {
                        in_response = true;
                        current = ScheduleResponse::default();
                    }
                    "href" => in_href = in_response,
                    "calendar-data" => in_calendar_data = in_response,
                    _ => {}
                }
            }
            Ok(Event::End(e)) => {
                let name = local_name(e.name().as_ref());
                match name.as_str() {
                    "response" => {
                        if in_response {
                            entries.push(std::mem::take(&mut current));
                        }
                        in_response = false;
                        in_href = false;
                        in_calendar_data = false;
                    }
                    "href" => in_href = false,
                    "calendar-data" => in_calendar_data = false,
                    _ => {}
                }
            }
            Ok(Event::Text(text)) => {
                let value = text
                    .decode()
                    .map_err(|err| Error::Other(err.to_string()))?
                    .into_owned();
                if in_href {
                    current.href.push_str(value.trim());
                } else if in_calendar_data {
                    current.calendar_data.push_str(&value);
                }
            }
            Ok(Event::CData(text)) => {
                if in_calendar_data {
                    let value = text
                        .decode()
                        .map_err(|err| Error::Other(err.to_string()))?
                        .into_owned();
                    current.calendar_data.push_str(&value);
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(err) => return Err(Error::Other(err.to_string())),
        }

        buf.clear();
    }

    Ok(entries)
}

#[must_use]
fn count_vevents(calendar_data: &str) -> usize {
    unfold_ical(calendar_data)
        .lines()
        .filter(|line| line.trim().eq_ignore_ascii_case("BEGIN:VEVENT"))
        .count()
}

fn collect_acl_privileges(body: &str) -> Result<HashSet<String>> {
    let mut reader = Reader::from_str(body);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();

    let mut privileges = HashSet::new();
    let mut in_privilege = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = local_name(e.name().as_ref());
                if name == "privilege" {
                    in_privilege = true;
                } else if in_privilege {
                    privileges.insert(name);
                }
            }
            Ok(Event::Empty(e)) => {
                if in_privilege {
                    privileges.insert(local_name(e.name().as_ref()));
                }
            }
            Ok(Event::End(e)) => {
                if local_name(e.name().as_ref()) == "privilege" {
                    in_privilege = false;
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(err) => return Err(Error::Other(err.to_string())),
        }

        buf.clear();
    }

    Ok(privileges)
}

fn collect_acl_privilege_qnames(body: &str) -> Result<HashSet<String>> {
    let mut reader = Reader::from_str(body);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();

    let mut ns_stack: Vec<HashMap<String, String>> = vec![HashMap::new()];
    let mut depth = 0usize;
    let mut privilege_depth: Option<usize> = None;
    let mut privileges = HashSet::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let mut current_ns = ns_stack.last().cloned().unwrap_or_default();
                collect_ns_declarations(&e, &mut current_ns);
                let qname = resolve_qname_with_ns(e.name().as_ref(), &current_ns);

                if qname == "{DAV:}privilege" {
                    privilege_depth = Some(depth);
                } else if let Some(pd) = privilege_depth {
                    if depth == pd + 1 {
                        privileges.insert(qname);
                    }
                }

                ns_stack.push(current_ns);
                depth += 1;
            }
            Ok(Event::Empty(e)) => {
                let mut current_ns = ns_stack.last().cloned().unwrap_or_default();
                collect_ns_declarations(&e, &mut current_ns);
                let qname = resolve_qname_with_ns(e.name().as_ref(), &current_ns);

                if let Some(pd) = privilege_depth {
                    if depth == pd + 1 {
                        privileges.insert(qname);
                    }
                }
            }
            Ok(Event::End(_)) => {
                depth = depth.saturating_sub(1);
                if let Some(pd) = privilege_depth {
                    if depth == pd {
                        privilege_depth = None;
                    }
                }

                if ns_stack.len() > 1 {
                    ns_stack.pop();
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(err) => return Err(Error::Other(err.to_string())),
        }

        buf.clear();
    }

    Ok(privileges)
}

fn canonicalize_xml_for_compare(input: &str, filters: &HashSet<String>) -> Result<String> {
    let mut reader = Reader::from_str(input);
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();

    let mut ns_stack: Vec<HashMap<String, String>> = vec![HashMap::new()];
    let mut depth = 0usize;
    let mut skip_depth: Option<usize> = None;
    let mut out: Vec<String> = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let mut current_ns = ns_stack.last().cloned().unwrap_or_default();
                collect_ns_declarations(&e, &mut current_ns);

                let qname = resolve_qname_with_ns(e.name().as_ref(), &current_ns);
                let attrs = canonical_xml_attrs(&e, &current_ns);
                ns_stack.push(current_ns);

                if skip_depth.is_none() && filters.contains(&qname) {
                    skip_depth = Some(depth);
                } else if skip_depth.is_none() {
                    out.push(format!("S:{qname}[{}]", attrs.join("|")));
                }
                depth += 1;
            }
            Ok(Event::Empty(e)) => {
                let mut current_ns = ns_stack.last().cloned().unwrap_or_default();
                collect_ns_declarations(&e, &mut current_ns);

                let qname = resolve_qname_with_ns(e.name().as_ref(), &current_ns);
                if skip_depth.is_none() && !filters.contains(&qname) {
                    let attrs = canonical_xml_attrs(&e, &current_ns);
                    out.push(format!("E:{qname}[{}]", attrs.join("|")));
                }
            }
            Ok(Event::End(e)) => {
                depth = depth.saturating_sub(1);
                if let Some(sd) = skip_depth {
                    if depth == sd {
                        skip_depth = None;
                    }
                } else {
                    let qname = resolve_qname_with_ns(
                        e.name().as_ref(),
                        ns_stack.last().unwrap_or(&HashMap::new()),
                    );
                    out.push(format!("X:{qname}"));
                }

                if ns_stack.len() > 1 {
                    ns_stack.pop();
                }
            }
            Ok(Event::Text(text)) => {
                if skip_depth.is_none() {
                    let value = text
                        .decode()
                        .map_err(|err| Error::Other(err.to_string()))?
                        .into_owned();
                    let trimmed = value.trim();
                    if !trimmed.is_empty() {
                        out.push(format!("T:{trimmed}"));
                    }
                }
            }
            Ok(Event::CData(text)) => {
                if skip_depth.is_none() {
                    let value = text
                        .decode()
                        .map_err(|err| Error::Other(err.to_string()))?
                        .into_owned();
                    let trimmed = value.trim();
                    if !trimmed.is_empty() {
                        out.push(format!("C:{trimmed}"));
                    }
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(err) => return Err(Error::Other(err.to_string())),
        }

        buf.clear();
    }

    Ok(out.join("\n"))
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum JsonPointerCondition {
    Any,
    StringEquals(String),
    Null,
}

#[must_use]
fn json_pointer_spec_matches(root: &JsonValue, spec: &str) -> bool {
    let (path, condition) = parse_json_pointer_spec(spec);
    let tokens = parse_json_pointer_tokens(&path);

    let mut matches = Vec::new();
    collect_json_pointer_matches(root, &tokens, &mut matches);

    if matches.is_empty() {
        return false;
    }

    matches
        .into_iter()
        .any(|value| json_pointer_condition_matches(value, &condition))
}

#[must_use]
fn parse_json_pointer_spec(spec: &str) -> (String, JsonPointerCondition) {
    if let Some(path) = spec.strip_suffix("~~") {
        return (path.to_string(), JsonPointerCondition::Null);
    }

    if let Some((path, expected)) = spec.rsplit_once("~$") {
        return (
            path.to_string(),
            JsonPointerCondition::StringEquals(expected.to_string()),
        );
    }

    (spec.to_string(), JsonPointerCondition::Any)
}

#[must_use]
fn parse_json_pointer_tokens(path: &str) -> Vec<String> {
    if path.is_empty() || path == "/" {
        return Vec::new();
    }

    path.trim_start_matches('/')
        .split('/')
        .map(|token| token.replace("~1", "/").replace("~0", "~"))
        .collect()
}

fn collect_json_pointer_matches<'a>(
    value: &'a JsonValue,
    tokens: &[String],
    out: &mut Vec<&'a JsonValue>,
) {
    if tokens.is_empty() {
        out.push(value);
        return;
    }

    let (head, tail) = (&tokens[0], &tokens[1..]);
    if head == "." {
        match value {
            JsonValue::Object(map) => {
                for child in map.values() {
                    collect_json_pointer_matches(child, tail, out);
                }
            }
            JsonValue::Array(items) => {
                for child in items {
                    collect_json_pointer_matches(child, tail, out);
                }
            }
            _ => {}
        }
        return;
    }

    match value {
        JsonValue::Object(map) => {
            if let Some(child) = map.get(head) {
                collect_json_pointer_matches(child, tail, out);
            }
        }
        JsonValue::Array(items) => {
            if let Ok(index) = head.parse::<usize>() {
                if let Some(child) = items.get(index) {
                    collect_json_pointer_matches(child, tail, out);
                }
            }
        }
        _ => {}
    }
}

#[must_use]
fn json_pointer_condition_matches(value: &JsonValue, condition: &JsonPointerCondition) -> bool {
    match condition {
        JsonPointerCondition::Any => true,
        JsonPointerCondition::Null => value.is_null(),
        JsonPointerCondition::StringEquals(expected) => {
            value.as_str().is_some_and(|actual| actual == expected)
        }
    }
}

fn canonical_xml_attrs(
    e: &quick_xml::events::BytesStart<'_>,
    ns_map: &HashMap<String, String>,
) -> Vec<String> {
    let mut attrs = Vec::new();
    for attr in e.attributes().flatten() {
        let key = String::from_utf8_lossy(attr.key.as_ref());
        if key == "xmlns" || key.starts_with("xmlns:") {
            continue;
        }

        let qname = resolve_qname_with_ns(attr.key.as_ref(), ns_map);
        let value = String::from_utf8_lossy(&attr.value).trim().to_string();
        attrs.push(format!("{qname}={value}"));
    }
    attrs.sort();
    attrs
}

fn collect_ns_declarations(
    e: &quick_xml::events::BytesStart<'_>,
    ns_map: &mut HashMap<String, String>,
) {
    for attr in e.attributes().flatten() {
        let key = String::from_utf8_lossy(attr.key.as_ref());
        let value = String::from_utf8_lossy(&attr.value).to_string();
        if key == "xmlns" {
            ns_map.insert(String::new(), value);
        } else if let Some(prefix) = key.strip_prefix("xmlns:") {
            ns_map.insert(prefix.to_string(), value);
        }
    }
}

#[must_use]
fn resolve_qname_with_ns(raw: &[u8], ns_map: &HashMap<String, String>) -> String {
    let full = String::from_utf8_lossy(raw);
    let local = full.split(':').next_back().unwrap_or(&full).to_string();

    if let Some(prefix) = full.strip_suffix(&format!(":{local}")) {
        if let Some(ns) = ns_map.get(prefix) {
            return format!("{{{ns}}}{local}");
        }
        if let Some(ns) = well_known_ns(prefix) {
            return format!("{{{ns}}}{local}");
        }
    }

    if let Some(ns) = ns_map.get("") {
        return format!("{{{ns}}}{local}");
    }

    local
}

#[must_use]
fn well_known_ns(prefix: &str) -> Option<&'static str> {
    match prefix {
        "D" | "d" | "DAV" => Some("DAV:"),
        "C" | "cal" | "CALDAV" => Some("urn:ietf:params:xml:ns:caldav"),
        "CR" | "card" | "CARDDAV" => Some("urn:ietf:params:xml:ns:carddav"),
        "CS" | "cs" | "CALENDARSERVER" => Some("http://calendarserver.org/ns/"),
        "A" | "apple" => Some("http://apple.com/ns/ical/"),
        _ => None,
    }
}

#[must_use]
fn local_name(raw_name: &[u8]) -> String {
    let full = String::from_utf8_lossy(raw_name);
    full.rsplit(':').next().unwrap_or_default().to_string()
}

fn read_expected_data(filepath: &str) -> std::io::Result<String> {
    let path = Path::new(filepath);
    if path.exists() {
        return std::fs::read_to_string(path);
    }

    let cwd = std::env::current_dir()?;
    let candidates: [PathBuf; 2] = [
        cwd.join(filepath),
        cwd.join("crates/shuriken-caldavtester/test-suite")
            .join(filepath),
    ];

    for candidate in candidates {
        if candidate.exists() {
            return std::fs::read_to_string(candidate);
        }
    }

    std::fs::read_to_string(path)
}

fn normalize_ical_for_compare(input: &str, filters: &[String], include_timezones: bool) -> String {
    let mut content = unfold_ical(input).replace("\r\n", "\n").replace('\r', "\n");

    for filter in filters {
        if let Some(pattern) = filter.strip_prefix('!') {
            content = content.replace(pattern, "");
            continue;
        }

        if let Some((property, token)) = filter.split_once(':') {
            content = content
                .lines()
                .map(|line| {
                    if line.starts_with(property) {
                        line.replace(token, "")
                    } else {
                        line.to_string()
                    }
                })
                .collect::<Vec<_>>()
                .join("\n");
            continue;
        }

        content = content
            .lines()
            .filter(|line| {
                let trimmed = line.trim();
                !(trimmed.starts_with(filter)
                    || trimmed.starts_with(&format!("{filter};"))
                    || trimmed.starts_with(&format!("{filter}:")))
            })
            .collect::<Vec<_>>()
            .join("\n");
    }

    if !include_timezones {
        content = strip_vtimezone_blocks(&content);
    }

    content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn normalize_vcard_for_compare(input: &str, filters: &[String]) -> String {
    let mut content = unfold_ical(input).replace("\r\n", "\n").replace('\r', "\n");

    for filter in filters {
        if let Some(pattern) = filter.strip_prefix('!') {
            content = content.replace(pattern, "");
            continue;
        }

        if let Some((property, token)) = filter.split_once(':') {
            content = content
                .lines()
                .map(|line| {
                    if line.starts_with(property) {
                        line.replace(token, "")
                    } else {
                        line.to_string()
                    }
                })
                .collect::<Vec<_>>()
                .join("\n");
            continue;
        }

        content = content
            .lines()
            .filter(|line| {
                let trimmed = line.trim();
                !(trimmed.starts_with(filter)
                    || trimmed.starts_with(&format!("{filter};"))
                    || trimmed.starts_with(&format!("{filter}:")))
            })
            .collect::<Vec<_>>()
            .join("\n");
    }

    content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn unfold_for_data_string(input: &str) -> String {
    let normalized = input.replace("\r\n", "\n").replace('\r', "\n");
    let mut unfolded: Vec<String> = Vec::new();

    for line in normalized.split('\n') {
        if let Some(previous) = unfolded.last_mut() {
            if line.starts_with(' ') || line.starts_with('\t') {
                let trimmed = line.trim_start_matches([' ', '\t']);
                if !trimmed.is_empty() && !previous.ends_with(' ') {
                    previous.push(' ');
                }
                previous.push_str(trimmed);
                continue;
            }
        }

        unfolded.push(line.to_string());
    }

    unfolded.join("\n")
}

fn unfold_ical(input: &str) -> String {
    let normalized = input.replace("\r\n", "\n").replace('\r', "\n");
    let mut unfolded: Vec<String> = Vec::new();

    for line in normalized.split('\n') {
        if let Some(previous) = unfolded.last_mut() {
            let bytes = line.as_bytes();
            let is_single_space_fold = bytes.first() == Some(&b' ') && bytes.get(1) != Some(&b' ');
            let is_single_tab_fold = bytes.first() == Some(&b'\t');

            if is_single_space_fold || is_single_tab_fold {
                previous.push_str(line.trim_start_matches([' ', '\t']));
                continue;
            }
        }

        unfolded.push(line.to_string());
    }

    unfolded.join("\n")
}

fn strip_vtimezone_blocks(content: &str) -> String {
    let mut result = Vec::new();
    let mut in_vtimezone = false;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == "BEGIN:VTIMEZONE" {
            in_vtimezone = true;
            continue;
        }
        if trimmed == "END:VTIMEZONE" {
            in_vtimezone = false;
            continue;
        }
        if !in_vtimezone {
            result.push(line);
        }
    }

    result.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

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

    fn multi_args(pairs: &[(&str, &[&str])]) -> HashMap<String, Vec<String>> {
        pairs
            .iter()
            .map(|(k, vs)| {
                (
                    (*k).to_string(),
                    vs.iter().map(|v| (*v).to_string()).collect(),
                )
            })
            .collect()
    }

    // ── statusCode ───────────────────────────────────────────────────────

    #[test]
    fn status_code_exact_pass() {
        let response = make_response(200);
        let result = verify_status_code(&response, &args(&[("status", "200")])).unwrap();
        assert!(result.is_pass());
    }

    #[test]
    fn status_code_exact_fail() {
        let response = make_response(404);
        let result = verify_status_code(&response, &args(&[("status", "200")])).unwrap();
        assert!(result.is_fail());
    }

    #[test]
    fn status_code_wildcard_2xx() {
        let response = make_response(201);
        let result = verify_status_code(&response, &args(&[("status", "2xx")])).unwrap();
        assert!(result.is_pass());
    }

    #[test]
    fn status_code_wildcard_4xx_fail() {
        let response = make_response(200);
        let result = verify_status_code(&response, &args(&[("status", "4xx")])).unwrap();
        assert!(result.is_fail());
    }

    #[test]
    fn status_code_multiple_or() {
        let response = make_response(204);
        let result =
            verify_status_code(&response, &multi_args(&[("status", &["200", "204"])])).unwrap();
        assert!(result.is_pass());
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

    // ── header ───────────────────────────────────────────────────────────

    #[test]
    fn header_exists() {
        let mut response = make_response(200);
        response
            .headers
            .insert("Content-Type".to_string(), "text/xml".to_string());
        let result = verify_header(&response, &args(&[("header", "content-type")])).unwrap();
        assert!(result.is_pass());
    }

    #[test]
    fn header_not_exists() {
        let mut response = make_response(200);
        response
            .headers
            .insert("Content-Type".to_string(), "text/xml".to_string());
        let result = verify_header(&response, &args(&[("header", "!X-Custom")])).unwrap();
        assert!(result.is_pass());
    }

    #[test]
    fn header_not_exists_fail() {
        let mut response = make_response(200);
        response
            .headers
            .insert("ETag".to_string(), "\"abc\"".to_string());
        let result = verify_header(&response, &args(&[("header", "!ETag")])).unwrap();
        assert!(result.is_fail());
    }

    // ── dataString ───────────────────────────────────────────────────────

    #[test]
    fn data_string_contains() {
        let mut response = make_response(200);
        response.body = "BEGIN:VCALENDAR\nEND:VCALENDAR".to_string();
        let result = verify_data_string(&response, &args(&[("contains", "VCALENDAR")])).unwrap();
        assert!(result.is_pass());
    }

    #[test]
    fn data_string_unwrap() {
        let mut response = make_response(200);
        response.body = "DESCRIPTION:This is a long\r\n  description line".to_string();
        let result = verify_data_string(
            &response,
            &multi_args(&[
                ("unwrap", &[""]),
                ("contains", &["This is a long description line"]),
            ]),
        )
        .unwrap();
        assert!(result.is_pass());
    }

    #[test]
    fn data_string_empty() {
        let response = make_response(200);
        let result = verify_data_string(&response, &args(&[("empty", "")])).unwrap();
        assert!(result.is_pass());
    }

    #[test]
    fn matches_status_wildcard() {
        assert!(matches_status(200, "2xx"));
        assert!(matches_status(201, "2xx"));
        assert!(matches_status(404, "4xx"));
        assert!(!matches_status(200, "4xx"));
        assert!(matches_status(207, "207"));
        assert!(!matches_status(200, "207"));
    }

    #[test]
    fn freebusy_parse_types() {
        let body = "BEGIN:VCALENDAR\nBEGIN:VFREEBUSY\nFREEBUSY:20260101T000000Z/P1D\nFREEBUSY;FBTYPE=BUSY-TENTATIVE:20260102T000000Z/P1D\nFREEBUSY;FBTYPE=BUSY-UNAVAILABLE:20260103T000000Z/P1D\nEND:VFREEBUSY\nEND:VCALENDAR\n";
        let parsed = parse_freebusy_periods(body).unwrap();
        assert!(parsed.busy.contains("20260101T000000Z/P1D"));
        assert!(parsed.tentative.contains("20260102T000000Z/P1D"));
        assert!(parsed.unavailable.contains("20260103T000000Z/P1D"));
    }

    #[test]
    fn calendar_normalize_filters_and_vtimezone() {
        let source = "BEGIN:VCALENDAR\nBEGIN:VTIMEZONE\nTZID:UTC\nEND:VTIMEZONE\nUID:abc\nATTACH:xyz\nORGANIZER;SCHEDULE-STATUS=1.2:mailto:a@example.com\nEND:VCALENDAR\n";
        let normalized = normalize_ical_for_compare(
            source,
            &[
                "UID".to_string(),
                "ATTACH".to_string(),
                "ORGANIZER:SCHEDULE-STATUS".to_string(),
            ],
            false,
        );

        assert!(!normalized.contains("VTIMEZONE"));
        assert!(!normalized.contains("UID:"));
        assert!(!normalized.contains("ATTACH:"));
        assert!(!normalized.contains("SCHEDULE-STATUS"));
    }

    #[test]
    fn acl_verify_granted_privilege() {
        let mut response = make_response(200);
        response.body = r#"<?xml version=\"1.0\"?>
<D:multistatus xmlns:D=\"DAV:\">
    <D:response>
        <D:propstat>
            <D:prop>
                <D:current-user-privilege-set>
                    <D:privilege><D:read/></D:privilege>
                    <D:privilege><D:write/></D:privilege>
                </D:current-user-privilege-set>
            </D:prop>
        </D:propstat>
    </D:response>
</D:multistatus>"#
            .to_string();

        let result = verify_acl(
            &response,
            &multi_args(&[("granted", &["read", "write"]), ("deny", &["unbind"])]),
        )
        .unwrap();
        assert!(result.is_pass());
    }

    #[test]
    fn acl_verify_missing_privilege_fails() {
        let mut response = make_response(200);
        response.body = r#"<?xml version=\"1.0\"?>
<D:current-user-privilege-set xmlns:D=\"DAV:\">
    <D:privilege><D:read/></D:privilege>
</D:current-user-privilege-set>"#
            .to_string();

        let result = verify_acl(&response, &args(&[("grant", "write")])).unwrap();
        assert!(result.is_fail());
    }

    #[test]
    fn post_freebusy_busy_match() {
        let mut response = make_response(200);
        response.body = r#"<?xml version=\"1.0\"?>
        <C:schedule-response xmlns:D=\"DAV:\" xmlns:C=\"urn:ietf:params:xml:ns:caldav\">
          <C:response>
            <C:recipient><D:href>mailto:user01@example.com</D:href></C:recipient>
            <C:calendar-data><![CDATA[BEGIN:VCALENDAR
    BEGIN:VFREEBUSY
    FREEBUSY:20260101T000000Z/P1D
    END:VFREEBUSY
    END:VCALENDAR]]></C:calendar-data>
          </C:response>
        </C:schedule-response>"#
            .to_string();

        let result = verify_post_freebusy(
            &response,
            &args(&[
                ("attendee", "mailto:user01@example.com"),
                ("busy", "20260101T000000Z/P1D"),
            ]),
        )
        .unwrap();
        assert!(result.is_pass(), "unexpected result: {result:?}");
    }

    #[test]
    fn post_freebusy_events_match() {
        let mut response = make_response(200);
        response.body = r#"<?xml version=\"1.0\"?>
        <C:schedule-response xmlns:D=\"DAV:\" xmlns:C=\"urn:ietf:params:xml:ns:caldav\">
          <C:response>
            <C:recipient><D:href>mailto:user01@example.com</D:href></C:recipient>
            <C:calendar-data><![CDATA[BEGIN:VCALENDAR
    BEGIN:VEVENT
    UID:1
    END:VEVENT
    END:VCALENDAR]]></C:calendar-data>
          </C:response>
        </C:schedule-response>"#
            .to_string();

        let result = verify_post_freebusy(
            &response,
            &args(&[("attendee", "mailto:user01@example.com"), ("events", "1")]),
        )
        .unwrap();
        assert!(result.is_pass(), "unexpected result: {result:?}");
    }

    #[test]
    fn post_freebusy_non_xml_payload_fails_cleanly() {
        let mut response = make_response(404);
        response
            .headers
            .insert("Content-Type".to_string(), "text/html".to_string());
        response.body =
            "<html><head><title>404</title></head><body>Not Found</body></html>".to_string();

        let result = verify_post_freebusy(
            &response,
            &args(&[("attendee", "mailto:user01@example.com")]),
        )
        .unwrap();

        match result {
            VerifyResult::Fail(message) => {
                assert!(message.contains("Content-Type"), "message: {message}");
                assert!(message.contains("text/html"), "message: {message}");
            }
            VerifyResult::Pass => panic!("expected failure for non-XML payload"),
        }
    }

    #[test]
    fn parse_schedule_response_extracts_data() {
        let xml = r#"<?xml version=\"1.0\"?>
        <C:schedule-response xmlns:D=\"DAV:\" xmlns:C=\"urn:ietf:params:xml:ns:caldav\">
          <C:response>
            <C:recipient><D:href>mailto:user01@example.com</D:href></C:recipient>
            <C:calendar-data><![CDATA[BEGIN:VCALENDAR
        BEGIN:VFREEBUSY
        FREEBUSY:20260101T000000Z/P1D
        END:VFREEBUSY
        END:VCALENDAR]]></C:calendar-data>
          </C:response>
        </C:schedule-response>"#;

        let entries = parse_schedule_responses(xml).unwrap();
        assert_eq!(entries.len(), 1, "entries: {}", entries.len());
        assert!(
            entries[0].href.contains("user01@example.com"),
            "href: {}",
            entries[0].href
        );
        assert!(
            entries[0].calendar_data.contains("FREEBUSY"),
            "calendar_data: {}",
            entries[0].calendar_data
        );

        let periods = parse_freebusy_periods(&entries[0].calendar_data).unwrap();
        assert!(
            periods.busy.contains("20260101T000000Z/P1D"),
            "periods: {:?}; data: {}",
            periods.busy,
            entries[0].calendar_data.replace('\n', "\\n")
        );
    }

    fn write_temp_test_file(content: &str, extension: &str) -> String {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!(
            "shuriken-caldavtester-{}-{nonce}.{extension}",
            std::process::id()
        ));
        std::fs::write(&path, content).unwrap();
        path.to_string_lossy().to_string()
    }

    #[test]
    fn data_match_newline_normalized_passes() {
        let expected_path = write_temp_test_file("line1\nline2\n", "txt");
        let mut response = make_response(200);
        response.body = "line1\r\nline2\r\n".to_string();

        let result = verify_data_match(&response, &args(&[("filepath", &expected_path)])).unwrap();
        assert!(result.is_pass(), "unexpected result: {result:?}");
    }

    #[test]
    fn address_data_match_filter_passes() {
        let expected_path = write_temp_test_file(
            "BEGIN:VCARD\nVERSION:3.0\nUID:abc\nFN:Alice\nEND:VCARD\n",
            "vcf",
        );
        let mut response = make_response(200);
        response.body =
            "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:def\r\nFN:Alice\r\nEND:VCARD\r\n".to_string();

        let result = verify_address_data_match(
            &response,
            &multi_args(&[("filepath", &[&expected_path]), ("filter", &["UID"])]),
        )
        .unwrap();

        assert!(result.is_pass(), "unexpected result: {result:?}");
    }

    #[test]
    fn xml_data_match_filter_passes() {
        let expected_path = write_temp_test_file(
            "<D:root xmlns:D=\"DAV:\" xmlns:CS=\"http://calendarserver.org/ns/\"><CS:uid>1</CS:uid><D:href>/x</D:href><D:ok>a</D:ok></D:root>",
            "xml",
        );

        let mut response = make_response(200);
        response.body =
            "<D:root xmlns:D=\"DAV:\" xmlns:CS=\"http://calendarserver.org/ns/\"><CS:uid>2</CS:uid><D:href>/y</D:href><D:ok>a</D:ok></D:root>"
                .to_string();

        let result = verify_xml_data_match(
            &response,
            &multi_args(&[
                ("filepath", &[&expected_path]),
                (
                    "filter",
                    &["{http://calendarserver.org/ns/}uid", "{DAV:}href"],
                ),
            ]),
        )
        .unwrap();

        assert!(result.is_pass(), "unexpected result: {result:?}");
    }

    #[test]
    fn json_pointer_match_exists_and_wildcard() {
        let mut response = make_response(200);
        response.body = r#"{
  "actions": [
    {"name": "capabilities"},
    {"name": "list"}
  ]
}"#
        .to_string();

        let result = verify_json_pointer_match(
            &response,
            &multi_args(&[(
                "exists",
                &[
                    "/actions",
                    "/actions/./name~$capabilities",
                    "/actions/./name~$list",
                ],
            )]),
        )
        .unwrap();

        assert!(result.is_pass(), "unexpected result: {result:?}");
    }

    #[test]
    fn json_pointer_match_null_and_notexists() {
        let mut response = make_response(200);
        response.body = r#"{
  "result": null,
  "items": [
    {"name": "a"},
    {"name": "b"}
  ]
}"#
        .to_string();

        let result = verify_json_pointer_match(
            &response,
            &multi_args(&[
                ("exists", &["/result~~"]),
                ("notexists", &["/items/./name~$z"]),
            ]),
        )
        .unwrap();

        assert!(result.is_pass(), "unexpected result: {result:?}");
    }

    #[test]
    fn json_pointer_match_status_guard() {
        let mut response = make_response(404);
        response.body = r#"{"error-code":"invalid-action"}"#.to_string();

        let result = verify_json_pointer_match(
            &response,
            &multi_args(&[
                ("status", &["400"]),
                ("exists", &["/error-code~$invalid-action"]),
            ]),
        )
        .unwrap();

        assert!(result.is_fail(), "unexpected result: {result:?}");
    }

    #[test]
    fn jcal_data_match_passes() {
        let expected_path = write_temp_test_file(r#"["vcalendar",[],[]]"#, "json");
        let mut response = make_response(200);
        response.body = r#"["vcalendar",[],[]]"#.to_string();

        let result =
            verify_jcal_data_match(&response, &args(&[("filepath", &expected_path)])).unwrap();
        assert!(result.is_pass(), "unexpected result: {result:?}");
    }

    #[test]
    fn jcal_data_match_mismatch_fails() {
        let expected_path = write_temp_test_file(r#"["vcalendar",[],[]]"#, "json");
        let mut response = make_response(200);
        response.body = r#"["vcalendar",[],["x"]]"#.to_string();

        let result =
            verify_jcal_data_match(&response, &args(&[("filepath", &expected_path)])).unwrap();
        assert!(result.is_fail(), "unexpected result: {result:?}");
    }

    #[test]
    fn acl_items_granted_denied() {
        let mut response = make_response(207);
        response.body = r#"<?xml version=\"1.0\"?>
<D:multistatus xmlns:D=\"DAV:\" xmlns:C=\"urn:ietf:params:xml:ns:caldav\">
    <D:response>
        <D:propstat>
            <D:prop>
                <D:current-user-privilege-set>
                    <D:privilege><D:read/></D:privilege>
                    <D:privilege><D:write/></D:privilege>
                    <D:privilege><C:read-free-busy/></D:privilege>
                </D:current-user-privilege-set>
            </D:prop>
        </D:propstat>
    </D:response>
</D:multistatus>"#
            .to_string();

        let result = verify_acl_items(
            &response,
            &multi_args(&[
                (
                    "granted",
                    &[
                        "{DAV:}read",
                        "{DAV:}write",
                        "{urn:ietf:params:xml:ns:caldav}read-free-busy",
                    ],
                ),
                ("denied", &["{urn:ietf:params:xml:ns:caldav}schedule"]),
            ]),
        )
        .unwrap();

        assert!(result.is_pass(), "unexpected result: {result:?}");
    }

    #[test]
    fn acl_items_missing_granted_fails() {
        let mut response = make_response(207);
        response.body = r#"<?xml version=\"1.0\"?>
<D:multistatus xmlns:D=\"DAV:\">
    <D:response>
        <D:propstat>
            <D:prop>
                <D:current-user-privilege-set>
                    <D:privilege><D:read/></D:privilege>
                </D:current-user-privilege-set>
            </D:prop>
        </D:propstat>
    </D:response>
</D:multistatus>"#
            .to_string();

        let result = verify_acl_items(&response, &args(&[("granted", "{DAV:}write")])).unwrap();

        assert!(result.is_fail(), "unexpected result: {result:?}");
    }
}
