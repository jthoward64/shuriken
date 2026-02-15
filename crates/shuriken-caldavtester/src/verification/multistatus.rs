//! Multistatus XML response parsing helpers.
//!
//! Parses `DAV:multistatus` responses into structured data for verification.

use quick_xml::events::Event;
use quick_xml::Reader;
use std::collections::HashMap;

type PropertyMap = HashMap<String, Option<String>>;
type PropstatMap = HashMap<u16, PropertyMap>;

/// A parsed `<DAV:response>` element from a multistatus body.
#[derive(Debug, Clone)]
pub struct MultistatusResponse {
    /// The `<href>` value (URL-decoded, trailing slash stripped).
    pub href: String,
    /// Status from `<status>` element, if present (e.g., `"HTTP/1.1 200 OK"`).
    pub status: Option<String>,
    /// Properties grouped by their propstat HTTP status code.
    /// Key: status code (e.g., 200, 404). Value: map of `{ns}localname` → serialized value.
    pub propstats: PropstatMap,
}

/// Parse all `<response>` elements from a `DAV:multistatus` XML body.
///
/// Returns a list of parsed responses, or an error message if parsing fails.
pub fn parse_multistatus(body: &str) -> Result<Vec<MultistatusResponse>, String> {
    let mut reader = Reader::from_str(body);
    reader.config_mut().trim_text(true);

    let mut responses = Vec::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let tag = local_name(e.name().as_ref());
                if tag == "response" {
                    let resp = parse_response_element(&mut reader, &mut buf)?;
                    responses.push(resp);
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML parse error: {e}")),
            _ => {}
        }
        buf.clear();
    }

    Ok(responses)
}

/// Parse a single `<response>` element body (assumes the start tag has been consumed).
fn parse_response_element(
    reader: &mut Reader<&[u8]>,
    buf: &mut Vec<u8>,
) -> Result<MultistatusResponse, String> {
    let mut href = String::new();
    let mut status = None;
    let mut propstats: PropstatMap = HashMap::new();
    let mut depth = 1u32;
    let mut text_buf = String::new();

    loop {
        buf.clear();
        match reader.read_event_into(buf) {
            Ok(Event::Start(ref e)) => {
                let tag = local_name(e.name().as_ref());
                depth += 1;
                text_buf.clear();

                if tag == "propstat" {
                    let (code, props) = parse_propstat_element(reader, buf)?;
                    propstats.insert(code, props);
                    depth -= 1; // parse_propstat consumed the end tag
                }
            }
            Ok(Event::Text(ref e)) => {
                if let Ok(decoded) = reader.decoder().decode(e.as_ref()) {
                    text_buf.push_str(&decoded);
                }
            }
            Ok(Event::End(ref e)) => {
                let tag = local_name(e.name().as_ref());
                depth -= 1;

                match tag.as_str() {
                    "href" => {
                        href = url_decode(text_buf.trim());
                        // Strip trailing slash for comparison
                        if href.len() > 1 && href.ends_with('/') {
                            href.pop();
                        }
                    }
                    "status" => status = Some(text_buf.trim().to_string()),
                    _ => {}
                }
                text_buf.clear();

                if depth == 0 {
                    break;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML error in response: {e}")),
            _ => {}
        }
    }

    Ok(MultistatusResponse {
        href,
        status,
        propstats,
    })
}

/// Parse a single `<propstat>` element body.
///
/// Returns the HTTP status code and a map of property QNames to their serialized values.
fn parse_propstat_element(
    reader: &mut Reader<&[u8]>,
    buf: &mut Vec<u8>,
) -> Result<(u16, PropertyMap), String> {
    let mut status_code = 200u16;
    let mut status_text;
    let mut props: PropertyMap = HashMap::new();
    let mut depth = 1u32;
    let mut text_buf = String::new();

    let mut in_prop = false;
    let mut in_status = false;

    // Track property parsing state
    let mut prop_depth = 0u32;
    let mut current_prop_qname = String::new();
    let mut current_prop_content = String::new();
    let mut prop_child_depth = 0u32;

    loop {
        buf.clear();
        match reader.read_event_into(buf) {
            Ok(Event::Start(ref e)) => {
                let tag = local_name(e.name().as_ref());
                let qname = qualified_name(e.name().as_ref(), e);
                depth += 1;
                text_buf.clear();

                if tag == "prop" && !in_prop {
                    in_prop = true;
                    prop_depth = depth;
                } else if tag == "status" {
                    in_status = true;
                } else if in_prop && depth == prop_depth + 1 {
                    // Direct child of <prop> — this is a property element
                    current_prop_qname = qname;
                    current_prop_content.clear();
                    prop_child_depth = 0;
                } else if in_prop && depth > prop_depth + 1 {
                    // Nested child inside a property — serialize as XML fragment
                    prop_child_depth += 1;
                    current_prop_content.push('<');
                    current_prop_content.push_str(&qname);
                    // Include attributes
                    for attr in e.attributes().flatten() {
                        let key = String::from_utf8_lossy(attr.key.as_ref());
                        let val = String::from_utf8_lossy(&attr.value);
                        current_prop_content.push(' ');
                        current_prop_content.push_str(&key);
                        current_prop_content.push_str("=\"");
                        current_prop_content.push_str(&val);
                        current_prop_content.push('"');
                    }
                    current_prop_content.push('>');
                }
            }
            Ok(Event::Empty(ref e)) => {
                let qname = qualified_name(e.name().as_ref(), e);

                if in_prop && depth == prop_depth {
                    // Self-closing property element like <resourcetype/>
                    props.insert(qname, None);
                } else if in_prop && depth > prop_depth && !current_prop_qname.is_empty() {
                    // Self-closing child inside a property
                    current_prop_content.push('<');
                    current_prop_content.push_str(&qname);
                    current_prop_content.push_str("/>");
                }
            }
            Ok(Event::Text(ref e)) => {
                if let Ok(decoded) = reader.decoder().decode(e.as_ref()) {
                    text_buf.push_str(&decoded);
                    if in_prop && !current_prop_qname.is_empty() {
                        current_prop_content.push_str(&decoded);
                    }
                }
            }
            Ok(Event::End(ref e)) => {
                let tag = local_name(e.name().as_ref());
                depth -= 1;

                if in_status && tag == "status" {
                    status_text = text_buf.trim().to_string();
                    status_code = parse_http_status(&status_text);
                    in_status = false;
                } else if in_prop && depth == prop_depth - 1 && tag == "prop" {
                    in_prop = false;
                } else if in_prop && depth == prop_depth && !current_prop_qname.is_empty() {
                    // End of a property element
                    let value = if current_prop_content.is_empty() {
                        let txt = text_buf.trim();
                        if txt.is_empty() {
                            None
                        } else {
                            Some(txt.to_string())
                        }
                    } else {
                        Some(current_prop_content.clone())
                    };
                    props.insert(std::mem::take(&mut current_prop_qname), value);
                    current_prop_content.clear();
                } else if in_prop && depth > prop_depth && prop_child_depth > 0 {
                    // End of nested child element
                    let qname = qualified_name(e.name().as_ref(), e);
                    current_prop_content.push_str("</");
                    current_prop_content.push_str(&qname);
                    current_prop_content.push('>');
                    prop_child_depth -= 1;
                }

                text_buf.clear();

                if depth == 0 {
                    break;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML error in propstat: {e}")),
            _ => {}
        }
    }

    Ok((status_code, props))
}

/// Determine if a multistatus response status is "OK" (2xx).
#[must_use]
pub fn is_ok_status(status: &Option<String>) -> bool {
    match status {
        Some(s) => {
            // "HTTP/1.1 200 OK" → check character at position 9 (0-indexed)
            if s.starts_with("HTTP/") {
                s.chars().nth(9).is_some_and(|c| c == '2')
            } else {
                // Try parsing as just a status code
                s.trim()
                    .parse::<u16>()
                    .is_ok_and(|code| (200..300).contains(&code))
            }
        }
        // No status with propstat present → treat as OK
        None => true,
    }
}

/// Extract the status code from an HTTP status line.
///
/// Parses `"HTTP/1.1 200 OK"` → `200`.
#[must_use]
pub fn parse_http_status(status_line: &str) -> u16 {
    if status_line.starts_with("HTTP/") {
        status_line
            .split_whitespace()
            .nth(1)
            .and_then(|s| s.parse().ok())
            .unwrap_or(0)
    } else {
        status_line.trim().parse().unwrap_or(0)
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Build a qualified name `{namespace}localname` from a raw tag.
///
/// For tags without a declared namespace the raw local name is used.
fn qualified_name(raw: &[u8], e: &impl QNameSource) -> String {
    let full = String::from_utf8_lossy(raw);
    // If namespace information is available from resolved NS, use it.
    // Otherwise fall back to the raw tag text.
    //
    // quick-xml doesn't resolve namespaces by default, so we do a
    // best-effort: look for `xmlns` on the element itself (rare in
    // practice for property elements inside multistatus).
    //
    // The test-suite values use `{DAV:}displayname` style — so
    // we just reconstruct from the raw bytes, replacing a known
    // prefix with the matching namespace URI.
    let local = local_name(raw);

    // Check for xmlns on this element itself
    if let Some(ns) = e.default_ns() {
        return format!("{{{ns}}}{local}");
    }

    // Fall back: return the local name (no namespace prefix).
    // For DAV: prefix, we know the namespace.
    if let Some(prefix) = full.strip_suffix(&format!(":{local}")) {
        if let Some(ns) = well_known_ns(prefix) {
            return format!("{{{ns}}}{local}");
        }
    }

    local
}

/// Trait to extract a default namespace from an element.
trait QNameSource {
    fn default_ns(&self) -> Option<String>;
}

impl QNameSource for quick_xml::events::BytesStart<'_> {
    fn default_ns(&self) -> Option<String> {
        for attr in self.attributes().flatten() {
            let key = String::from_utf8_lossy(attr.key.as_ref());
            if key == "xmlns" {
                return Some(String::from_utf8_lossy(&attr.value).to_string());
            }
        }
        None
    }
}

impl QNameSource for quick_xml::events::BytesEnd<'_> {
    fn default_ns(&self) -> Option<String> {
        // BytesEnd doesn't carry attributes
        None
    }
}

/// Map well-known XML prefixes to namespace URIs.
#[must_use]
fn well_known_ns(prefix: &str) -> Option<&'static str> {
    match prefix {
        "D" | "d" | "DAV" => Some("DAV:"),
        "C" | "cal" | "CALDAV" => Some("urn:ietf:params:xml:ns:caldav"),
        "CR" | "card" | "CARDDAV" => Some("urn:ietf:params:xml:ns:carddav"),
        "CS" => Some("http://calendarserver.org/ns/"),
        "A" | "apple" => Some("http://apple.com/ns/ical/"),
        _ => None,
    }
}

/// Extract the local name (without namespace prefix) from a raw tag.
#[must_use]
fn local_name(raw: &[u8]) -> String {
    let full = String::from_utf8_lossy(raw);
    full.split(':').next_back().unwrap_or(&full).to_string()
}

/// Percent-decode a URL string.
#[must_use]
fn url_decode(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut chars = input.bytes();

    while let Some(b) = chars.next() {
        if b == b'%' {
            let hi = chars.next().unwrap_or(b'0');
            let lo = chars.next().unwrap_or(b'0');
            let hex = [hi, lo];
            if let Ok(s) = std::str::from_utf8(&hex) {
                if let Ok(byte) = u8::from_str_radix(s, 16) {
                    result.push(byte as char);
                    continue;
                }
            }
            result.push('%');
            result.push(hi as char);
            result.push(lo as char);
        } else {
            result.push(b as char);
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_simple_multistatus() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
        <D:multistatus xmlns:D="DAV:">
            <D:response>
                <D:href>/calendars/user01/calendar/</D:href>
                <D:propstat>
                    <D:prop>
                        <D:displayname>My Calendar</D:displayname>
                        <D:resourcetype><D:collection/></D:resourcetype>
                    </D:prop>
                    <D:status>HTTP/1.1 200 OK</D:status>
                </D:propstat>
                <D:propstat>
                    <D:prop>
                        <D:getcontentlength/>
                    </D:prop>
                    <D:status>HTTP/1.1 404 Not Found</D:status>
                </D:propstat>
            </D:response>
        </D:multistatus>"#;

        let responses = parse_multistatus(xml).unwrap();
        assert_eq!(responses.len(), 1);
        assert_eq!(responses[0].href, "/calendars/user01/calendar");

        let ok_props = responses[0].propstats.get(&200).unwrap();
        assert_eq!(
            ok_props.get("{DAV:}displayname"),
            Some(&Some("My Calendar".to_string()))
        );
        assert!(ok_props.contains_key("{DAV:}resourcetype"));

        let bad_props = responses[0].propstats.get(&404).unwrap();
        assert!(bad_props.contains_key("{DAV:}getcontentlength"));
    }

    #[test]
    fn parse_status_line() {
        assert_eq!(parse_http_status("HTTP/1.1 200 OK"), 200);
        assert_eq!(parse_http_status("HTTP/1.1 404 Not Found"), 404);
        assert_eq!(parse_http_status("207"), 207);
    }

    #[test]
    fn test_is_ok_status() {
        assert!(is_ok_status(&Some("HTTP/1.1 200 OK".to_string())));
        assert!(is_ok_status(&Some("HTTP/1.1 207 Multi-Status".to_string())));
        assert!(!is_ok_status(&Some("HTTP/1.1 404 Not Found".to_string())));
        assert!(is_ok_status(&None));
    }

    #[test]
    fn test_url_decode() {
        assert_eq!(url_decode("/path%20to/file"), "/path to/file");
        assert_eq!(url_decode("/normal"), "/normal");
    }
}
