//! `multistatusItems` verification callback.
//!
//! Verifies that a multistatus response contains the expected hrefs with
//! correct status codes.
//!
//! ## Arg format
//!
//! - `okhrefs` — Hrefs expected with 2xx status (list)
//! - `nohrefs` — Hrefs expected with non-2xx status or missing (list)
//! - `badhrefs` — Hrefs expected with specific non-2xx status code (list)
//!   Format: `statusCode:href`
//! - `count` — Expected number of `<response>` elements
//! - `responsecount` — Alias for `count`
//! - `prefix` — Prefix prepended to all hrefs (`"-"` = empty prefix)
//! - Bracket expansion: `[item1,item2,-]` in an href value expands to
//!   multiple hrefs.

use super::multistatus::{self, MultistatusResponse};
use super::{Response, VerifyResult};
use crate::error::Result;
use std::collections::HashMap;

/// Verify a multistatus response's hrefs and status codes.
pub fn verify(
    response: &Response,
    args: &HashMap<String, Vec<String>>,
) -> Result<VerifyResult> {
    let responses = match multistatus::parse_multistatus(&response.body) {
        Ok(r) => r,
        Err(e) => {
            return Ok(VerifyResult::Fail(format!(
                "Failed to parse multistatus XML: {e}"
            )));
        }
    };

    let prefix = resolve_prefix(args);

    // Check response count
    if let Some(result) = check_count(&responses, args) {
        if result.is_fail() {
            return Ok(result);
        }
    }

    // Check ok hrefs — should be present with 2xx status
    if let Some(ok_hrefs) = args.get("okhrefs") {
        let expanded = expand_hrefs(ok_hrefs, &prefix);
        for expected_href in &expanded {
            let found = find_response(&responses, expected_href);
            match found {
                Some(resp) => {
                    // Must have at least one 2xx propstat, or a 2xx top-level status
                    if !has_ok_status(resp) {
                        return Ok(VerifyResult::Fail(format!(
                            "okhrefs: href '{expected_href}' does not have a 2xx status"
                        )));
                    }
                }
                None => {
                    return Ok(VerifyResult::Fail(format!(
                        "okhrefs: href '{expected_href}' not found in response"
                    )));
                }
            }
        }
    }

    // Check no hrefs — should NOT be present (or present with non-2xx)
    if let Some(no_hrefs) = args.get("nohrefs") {
        let expanded = expand_hrefs(no_hrefs, &prefix);
        for expected_href in &expanded {
            if let Some(resp) = find_response(&responses, expected_href) {
                if has_ok_status(resp) {
                    return Ok(VerifyResult::Fail(format!(
                        "nohrefs: href '{expected_href}' unexpectedly has 2xx status"
                    )));
                }
            }
            // Not found = pass (it shouldn't be there)
        }
    }

    // Check bad hrefs — present with specific non-2xx status
    if let Some(bad_hrefs) = args.get("badhrefs") {
        let expanded = expand_hrefs(bad_hrefs, &prefix);
        for spec in &expanded {
            // Format: optional "statusCode:" prefix
            let (expected_status, href) = parse_bad_href_spec(spec);
            match find_response(&responses, &href) {
                Some(resp) => {
                    if let Some(code) = expected_status {
                        if !response_has_status(resp, code) {
                            return Ok(VerifyResult::Fail(format!(
                                "badhrefs: href '{href}' expected status {code}"
                            )));
                        }
                    } else if has_ok_status(resp) {
                        return Ok(VerifyResult::Fail(format!(
                            "badhrefs: href '{href}' has 2xx status but expected error"
                        )));
                    }
                }
                None => {
                    return Ok(VerifyResult::Fail(format!(
                        "badhrefs: href '{href}' not found in response"
                    )));
                }
            }
        }
    }

    Ok(VerifyResult::Pass)
}

/// Resolve the prefix from args.
///
/// `"-"` means empty prefix. Default is empty.
#[must_use]
fn resolve_prefix(args: &HashMap<String, Vec<String>>) -> String {
    args.get("prefix")
        .and_then(|v| v.first())
        .map(|p| if p == "-" { String::new() } else { p.clone() })
        .unwrap_or_default()
}

/// Expand hrefs with bracket expansion and prefix.
///
/// `[item1,item2,-]` in a value expands to multiple hrefs.
/// `-` inside brackets means "no suffix" (just the prefix).
fn expand_hrefs(hrefs: &[String], prefix: &str) -> Vec<String> {
    let mut result = Vec::new();
    for href in hrefs {
        let expanded = expand_brackets(href);
        for h in expanded {
            let full = if prefix.is_empty() {
                h
            } else {
                format!("{prefix}{h}")
            };
            // Normalize: strip trailing slash for comparison
            let normalized = full.trim_end_matches('/').to_string();
            result.push(normalized);
        }
    }
    result
}

/// Expand bracket notation `prefix[a,b,c]suffix` → `["prefixasuffix", "prefixbsuffix", ...]`.
///
/// `-` inside brackets means empty string.
fn expand_brackets(s: &str) -> Vec<String> {
    if let Some(open) = s.find('[') {
        if let Some(close) = s[open..].find(']') {
            let before = &s[..open];
            let inside = &s[open + 1..open + close];
            let after = &s[open + close + 1..];

            return inside
                .split(',')
                .map(|item| {
                    let item = item.trim();
                    if item == "-" {
                        format!("{before}{after}")
                    } else {
                        format!("{before}{item}{after}")
                    }
                })
                .collect();
        }
    }
    vec![s.to_string()]
}

/// Check response count constraints.
fn check_count(
    responses: &[MultistatusResponse],
    args: &HashMap<String, Vec<String>>,
) -> Option<VerifyResult> {
    let count_key = if args.contains_key("count") {
        "count"
    } else if args.contains_key("responsecount") {
        "responsecount"
    } else {
        return None;
    };

    let expected = args
        .get(count_key)
        .and_then(|v| v.first())
        .and_then(|s| s.parse::<usize>().ok())?;

    if responses.len() == expected {
        Some(VerifyResult::Pass)
    } else {
        Some(VerifyResult::Fail(format!(
            "Expected {expected} responses, got {}",
            responses.len()
        )))
    }
}

/// Find a response by href (case-insensitive, trailing-slash normalized).
fn find_response<'a>(
    responses: &'a [MultistatusResponse],
    href: &str,
) -> Option<&'a MultistatusResponse> {
    let target = href.trim_end_matches('/').to_lowercase();
    responses
        .iter()
        .find(|r| r.href.trim_end_matches('/').to_lowercase() == target)
}

/// Check if a response has at least one 2xx status.
#[must_use]
fn has_ok_status(resp: &MultistatusResponse) -> bool {
    // Check top-level <status>
    if let Some(ref status) = resp.status {
        if multistatus::is_ok_status(&Some(status.clone())) {
            return true;
        }
    }

    // Check propstats for any 2xx
    resp.propstats
        .keys()
        .any(|&code| (200..300).contains(&code))
}

/// Check if a response has a specific status code.
#[must_use]
fn response_has_status(resp: &MultistatusResponse, expected: u16) -> bool {
    // Check top-level
    if let Some(ref status) = resp.status {
        if multistatus::parse_http_status(status) == expected {
            return true;
        }
    }
    // Check propstats
    resp.propstats.contains_key(&expected)
}

/// Parse a bad href spec: `"403:/path"` → `(Some(403), "/path")`.
///
/// If no colon-separated status, returns `(None, href)`.
fn parse_bad_href_spec(spec: &str) -> (Option<u16>, String) {
    // Look for NNN:/path pattern
    if spec.len() > 4 {
        if let Some(colon_pos) = spec.find(':') {
            // Check if everything before the colon is digits (status code)
            let potential_code = &spec[..colon_pos];
            if potential_code.len() == 3
                && potential_code.chars().all(|c| c.is_ascii_digit())
            {
                if let Ok(code) = potential_code.parse::<u16>() {
                    return (Some(code), spec[colon_pos + 1..].to_string());
                }
            }
        }
    }
    (None, spec.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn make_response(body: &str) -> Response {
        Response {
            status: 207,
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
    fn bracket_expansion() {
        assert_eq!(
            expand_brackets("/calendars/user01/[cal1,cal2,cal3].ics"),
            vec![
                "/calendars/user01/cal1.ics",
                "/calendars/user01/cal2.ics",
                "/calendars/user01/cal3.ics",
            ]
        );
    }

    #[test]
    fn bracket_expansion_with_dash() {
        assert_eq!(
            expand_brackets("/calendars/user01/[cal1,-]"),
            vec!["/calendars/user01/cal1", "/calendars/user01/"]
        );
    }

    #[test]
    fn parse_bad_href() {
        assert_eq!(
            parse_bad_href_spec("403:/calendars/forbidden"),
            (Some(403), "/calendars/forbidden".to_string())
        );
        assert_eq!(
            parse_bad_href_spec("/calendars/normal"),
            (None, "/calendars/normal".to_string())
        );
    }

    #[test]
    fn multistatus_ok_hrefs() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
        <D:multistatus xmlns:D="DAV:">
            <D:response>
                <D:href>/calendars/user01/calendar/</D:href>
                <D:propstat>
                    <D:prop><D:displayname>Cal</D:displayname></D:prop>
                    <D:status>HTTP/1.1 200 OK</D:status>
                </D:propstat>
            </D:response>
        </D:multistatus>"#;

        let response = make_response(xml);
        let args = multi_args(&[("okhrefs", &["/calendars/user01/calendar/"])]);
        let result = verify(&response, &args).unwrap();
        assert!(result.is_pass(), "Expected pass, got: {result:?}");
    }

    #[test]
    fn multistatus_ok_hrefs_missing() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
        <D:multistatus xmlns:D="DAV:">
            <D:response>
                <D:href>/calendars/user01/calendar/</D:href>
                <D:propstat>
                    <D:prop><D:displayname>Cal</D:displayname></D:prop>
                    <D:status>HTTP/1.1 200 OK</D:status>
                </D:propstat>
            </D:response>
        </D:multistatus>"#;

        let response = make_response(xml);
        let args = multi_args(&[("okhrefs", &["/calendars/user01/other/"])]);
        let result = verify(&response, &args).unwrap();
        assert!(result.is_fail());
    }

    #[test]
    fn multistatus_no_hrefs() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
        <D:multistatus xmlns:D="DAV:">
            <D:response>
                <D:href>/calendars/user01/calendar/</D:href>
                <D:propstat>
                    <D:prop><D:displayname>Cal</D:displayname></D:prop>
                    <D:status>HTTP/1.1 200 OK</D:status>
                </D:propstat>
            </D:response>
        </D:multistatus>"#;

        let response = make_response(xml);
        let args = multi_args(&[("nohrefs", &["/calendars/user01/other/"])]);
        let result = verify(&response, &args).unwrap();
        assert!(result.is_pass(), "Expected pass, got: {result:?}");
    }

    #[test]
    fn multistatus_count() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
        <D:multistatus xmlns:D="DAV:">
            <D:response>
                <D:href>/a</D:href>
                <D:propstat>
                    <D:prop><D:displayname>A</D:displayname></D:prop>
                    <D:status>HTTP/1.1 200 OK</D:status>
                </D:propstat>
            </D:response>
            <D:response>
                <D:href>/b</D:href>
                <D:propstat>
                    <D:prop><D:displayname>B</D:displayname></D:prop>
                    <D:status>HTTP/1.1 200 OK</D:status>
                </D:propstat>
            </D:response>
        </D:multistatus>"#;

        let response = make_response(xml);
        let args = multi_args(&[("count", &["2"])]);
        let result = verify(&response, &args).unwrap();
        assert!(result.is_pass(), "Expected pass, got: {result:?}");

        let bad_args = multi_args(&[("count", &["1"])]);
        let result = verify(&response, &bad_args).unwrap();
        assert!(result.is_fail());
    }
}
