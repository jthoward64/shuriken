//! `xmlElementMatch` verification callback.
//!
//! Verifies the presence/absence of XML elements using XPath-like path specs.
//!
//! ## Arg format
//!
//! - `parent` — Root element path (default `/` = document root)
//! - `exists` — List of paths that must exist
//! - `notexists` — List of paths that must NOT exist
//!
//! ## Path format
//!
//! `/{ns}element/{ns}child[test1][test2]`
//!
//! Where tests can be:
//! - `[=text]` — element text equals
//! - `[!text]` — element text does not equal
//! - `[*text]` — element text contains
//! - `[$text]` — element text does not contain
//! - `[+text]` — element text starts with
//! - `[@attr]` — attribute exists
//! - `[@attr=val]` — attribute equals value
//! - `[^child]` — child element exists
//! - `[|]` — element is empty (no text/children)
//! - `[||]` — element is not empty

use super::{Response, VerifyResult};
use crate::error::Result;
use quick_xml::events::Event;
use quick_xml::Reader;
use std::collections::HashMap;

/// Verify XML element existence and properties.
pub fn verify(
    response: &Response,
    args: &HashMap<String, Vec<String>>,
) -> Result<VerifyResult> {
    let body = &response.body;

    // Check exists paths
    if let Some(exists_paths) = args.get("exists") {
        for path in exists_paths {
            if !element_exists(body, path) {
                return Ok(VerifyResult::Fail(format!(
                    "xmlElementMatch: path '{path}' does not exist"
                )));
            }
        }
    }

    // Check notexists paths
    if let Some(notexists_paths) = args.get("notexists") {
        for path in notexists_paths {
            if element_exists(body, path) {
                return Ok(VerifyResult::Fail(format!(
                    "xmlElementMatch: path '{path}' exists but should not"
                )));
            }
        }
    }

    Ok(VerifyResult::Pass)
}

/// Check if an element matching the given path spec exists in the XML body.
fn element_exists(body: &str, path: &str) -> bool {
    let segments = parse_path(path);
    if segments.is_empty() {
        return true;
    }

    match find_elements(body, &segments) {
        Ok(found) => found,
        Err(e) => {
            tracing::warn!("xmlElementMatch parse error: {e}");
            false
        }
    }
}

/// A path segment: namespace + local name + optional tests.
#[derive(Debug)]
struct PathSegment {
    /// Expected qualified name (e.g., `{DAV:}multistatus`).
    qname: String,
    /// Test conditions to apply to the matched element.
    tests: Vec<ElementTest>,
}

/// Test conditions on an XML element.
#[derive(Debug)]
enum ElementTest {
    /// `[=text]` — text equals
    TextEquals(String),
    /// `[!text]` — text does not equal
    TextNotEquals(String),
    /// `[*text]` — text contains
    TextContains(String),
    /// `[$text]` — text does not contain
    TextNotContains(String),
    /// `[+text]` — text starts with
    TextStartsWith(String),
    /// `[@attr]` — attribute exists
    AttrExists(String),
    /// `[@attr=val]` — attribute equals value
    AttrEquals(String, String),
    /// `[^child]` — child element exists
    ChildExists(String),
    /// `[|]` — element is empty
    IsEmpty,
    /// `[||]` — element is not empty
    IsNotEmpty,
}

/// Parse a path string into segments.
///
/// Format: `/{ns}element/{ns}child[test1][test2]`
fn parse_path(path: &str) -> Vec<PathSegment> {
    let path = path.trim_start_matches('/');
    if path.is_empty() {
        return vec![];
    }

    let mut segments = Vec::new();
    let mut current = String::new();
    let mut bracket_depth = 0u32;

    for ch in path.chars() {
        match ch {
            '[' => {
                bracket_depth += 1;
                current.push(ch);
            }
            ']' => {
                bracket_depth = bracket_depth.saturating_sub(1);
                current.push(ch);
            }
            '/' if bracket_depth == 0 => {
                if !current.is_empty() {
                    segments.push(parse_segment(&current));
                    current.clear();
                }
            }
            _ => current.push(ch),
        }
    }

    if !current.is_empty() {
        segments.push(parse_segment(&current));
    }

    segments
}

/// Parse a single path segment like `{DAV:}multistatus[=text][@attr]`.
fn parse_segment(s: &str) -> PathSegment {
    // Split element name from test brackets
    let (name_part, tests_part) = if let Some(bracket_pos) = s.find('[') {
        (&s[..bracket_pos], &s[bracket_pos..])
    } else {
        (s, "")
    };

    let qname = name_part.to_string();
    let tests = parse_tests(tests_part);

    PathSegment { qname, tests }
}

/// Parse bracket test conditions from a string like `[=text][@attr][^child]`.
fn parse_tests(s: &str) -> Vec<ElementTest> {
    let mut tests = Vec::new();
    let mut remaining = s;

    while let Some(open) = remaining.find('[') {
        if let Some(close) = remaining[open..].find(']') {
            let content = &remaining[open + 1..open + close];
            remaining = &remaining[open + close + 1..];

            if let Some(test) = parse_single_test(content) {
                tests.push(test);
            }
        } else {
            break;
        }
    }

    tests
}

/// Parse a single test content (between `[` and `]`).
fn parse_single_test(content: &str) -> Option<ElementTest> {
    if content.is_empty() {
        return None;
    }

    // Special cases
    if content == "|" {
        return Some(ElementTest::IsEmpty);
    }
    if content == "||" {
        return Some(ElementTest::IsNotEmpty);
    }

    let first = content.as_bytes()[0];
    let rest = &content[1..];

    match first {
        b'=' => Some(ElementTest::TextEquals(rest.to_string())),
        b'!' => Some(ElementTest::TextNotEquals(rest.to_string())),
        b'*' => Some(ElementTest::TextContains(rest.to_string())),
        b'$' => Some(ElementTest::TextNotContains(rest.to_string())),
        b'+' => Some(ElementTest::TextStartsWith(rest.to_string())),
        b'^' => Some(ElementTest::ChildExists(rest.to_string())),
        b'@' => {
            // @attr or @attr=value
            if let Some(eq_pos) = rest.find('=') {
                let attr = rest[..eq_pos].to_string();
                let value = rest[eq_pos + 1..].to_string();
                Some(ElementTest::AttrEquals(attr, value))
            } else {
                Some(ElementTest::AttrExists(rest.to_string()))
            }
        }
        _ => {
            // Treat as text equals (no operator prefix)
            Some(ElementTest::TextEquals(content.to_string()))
        }
    }
}

/// Search for elements matching the path segments in an XML body.
fn find_elements(body: &str, segments: &[PathSegment]) -> std::result::Result<bool, String> {
    let mut reader = Reader::from_str(body);
    reader.config_mut().trim_text(true);

    let mut buf = Vec::new();
    let mut ns_map: HashMap<String, String> = HashMap::new();

    #[derive(Debug)]
    struct ElementState {
        qname: String,
        text: String,
        children: Vec<String>,
        attrs: HashMap<String, String>,
    }

    let mut path_stack: Vec<String> = Vec::new();
    let mut state_stack: Vec<ElementState> = Vec::new();

    loop {
        buf.clear();
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                collect_ns(e, &mut ns_map);
                let qname = resolve_qname(e.name().as_ref(), &ns_map);
                let mut attrs = HashMap::new();
                for attr in e.attributes().flatten() {
                    let key = String::from_utf8_lossy(attr.key.as_ref());
                    let val = String::from_utf8_lossy(&attr.value);
                    attrs.insert(key.to_string(), val.to_string());
                }

                path_stack.push(qname.clone());
                state_stack.push(ElementState {
                    qname,
                    text: String::new(),
                    children: Vec::new(),
                    attrs,
                });
            }
            Ok(Event::Empty(ref e)) => {
                collect_ns(e, &mut ns_map);
                let qname = resolve_qname(e.name().as_ref(), &ns_map);

                // Self-closing element appears as a completed element at this path.
                let mut attrs = HashMap::new();
                for attr in e.attributes().flatten() {
                    let key = String::from_utf8_lossy(attr.key.as_ref());
                    let val = String::from_utf8_lossy(&attr.value);
                    attrs.insert(key.to_string(), val.to_string());
                }

                let mut full_path = path_stack.clone();
                full_path.push(qname.clone());

                if path_matches(&full_path, segments) {
                    let tests = &segments[segments.len() - 1].tests;
                    if evaluate_tests(tests, "", &[], &attrs) {
                        return Ok(true);
                    }
                }

                // Register this as a child of the current parent element.
                if let Some(parent) = state_stack.last_mut() {
                    parent.children.push(qname);
                }
            }
            Ok(Event::Text(ref e)) => {
                if let Some(current) = state_stack.last_mut() {
                    if let Ok(decoded) = reader.decoder().decode(e.as_ref()) {
                        current.text.push_str(&decoded);
                    }
                }
            }
            Ok(Event::End(_)) => {
                if let Some(element) = state_stack.pop() {
                    if path_matches(&path_stack, segments) {
                        let tests = &segments[segments.len() - 1].tests;
                        if evaluate_tests(
                            tests,
                            element.text.trim(),
                            &element.children,
                            &element.attrs,
                        ) {
                            return Ok(true);
                        }
                    }

                    path_stack.pop();

                    // Register this closed element as a child of its parent.
                    if let Some(parent) = state_stack.last_mut() {
                        parent.children.push(element.qname);
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML parse error: {e}")),
            _ => {}
        }
    }

    Ok(false)
}

/// Check if the current XML path matches the expected path segments exactly.
fn path_matches(path: &[String], segments: &[PathSegment]) -> bool {
    if path.len() != segments.len() {
        return false;
    }

    path.iter()
        .zip(segments.iter())
        .all(|(actual, expected)| qname_matches(actual, &expected.qname))
}

/// Evaluate all tests against element data.
fn evaluate_tests(
    tests: &[ElementTest],
    text: &str,
    children: &[String],
    attrs: &HashMap<String, String>,
) -> bool {
    if tests.is_empty() {
        return true; // No tests = just existence check
    }

    tests.iter().all(|test| match test {
        ElementTest::TextEquals(expected) => text == expected,
        ElementTest::TextNotEquals(expected) => text != expected,
        ElementTest::TextContains(expected) => text.contains(expected.as_str()),
        ElementTest::TextNotContains(expected) => !text.contains(expected.as_str()),
        ElementTest::TextStartsWith(expected) => text.starts_with(expected.as_str()),
        ElementTest::AttrExists(name) => attrs.contains_key(name.as_str()),
        ElementTest::AttrEquals(name, val) => attrs.get(name.as_str()) == Some(val),
        ElementTest::ChildExists(name) => {
            children.iter().any(|c| qname_matches(c, name))
        }
        ElementTest::IsEmpty => text.is_empty() && children.is_empty(),
        ElementTest::IsNotEmpty => !text.is_empty() || !children.is_empty(),
    })
}

/// Check if a resolved QName matches an expected pattern.
///
/// Handles `{ns}local`, plain `local`, and prefix:local forms.
fn qname_matches(actual: &str, expected: &str) -> bool {
    if actual == expected {
        return true;
    }

    // Extract local names for fallback comparison
    let actual_local = actual
        .find('}')
        .map_or(actual, |pos| &actual[pos + 1..]);
    let expected_local = expected
        .find('}')
        .map_or(expected, |pos| &expected[pos + 1..]);

    // If one has namespace and other doesn't, compare locals only
    if actual.contains('{') != expected.contains('{') {
        return actual_local == expected_local;
    }

    false
}

/// Collect xmlns declarations from an element.
fn collect_ns(e: &quick_xml::events::BytesStart<'_>, ns_map: &mut HashMap<String, String>) {
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
    let local = full.split(':').next_back().unwrap_or(&full).to_string();

    // Check for prefix
    if let Some(prefix) = full.strip_suffix(&format!(":{local}")) {
        if let Some(ns) = ns_map.get(prefix) {
            return format!("{{{ns}}}{local}");
        }
        if let Some(ns) = well_known_ns(prefix) {
            return format!("{{{ns}}}{local}");
        }
    }

    // Default namespace
    if let Some(ns) = ns_map.get("") {
        return format!("{{{ns}}}{local}");
    }

    local
}

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
    fn exists_simple() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
        <D:multistatus xmlns:D="DAV:">
            <D:response>
                <D:href>/calendars/</D:href>
            </D:response>
        </D:multistatus>"#;

        let response = make_response(xml);
        let args = multi_args(&[(
            "exists",
            &["/{DAV:}multistatus/{DAV:}response/{DAV:}href"],
        )]);
        let result = verify(&response, &args).unwrap();
        assert!(result.is_pass(), "Expected pass, got: {result:?}");
    }

    #[test]
    fn notexists_pass() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
        <D:multistatus xmlns:D="DAV:">
            <D:response>
                <D:href>/calendars/</D:href>
            </D:response>
        </D:multistatus>"#;

        let response = make_response(xml);
        let args = multi_args(&[(
            "notexists",
            &["/{DAV:}multistatus/{DAV:}response/{DAV:}status"],
        )]);
        let result = verify(&response, &args).unwrap();
        assert!(result.is_pass(), "Expected pass, got: {result:?}");
    }

    #[test]
    fn exists_with_text_test() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
        <D:multistatus xmlns:D="DAV:">
            <D:response>
                <D:href>/calendars/</D:href>
            </D:response>
        </D:multistatus>"#;

        let response = make_response(xml);
        let args = multi_args(&[(
            "exists",
            &["/{DAV:}multistatus/{DAV:}response/{DAV:}href[=/calendars/]"],
        )]);
        let result = verify(&response, &args).unwrap();
        assert!(result.is_pass(), "Expected pass, got: {result:?}");
    }

    #[test]
    fn exists_with_text_test_fail() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
        <D:multistatus xmlns:D="DAV:">
            <D:response>
                <D:href>/calendars/</D:href>
            </D:response>
        </D:multistatus>"#;

        let response = make_response(xml);
        let args = multi_args(&[(
            "exists",
            &["/{DAV:}multistatus/{DAV:}response/{DAV:}href[=/wrong/]"],
        )]);
        let result = verify(&response, &args).unwrap();
        assert!(result.is_fail());
    }

    #[test]
    fn parse_path_segments() {
        let segments = parse_path("/{DAV:}multistatus/{DAV:}response[=test][@attr]");
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].qname, "{DAV:}multistatus");
        assert!(segments[0].tests.is_empty());
        assert_eq!(segments[1].qname, "{DAV:}response");
        assert_eq!(segments[1].tests.len(), 2);
    }
}
