//! `prepostcondition` verification callback.
//!
//! Verifies that a `DAV:error` response contains expected pre/post-condition
//! error codes as child elements.
//!
//! ## Arg format
//!
//! - `error` — List of expected error QNames (e.g., `{DAV:}lock-token-submitted`)
//! - `status` — Expected HTTP status codes (default `["403", "409", "507"]`)
//! - `ignoreextras` — If present, allow extra error children beyond expected

use super::{Response, VerifyResult};
use crate::error::Result;
use quick_xml::events::Event;
use quick_xml::Reader;
use std::collections::{HashMap, HashSet};

/// Verify pre/post-condition error response.
pub fn verify(
    response: &Response,
    args: &HashMap<String, Vec<String>>,
) -> Result<VerifyResult> {
    // Check status code
    let allowed_statuses = args
        .get("status")
        .cloned()
        .unwrap_or_else(|| vec!["403".to_string(), "409".to_string(), "507".to_string()]);

    let status_str = response.status.to_string();
    if !allowed_statuses.iter().any(|s| s == &status_str) {
        return Ok(VerifyResult::Fail(format!(
            "prepostcondition: expected status {}, got {}",
            allowed_statuses.join("|"),
            response.status
        )));
    }

    // Parse the error element children
    let actual_errors = match parse_error_children(&response.body) {
        Ok(errors) => errors,
        Err(e) => {
            return Ok(VerifyResult::Fail(format!(
                "prepostcondition: failed to parse error XML: {e}"
            )));
        }
    };

    // Check expected error codes
    if let Some(expected_errors) = args.get("error") {
        for expected in expected_errors {
            if !actual_errors.contains(expected) {
                return Ok(VerifyResult::Fail(format!(
                    "prepostcondition: expected error '{expected}' not found. Actual: {actual_errors:?}"
                )));
            }
        }

        // If ignoreextras is not set, check that there are no extras
        if !args.contains_key("ignoreextras") {
            let expected_set: HashSet<&str> =
                expected_errors.iter().map(String::as_str).collect();
            let extras: Vec<&str> = actual_errors
                .iter()
                .filter(|e| !expected_set.contains(e.as_str()))
                .map(String::as_str)
                .collect();
            if !extras.is_empty() {
                return Ok(VerifyResult::Fail(format!(
                    "prepostcondition: unexpected extra errors: {extras:?}"
                )));
            }
        }
    }

    Ok(VerifyResult::Pass)
}

/// Parse the child element QNames from a `DAV:error` root element.
///
/// Returns a list of `{namespace}localname` strings for each direct child.
fn parse_error_children(body: &str) -> std::result::Result<Vec<String>, String> {
    let mut reader = Reader::from_str(body);
    reader.config_mut().trim_text(true);

    let mut buf = Vec::new();
    let mut in_error = false;
    let mut error_depth = 0u32;
    let mut depth = 0u32;
    let mut children = Vec::new();

    // Track namespace declarations
    let mut ns_map: HashMap<String, String> = HashMap::new();

    loop {
        buf.clear();
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                depth += 1;
                let tag = local_name(e.name().as_ref());

                // Collect namespace declarations
                collect_namespaces(e, &mut ns_map);

                if tag == "error" && !in_error {
                    in_error = true;
                    error_depth = depth;
                } else if in_error && depth == error_depth + 1 {
                    // Direct child of <error>
                    let qname = resolve_qname(e.name().as_ref(), &ns_map);
                    children.push(qname);
                }
            }
            Ok(Event::Empty(ref e)) => {
                let tag = local_name(e.name().as_ref());

                // Collect namespace declarations
                collect_namespaces(e, &mut ns_map);

                if tag == "error" && !in_error {
                    // Empty error element — no children
                    return Ok(children);
                }

                if in_error && depth == error_depth {
                    // Direct child of <error> (self-closing)
                    let qname = resolve_qname(e.name().as_ref(), &ns_map);
                    children.push(qname);
                }
            }
            Ok(Event::End(_)) => {
                if in_error && depth == error_depth {
                    in_error = false;
                }
                depth -= 1;
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML parse error: {e}")),
            _ => {}
        }
    }

    Ok(children)
}

/// Collect xmlns declarations from an element.
fn collect_namespaces(
    e: &quick_xml::events::BytesStart<'_>,
    ns_map: &mut HashMap<String, String>,
) {
    for attr in e.attributes().flatten() {
        let key = String::from_utf8_lossy(attr.key.as_ref());
        let val = String::from_utf8_lossy(&attr.value);

        if key == "xmlns" {
            ns_map.insert(String::new(), val.to_string());
        } else if let Some(prefix) = key.strip_prefix("xmlns:") {
            ns_map.insert(prefix.to_string(), val.to_string());
        }
    }
}

/// Resolve a tag name to `{namespace}localname` using the namespace map.
fn resolve_qname(raw: &[u8], ns_map: &HashMap<String, String>) -> String {
    let full = String::from_utf8_lossy(raw);
    let local = local_name(raw);

    // Check for prefix
    if let Some(prefix) = full.strip_suffix(&format!(":{local}")) {
        if let Some(ns) = ns_map.get(prefix) {
            return format!("{{{ns}}}{local}");
        }
        // Fall back to well-known
        if let Some(ns) = well_known_ns(prefix) {
            return format!("{{{ns}}}{local}");
        }
    }

    // No prefix — check default namespace
    if let Some(ns) = ns_map.get("") {
        return format!("{{{ns}}}{local}");
    }

    local
}

/// Extract local name from a possibly prefixed tag.
fn local_name(raw: &[u8]) -> String {
    let full = String::from_utf8_lossy(raw);
    full.split(':')
        .next_back()
        .unwrap_or(&full)
        .to_string()
}

/// Well-known namespace prefix mappings.
fn well_known_ns(prefix: &str) -> Option<&'static str> {
    match prefix {
        "D" | "d" | "DAV" => Some("DAV:"),
        "C" | "cal" | "CALDAV" => Some("urn:ietf:params:xml:ns:caldav"),
        "CR" | "card" | "CARDDAV" => Some("urn:ietf:params:xml:ns:carddav"),
        "CS" => Some("http://calendarserver.org/ns/"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn make_response(status: u16, body: &str) -> Response {
        Response {
            status,
            headers: HashMap::new(),
            body: body.to_string(),
        }
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

    #[test]
    fn prepost_simple() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
        <D:error xmlns:D="DAV:">
            <D:lock-token-submitted/>
        </D:error>"#;

        let response = make_response(409, xml);
        let args = multi_args(&[("error", &["{DAV:}lock-token-submitted"])]);
        let result = verify(&response, &args).unwrap();
        assert!(result.is_pass(), "Expected pass, got: {result:?}");
    }

    #[test]
    fn prepost_wrong_error() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
        <D:error xmlns:D="DAV:">
            <D:lock-token-submitted/>
        </D:error>"#;

        let response = make_response(409, xml);
        let args = multi_args(&[("error", &["{DAV:}no-external-entities"])]);
        let result = verify(&response, &args).unwrap();
        assert!(result.is_fail());
    }

    #[test]
    fn prepost_wrong_status() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
        <D:error xmlns:D="DAV:">
            <D:lock-token-submitted/>
        </D:error>"#;

        let response = make_response(200, xml);
        let args = multi_args(&[("error", &["{DAV:}lock-token-submitted"])]);
        let result = verify(&response, &args).unwrap();
        assert!(result.is_fail());
    }

    #[test]
    fn prepost_with_caldav_ns() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
        <D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
            <C:supported-calendar-component-set/>
        </D:error>"#;

        let response = make_response(403, xml);
        let args = multi_args(&[(
            "error",
            &["{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set"],
        )]);
        let result = verify(&response, &args).unwrap();
        assert!(result.is_pass(), "Expected pass, got: {result:?}");
    }

    #[test]
    fn prepost_extra_errors_ignored() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
        <D:error xmlns:D="DAV:">
            <D:lock-token-submitted/>
            <D:some-other-error/>
        </D:error>"#;

        let response = make_response(409, xml);
        let args = multi_args(&[
            ("error", &["{DAV:}lock-token-submitted"]),
            ("ignoreextras", &[""]),
        ]);
        let result = verify(&response, &args).unwrap();
        assert!(result.is_pass(), "Expected pass, got: {result:?}");
    }

    #[test]
    fn prepost_extra_errors_fail() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
        <D:error xmlns:D="DAV:">
            <D:lock-token-submitted/>
            <D:some-other-error/>
        </D:error>"#;

        let response = make_response(409, xml);
        let args = multi_args(&[("error", &["{DAV:}lock-token-submitted"])]);
        let result = verify(&response, &args).unwrap();
        assert!(result.is_fail()); // Extra error not expected
    }
}
