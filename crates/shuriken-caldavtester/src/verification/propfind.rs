//! `propfindItems` verification callback.
//!
//! Verifies that a `PROPFIND` response contains the expected properties with
//! the correct values. Properties are categorized as "ok" (2xx status) or "bad"
//! (non-2xx status).
//!
//! ## Arg format
//!
//! - `okprops` — Properties expected in a 2xx propstat. Format:
//!   - `{ns}prop` — property must exist
//!   - `{ns}prop$value` — property must equal value
//!   - `{ns}prop$` — property must be empty
//!   - `{ns}prop!value` — property must NOT equal value
//! - `badprops` — Properties expected in a non-2xx propstat. Same format.
//! - `count` — Expected number of `<response>` elements
//! - `ignore` — Hrefs to ignore (list)
//! - `only` — Only check these hrefs (list)
//! - `root-element` — Override root element (default `{DAV:}multistatus`)
//! - `status` — Expected HTTP status (default `207`)

use super::multistatus::{self, MultistatusResponse};
use super::{Response, VerifyResult};
use crate::error::Result;
use std::collections::HashMap;

type PropertyMap = HashMap<String, Option<String>>;
type PropertyBuckets = (PropertyMap, PropertyMap);

/// Verify a `PROPFIND` response.
pub fn verify(response: &Response, args: &HashMap<String, Vec<String>>) -> Result<VerifyResult> {
    // Parse the multistatus response
    let responses = match multistatus::parse_multistatus(&response.body) {
        Ok(r) => r,
        Err(e) => {
            return Ok(VerifyResult::Fail(format!(
                "Failed to parse multistatus XML: {e}"
            )));
        }
    };

    // Apply href filtering (ignore/only)
    let responses = filter_responses(&responses, args);

    // Delta sync REPORTs can legitimately return an empty multistatus response set.
    // Unless caller explicitly asserts count/responsecount, treat empty sets as pass.
    let has_explicit_count = args.contains_key("count") || args.contains_key("responsecount");
    if responses.is_empty() && !has_explicit_count {
        return Ok(VerifyResult::Pass);
    }

    // Check response count if requested
    if let Some(counts) = args.get("count") {
        if let Some(expected) = counts.first() {
            if let Ok(expected_count) = expected.parse::<usize>() {
                if responses.len() != expected_count {
                    return Ok(VerifyResult::Fail(format!(
                        "Expected {expected_count} responses, got {}",
                        responses.len()
                    )));
                }
            }
        }
    }

    // Collect actual properties grouped by ok/bad from ALL responses
    let (actual_ok, actual_bad) = collect_properties(&responses);

    // Check okprops
    if let Some(ok_specs) = args.get("okprops") {
        let result = check_property_specs(ok_specs, &actual_ok, "okprops")?;
        if result.is_fail() {
            return Ok(result);
        }
    }

    // Check badprops
    if let Some(bad_specs) = args.get("badprops") {
        let result = check_property_specs(bad_specs, &actual_bad, "badprops")?;
        if result.is_fail() {
            return Ok(result);
        }
    }

    Ok(VerifyResult::Pass)
}

/// Verify `propfindValues` callback.
pub fn verify_values(
    response: &Response,
    args: &HashMap<String, Vec<String>>,
) -> Result<VerifyResult> {
    let statuses = args.get("status");
    let status_ok = match statuses {
        Some(list) if !list.is_empty() => list
            .iter()
            .any(|pattern| status_matches(response.status, pattern)),
        _ => response.status == 207,
    };

    if !status_ok {
        let expected = statuses
            .map(|v| v.join("|"))
            .unwrap_or_else(|| "207".to_string());
        return Ok(VerifyResult::Fail(format!(
            "propfindValues: expected status {expected}, got {}",
            response.status
        )));
    }

    let responses = match multistatus::parse_multistatus(&response.body) {
        Ok(r) => r,
        Err(e) => {
            return Ok(VerifyResult::Fail(format!(
                "Failed to parse multistatus XML: {e}"
            )));
        }
    };

    let filtered = filter_responses(&responses, args);
    let (actual_ok, _actual_bad) = collect_properties(&filtered);

    let specs = args.get("props").or_else(|| args.get("okprops"));
    if let Some(specs) = specs {
        let result = check_property_regex_specs(specs, &actual_ok)?;
        if result.is_fail() {
            return Ok(result);
        }
    }

    Ok(VerifyResult::Pass)
}

/// Filter responses by `ignore` and `only` href lists.
fn filter_responses<'a>(
    responses: &'a [MultistatusResponse],
    args: &HashMap<String, Vec<String>>,
) -> Vec<&'a MultistatusResponse> {
    let ignore_hrefs: Vec<&str> = args
        .get("ignore")
        .map(|v| v.iter().map(String::as_str).collect())
        .unwrap_or_default();

    let only_hrefs: Vec<&str> = args
        .get("only")
        .map(|v| v.iter().map(String::as_str).collect())
        .unwrap_or_default();

    responses
        .iter()
        .filter(|r| {
            // Normalize for comparison: strip trailing slash
            let href = r.href.trim_end_matches('/');

            if !ignore_hrefs.is_empty()
                && ignore_hrefs
                    .iter()
                    .any(|ig| href == ig.trim_end_matches('/'))
            {
                return false;
            }

            if !only_hrefs.is_empty() && !only_hrefs.iter().any(|o| href == o.trim_end_matches('/'))
            {
                return false;
            }

            true
        })
        .collect()
}

/// Collect all properties from responses, split into ok (2xx) and bad (non-2xx).
///
/// Returns two maps: `(ok_props, bad_props)` where each maps
/// `{ns}localname` → `Option<serialized_value>`.
fn collect_properties(responses: &[&MultistatusResponse]) -> PropertyBuckets {
    let mut ok_props: PropertyMap = HashMap::new();
    let mut bad_props: PropertyMap = HashMap::new();

    for resp in responses {
        for (&status_code, props) in &resp.propstats {
            let target = if (200..300).contains(&status_code) {
                &mut ok_props
            } else {
                &mut bad_props
            };
            for (qname, value) in props {
                target.insert(qname.clone(), value.clone());
            }
        }
    }

    (ok_props, bad_props)
}

/// Check a list of property specs against actual properties.
fn check_property_specs(
    specs: &[String],
    actual: &PropertyMap,
    category: &str,
) -> Result<VerifyResult> {
    for spec in specs {
        let result = check_one_property(spec, actual, category);
        if result.is_fail() {
            return Ok(result);
        }
    }
    Ok(VerifyResult::Pass)
}

fn check_property_regex_specs(specs: &[String], actual: &PropertyMap) -> Result<VerifyResult> {
    for spec in specs {
        let (qname, check) = parse_prop_spec(spec);
        let actual_value = actual.get(&qname);

        match check {
            PropCheck::Exists => {
                if actual_value.is_none() {
                    return Ok(VerifyResult::Fail(format!(
                        "propfindValues: property '{qname}' not found"
                    )));
                }
            }
            PropCheck::Equals(pattern) => match actual_value {
                Some(value) => {
                    let actual_str = value.as_deref().unwrap_or("");
                    let re = regex_lite::Regex::new(&pattern).map_err(|e| {
                        crate::error::Error::Other(format!(
                            "propfindValues: invalid regex '{pattern}': {e}"
                        ))
                    })?;
                    if !re.is_match(actual_str) {
                        return Ok(VerifyResult::Fail(format!(
                            "propfindValues: property '{qname}' value '{actual_str}' does not match regex '{pattern}'"
                        )));
                    }
                }
                None => {
                    return Ok(VerifyResult::Fail(format!(
                        "propfindValues: property '{qname}' not found"
                    )))
                }
            },
            PropCheck::NotEquals(pattern) => {
                if let Some(value) = actual_value {
                    let actual_str = value.as_deref().unwrap_or("");
                    let re = regex_lite::Regex::new(&pattern).map_err(|e| {
                        crate::error::Error::Other(format!(
                            "propfindValues: invalid regex '{pattern}': {e}"
                        ))
                    })?;
                    if re.is_match(actual_str) {
                        return Ok(VerifyResult::Fail(format!(
                            "propfindValues: property '{qname}' value '{actual_str}' unexpectedly matches regex '{pattern}'"
                        )));
                    }
                }
            }
            PropCheck::Empty => match actual_value {
                Some(value) if value.as_deref().unwrap_or("").is_empty() => {}
                Some(value) => {
                    let actual_str = value.as_deref().unwrap_or("");
                    return Ok(VerifyResult::Fail(format!(
                        "propfindValues: property '{qname}' expected empty, got '{actual_str}'"
                    )));
                }
                None => {
                    return Ok(VerifyResult::Fail(format!(
                        "propfindValues: property '{qname}' not found"
                    )))
                }
            },
        }
    }

    Ok(VerifyResult::Pass)
}

#[must_use]
fn status_matches(actual: u16, pattern: &str) -> bool {
    let pattern = pattern.trim();
    if let Ok(exact) = pattern.parse::<u16>() {
        return actual == exact;
    }

    let actual_str = format!("{actual:03}");
    if actual_str.len() != pattern.len() {
        return false;
    }

    actual_str
        .chars()
        .zip(pattern.chars())
        .all(|(a, p)| p == 'x' || p == 'X' || a == p)
}

/// Parse and check a single property spec.
///
/// Format: `{ns}propname`, `{ns}propname$value`, `{ns}propname$`, `{ns}propname!value`
fn check_one_property(spec: &str, actual: &PropertyMap, category: &str) -> VerifyResult {
    let (qname, check) = parse_prop_spec(spec);

    // Find the property in the actual set
    let actual_value = actual.get(&qname);

    match check {
        PropCheck::Exists => {
            if actual_value.is_some() {
                VerifyResult::Pass
            } else {
                VerifyResult::Fail(format!(
                    "{category}: property '{qname}' not found (expected to exist)"
                ))
            }
        }
        PropCheck::Equals(expected) => match actual_value {
            Some(val) => {
                let actual_str = val.as_deref().unwrap_or("");
                if values_match(actual_str, &expected) {
                    VerifyResult::Pass
                } else {
                    VerifyResult::Fail(format!(
                        "{category}: property '{qname}' value mismatch — expected '{}', got '{actual_str}'",
                        truncate(&expected, 100)
                    ))
                }
            }
            None => VerifyResult::Fail(format!("{category}: property '{qname}' not found")),
        },
        PropCheck::Empty => match actual_value {
            Some(val) => {
                let actual_str = val.as_deref().unwrap_or("");
                if actual_str.is_empty() {
                    VerifyResult::Pass
                } else {
                    VerifyResult::Fail(format!(
                        "{category}: property '{qname}' expected empty, got '{}'",
                        truncate(actual_str, 100)
                    ))
                }
            }
            None => VerifyResult::Fail(format!("{category}: property '{qname}' not found")),
        },
        PropCheck::NotEquals(expected) => match actual_value {
            Some(val) => {
                let actual_str = val.as_deref().unwrap_or("");
                if !values_match(actual_str, &expected) {
                    VerifyResult::Pass
                } else {
                    VerifyResult::Fail(format!(
                        "{category}: property '{qname}' should NOT equal '{}'",
                        truncate(&expected, 100)
                    ))
                }
            }
            None => {
                // Property doesn't exist, so it's not equal — pass
                VerifyResult::Pass
            }
        },
    }
}

/// Comparison modes for property values.
enum PropCheck {
    /// Property must exist (value not checked).
    Exists,
    /// Property value must equal this string.
    Equals(String),
    /// Property must exist but be empty.
    Empty,
    /// Property value must NOT equal this string.
    NotEquals(String),
}

/// Parse a property spec string into QName + check mode.
///
/// Format: `{ns}prop`, `{ns}prop$value`, `{ns}prop$`, `{ns}prop!value`
fn parse_prop_spec(spec: &str) -> (String, PropCheck) {
    // Find the end of `{ns}localname` portion
    // The QName is everything up to the first `$` or `!` after the `}`.
    if let Some(close_brace) = spec.find('}') {
        let after = &spec[close_brace + 1..];

        if let Some(dollar_pos) = after.find('$') {
            let qname = format!("{}{}", &spec[..=close_brace], &after[..dollar_pos]);
            let value = &after[dollar_pos + 1..];
            if value.is_empty() {
                return (qname, PropCheck::Empty);
            }
            return (qname, PropCheck::Equals(value.to_string()));
        }

        if let Some(bang_pos) = after.find('!') {
            let qname = format!("{}{}", &spec[..=close_brace], &after[..bang_pos]);
            let value = &after[bang_pos + 1..];
            return (qname, PropCheck::NotEquals(value.to_string()));
        }

        // No operator — just existence check
        return (spec.to_string(), PropCheck::Exists);
    }

    // No namespace braces — treat as plain name
    if let Some(dollar_pos) = spec.find('$') {
        let qname = spec[..dollar_pos].to_string();
        let value = &spec[dollar_pos + 1..];
        if value.is_empty() {
            return (qname, PropCheck::Empty);
        }
        return (qname, PropCheck::Equals(value.to_string()));
    }

    if let Some(bang_pos) = spec.find('!') {
        let qname = spec[..bang_pos].to_string();
        let value = &spec[bang_pos + 1..];
        return (qname, PropCheck::NotEquals(value.to_string()));
    }

    (spec.to_string(), PropCheck::Exists)
}

/// Compare values, handling XML fragments and whitespace normalization.
///
/// If the expected value starts with `<`, do a whitespace-normalized XML
/// comparison. Otherwise, do a plain string comparison.
#[must_use]
fn values_match(actual: &str, expected: &str) -> bool {
    if expected.starts_with('<') {
        // XML value: normalize whitespace for comparison
        normalize_xml(actual) == normalize_xml(expected)
    } else {
        actual.trim() == expected.trim()
    }
}

/// Normalize XML whitespace for comparison purposes.
#[must_use]
fn normalize_xml(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Truncate a string for display in error messages.
#[must_use]
fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...", &s[..max])
    }
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
    fn parse_spec_exists() {
        let (qname, check) = parse_prop_spec("{DAV:}displayname");
        assert_eq!(qname, "{DAV:}displayname");
        assert!(matches!(check, PropCheck::Exists));
    }

    #[test]
    fn parse_spec_equals() {
        let (qname, check) = parse_prop_spec("{DAV:}displayname$My Calendar");
        assert_eq!(qname, "{DAV:}displayname");
        assert!(matches!(check, PropCheck::Equals(ref v) if v == "My Calendar"));
    }

    #[test]
    fn parse_spec_empty() {
        let (qname, check) = parse_prop_spec("{DAV:}displayname$");
        assert_eq!(qname, "{DAV:}displayname");
        assert!(matches!(check, PropCheck::Empty));
    }

    #[test]
    fn parse_spec_not_equals() {
        let (qname, check) = parse_prop_spec("{DAV:}displayname!Bad");
        assert_eq!(qname, "{DAV:}displayname");
        assert!(matches!(check, PropCheck::NotEquals(ref v) if v == "Bad"));
    }

    #[test]
    fn propfind_ok_props_present() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
        <D:multistatus xmlns:D="DAV:">
            <D:response>
                <D:href>/calendars/user01/calendar/</D:href>
                <D:propstat>
                    <D:prop>
                        <D:displayname>My Calendar</D:displayname>
                    </D:prop>
                    <D:status>HTTP/1.1 200 OK</D:status>
                </D:propstat>
            </D:response>
        </D:multistatus>"#;

        let response = make_response(xml);
        let args = multi_args(&[("okprops", &["{DAV:}displayname$My Calendar"])]);
        let result = verify(&response, &args).unwrap();
        assert!(result.is_pass(), "Expected pass, got: {result:?}");
    }

    #[test]
    fn propfind_ok_props_wrong_value() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
        <D:multistatus xmlns:D="DAV:">
            <D:response>
                <D:href>/calendars/user01/calendar/</D:href>
                <D:propstat>
                    <D:prop>
                        <D:displayname>My Calendar</D:displayname>
                    </D:prop>
                    <D:status>HTTP/1.1 200 OK</D:status>
                </D:propstat>
            </D:response>
        </D:multistatus>"#;

        let response = make_response(xml);
        let args = multi_args(&[("okprops", &["{DAV:}displayname$Wrong Name"])]);
        let result = verify(&response, &args).unwrap();
        assert!(result.is_fail());
    }

    #[test]
    fn propfind_bad_props() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
        <D:multistatus xmlns:D="DAV:">
            <D:response>
                <D:href>/calendars/user01/calendar/</D:href>
                <D:propstat>
                    <D:prop>
                        <D:getcontentlength/>
                    </D:prop>
                    <D:status>HTTP/1.1 404 Not Found</D:status>
                </D:propstat>
            </D:response>
        </D:multistatus>"#;

        let response = make_response(xml);
        let args = multi_args(&[("badprops", &["{DAV:}getcontentlength"])]);
        let result = verify(&response, &args).unwrap();
        assert!(result.is_pass(), "Expected pass, got: {result:?}");
    }

    #[test]
    fn propfind_count() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
        <D:multistatus xmlns:D="DAV:">
            <D:response>
                <D:href>/calendars/user01/cal1/</D:href>
                <D:propstat>
                    <D:prop><D:displayname>Cal1</D:displayname></D:prop>
                    <D:status>HTTP/1.1 200 OK</D:status>
                </D:propstat>
            </D:response>
            <D:response>
                <D:href>/calendars/user01/cal2/</D:href>
                <D:propstat>
                    <D:prop><D:displayname>Cal2</D:displayname></D:prop>
                    <D:status>HTTP/1.1 200 OK</D:status>
                </D:propstat>
            </D:response>
        </D:multistatus>"#;

        let response = make_response(xml);
        let args = multi_args(&[("count", &["2"])]);
        let result = verify(&response, &args).unwrap();
        assert!(result.is_pass(), "Expected pass, got: {result:?}");

        let bad_args = multi_args(&[("count", &["3"])]);
        let result = verify(&response, &bad_args).unwrap();
        assert!(result.is_fail());
    }

    #[test]
    fn propfind_values_regex_match() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
        <D:multistatus xmlns:D="DAV:">
            <D:response>
                <D:href>/calendars/user01/calendar/</D:href>
                <D:propstat>
                    <D:prop>
                        <D:getcontenttype>text/calendar; charset=utf-8</D:getcontenttype>
                    </D:prop>
                    <D:status>HTTP/1.1 200 OK</D:status>
                </D:propstat>
            </D:response>
        </D:multistatus>"#;

        let response = make_response(xml);
        let args = multi_args(&[("props", &["{DAV:}getcontenttype$text/calendar.*"])]);
        let result = verify_values(&response, &args).unwrap();
        assert!(result.is_pass(), "Expected pass, got: {result:?}");
    }

    #[test]
    fn propfind_values_regex_not_match() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
        <D:multistatus xmlns:D="DAV:">
            <D:response>
                <D:href>/calendars/user01/calendar/</D:href>
                <D:propstat>
                    <D:prop>
                        <D:getcontenttype>text/calendar</D:getcontenttype>
                    </D:prop>
                    <D:status>HTTP/1.1 200 OK</D:status>
                </D:propstat>
            </D:response>
        </D:multistatus>"#;

        let response = make_response(xml);
        let args = multi_args(&[("props", &["{DAV:}getcontenttype!text/calendar"])]);
        let result = verify_values(&response, &args).unwrap();
        assert!(result.is_fail());
    }
}
