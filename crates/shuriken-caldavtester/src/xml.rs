//! XML test definition parsing.
//!
//! Parses test files from the Apple CalDAV test suite XML format.

use crate::error::{Error, Result};
use quick_xml::events::Event;
use quick_xml::Reader;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Root test file structure
#[derive(Debug, Clone)]
pub struct CalDavTest {
    /// Test file description
    pub description: Option<String>,
    /// Required features
    pub require_features: Vec<String>,
    /// Excluded features
    pub exclude_features: Vec<String>,
    /// Whether to ignore this test file
    pub ignore: bool,
    /// Start requests
    pub start_requests: Vec<TestRequest>,
    /// Test suites
    pub test_suites: Vec<TestSuite>,
    /// End requests
    pub end_requests: Vec<TestRequest>,
}

/// A test suite grouping related tests
#[derive(Debug, Clone)]
pub struct TestSuite {
    /// Suite name
    pub name: String,
    /// Suite description
    pub description: Option<String>,
    /// Required features for this suite
    pub require_features: Vec<String>,
    /// Excluded features for this suite
    pub exclude_features: Vec<String>,
    /// Tests in this suite
    pub tests: Vec<Test>,
    /// Whether to ignore this suite
    pub ignore: bool,
}

/// An individual test case
#[derive(Debug, Clone)]
pub struct Test {
    /// Test name/identifier
    pub name: String,
    /// Test description
    pub description: Option<String>,
    /// Required features for this test
    pub require_features: Vec<String>,
    /// Excluded features for this test
    pub exclude_features: Vec<String>,
    /// HTTP requests to execute (support multiple requests per test)
    pub requests: Vec<TestRequest>,
    /// Whether to ignore this test
    pub ignore: bool,
}

/// HTTP request specification
#[derive(Debug, Clone)]
pub struct TestRequest {
    /// HTTP method
    pub method: String,
    /// Request URI (may contain substitution variables)
    pub ruri: Option<String>,
    /// Request headers
    pub headers: HashMap<String, String>,
    /// Request body
    pub body: Option<RequestBody>,
    /// Authentication override
    pub auth: Option<AuthConfig>,
    /// Response verifications
    pub verifications: Vec<Verification>,
    /// Headers to grab from response
    pub grab_headers: Vec<GrabHeader>,
    /// Whether to delete this resource at end
    pub end_delete: bool,
}
/// Request body specification
#[derive(Debug, Clone)]
pub enum RequestBody {
    /// Body from file
    File {
        path: PathBuf,
        content_type: String,
    },
    /// Direct body content
    Inline {
        content: String,
        content_type: String,
    },
}

/// Authentication configuration
#[derive(Debug, Clone)]
pub struct AuthConfig {
    pub user: String,
    pub password: String,
}

/// Response verification specification
#[derive(Debug, Clone)]
pub struct Verification {
    /// Verification callback type
    pub callback: String,
    /// Verification arguments (name -> list of values)
    pub args: HashMap<String, Vec<String>>,
}

/// Header value to capture
#[derive(Debug, Clone)]
pub struct GrabHeader {
    /// Header name
    pub name: String,
    /// Variable to store value in
    pub variable: String,
}

/// ## Summary
/// Parse a CalDAV test file from XML.
///
/// ## Errors
/// Returns an error if the XML cannot be parsed or has invalid structure.
pub fn parse_test_file(path: &Path) -> Result<CalDavTest> {
    let xml_content = std::fs::read_to_string(path).map_err(|e| Error::XmlParse {
        file: path.to_path_buf(),
        source: quick_xml::Error::Io(std::sync::Arc::new(e)),
    })?;

    parse_test_xml(&xml_content, path)
}

/// ## Summary
/// Parse CalDAV test XML content.
///
/// ## Errors
/// Returns an error if the XML is malformed.
fn parse_test_xml(xml: &str, source_path: &Path) -> Result<CalDavTest> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut test = CalDavTest {
        description: None,
        require_features: Vec::new(),
        exclude_features: Vec::new(),
        ignore: false,
        start_requests: Vec::new(),
        test_suites: Vec::new(),
        end_requests: Vec::new(),
    };

    let mut buf = Vec::new();
    let mut depth_stack: Vec<String> = Vec::new();
    let mut in_require_feature = false;
    let mut in_exclude_feature = false;
    let mut in_start = false;
    let mut in_end = false;
    let mut text_buf = String::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let tag = local_name(e.name().as_ref());
                depth_stack.push(tag.clone());
                text_buf.clear();

                match tag.as_str() {
                    "require-feature" => in_require_feature = true,
                    "exclude-feature" => in_exclude_feature = true,
                    "start" => in_start = true,
                    "end" => in_end = true,
                    "test-suite" => {
                        let name = get_attr(e, "name").unwrap_or_default();
                        let ignore = get_attr(e, "ignore")
                            .is_ok_and(|v| v == "yes");
                        let suite = parse_test_suite_body(&mut reader, &mut buf, name, ignore)?;
                        test.test_suites.push(suite);
                        depth_stack.pop(); // parse_test_suite_body consumed the end tag
                    }
                    "request" if in_start || in_end => {
                        let end_delete = get_attr(e, "end-delete")
                            .is_ok_and(|v| v == "yes");
                        let req = parse_request_body(&mut reader, &mut buf, end_delete)?;
                        if in_start {
                            test.start_requests.push(req);
                        } else {
                            test.end_requests.push(req);
                        }
                        depth_stack.pop(); // parse consumed end tag
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(ref e)) => {
                let tag = local_name(e.name().as_ref());
                match tag.as_str() {
                    "start" => { /* empty start block */ }
                    "end" => { /* empty end block */ }
                    _ => {}
                }
            }
            Ok(Event::Text(ref e)) => {
                if let Ok(decoded) = reader.decoder().decode(e.as_ref()) {
                    text_buf.push_str(&decoded);
                }
            }
            Ok(Event::CData(ref e)) => {
                if let Ok(decoded) = std::str::from_utf8(e.as_ref()) {
                    text_buf.push_str(decoded);
                }
            }
            Ok(Event::End(ref e)) => {
                let tag = local_name(e.name().as_ref());
                match tag.as_str() {
                    "description" if depth_stack.len() <= 2 => {
                        test.description = Some(text_buf.trim().to_string());
                    }
                    "feature" if in_require_feature => {
                        test.require_features.push(text_buf.trim().to_string());
                    }
                    "feature" if in_exclude_feature => {
                        test.exclude_features.push(text_buf.trim().to_string());
                    }
                    "require-feature" => in_require_feature = false,
                    "exclude-feature" => in_exclude_feature = false,
                    "start" => in_start = false,
                    "end" => in_end = false,
                    _ => {}
                }
                text_buf.clear();
                depth_stack.pop();
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return Err(Error::XmlParse {
                    file: source_path.to_path_buf(),
                    source: e,
                });
            }
            _ => {}
        }
        buf.clear();
    }

    Ok(test)
}

/// Parse the body of a `<test-suite>` element.
fn parse_test_suite_body(
    reader: &mut Reader<&[u8]>,
    buf: &mut Vec<u8>,
    name: String,
    ignore: bool,
) -> Result<TestSuite> {
    let mut suite = TestSuite {
        name,
        description: None,
        require_features: Vec::new(),
        exclude_features: Vec::new(),
        tests: Vec::new(),
        ignore,
    };

    let mut in_require_feature = false;
    let mut in_exclude_feature = false;
    let mut text_buf = String::new();
    let mut depth = 1u32;

    loop {
        buf.clear();
        match reader.read_event_into(buf) {
            Ok(Event::Start(ref e)) => {
                let tag = local_name(e.name().as_ref());
                depth += 1;
                text_buf.clear();

                match tag.as_str() {
                    "require-feature" => in_require_feature = true,
                    "exclude-feature" => in_exclude_feature = true,
                    "test" => {
                        let test_name = get_attr(e, "name").unwrap_or_default();
                        let test_ignore = get_attr(e, "ignore")
                            .is_ok_and(|v| v == "yes");
                        let test = parse_test_body(reader, buf, test_name, test_ignore)?;
                        suite.tests.push(test);
                        depth -= 1; // parse consumed end tag
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(ref e)) => {
                if let Ok(decoded) = reader.decoder().decode(e.as_ref()) {
                    text_buf.push_str(&decoded);
                }
            }
            Ok(Event::CData(ref e)) => {
                if let Ok(decoded) = std::str::from_utf8(e.as_ref()) {
                    text_buf.push_str(decoded);
                }
            }
            Ok(Event::End(ref e)) => {
                let tag = local_name(e.name().as_ref());
                depth -= 1;

                match tag.as_str() {
                    "feature" if in_require_feature => {
                        suite.require_features.push(text_buf.trim().to_string());
                    }
                    "feature" if in_exclude_feature => {
                        suite.exclude_features.push(text_buf.trim().to_string());
                    }
                    "require-feature" => in_require_feature = false,
                    "exclude-feature" => in_exclude_feature = false,
                    _ => {}
                }
                text_buf.clear();

                if depth == 0 {
                    break;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(Error::Other(format!("XML error in test-suite: {e}"))),
            _ => {}
        }
    }

    Ok(suite)
}

/// Parse the body of a `<test>` element.
fn parse_test_body(
    reader: &mut Reader<&[u8]>,
    buf: &mut Vec<u8>,
    name: String,
    ignore: bool,
) -> Result<Test> {
    let mut test = Test {
        name,
        description: None,
        require_features: Vec::new(),
        exclude_features: Vec::new(),
        requests: Vec::new(),
        ignore,
    };

    let mut in_require_feature = false;
    let mut in_exclude_feature = false;
    let mut text_buf = String::new();
    let mut depth = 1u32;

    loop {
        buf.clear();
        match reader.read_event_into(buf) {
            Ok(Event::Start(ref e)) => {
                let tag = local_name(e.name().as_ref());
                depth += 1;
                text_buf.clear();

                match tag.as_str() {
                    "require-feature" => in_require_feature = true,
                    "exclude-feature" => in_exclude_feature = true,
                    "request" => {
                        let end_delete = get_attr(e, "end-delete")
                            .is_ok_and(|v| v == "yes");
                        let req = parse_request_body(reader, buf, end_delete)?;
                        test.requests.push(req);
                        depth -= 1; // parse consumed end tag
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(ref e)) => {
                if let Ok(decoded) = reader.decoder().decode(e.as_ref()) {
                    text_buf.push_str(&decoded);
                }
            }
            Ok(Event::CData(ref e)) => {
                if let Ok(decoded) = std::str::from_utf8(e.as_ref()) {
                    text_buf.push_str(decoded);
                }
            }
            Ok(Event::End(ref e)) => {
                let tag = local_name(e.name().as_ref());
                depth -= 1;

                match tag.as_str() {
                    "description" => {
                        test.description = Some(text_buf.trim().to_string());
                    }
                    "feature" if in_require_feature => {
                        test.require_features.push(text_buf.trim().to_string());
                    }
                    "feature" if in_exclude_feature => {
                        test.exclude_features.push(text_buf.trim().to_string());
                    }
                    "require-feature" => in_require_feature = false,
                    "exclude-feature" => in_exclude_feature = false,
                    _ => {}
                }
                text_buf.clear();

                if depth == 0 {
                    break;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(Error::Other(format!("XML error in test: {e}"))),
            _ => {}
        }
    }

    Ok(test)
}

/// Parse the body of a `<request>` element.
fn parse_request_body(
    reader: &mut Reader<&[u8]>,
    buf: &mut Vec<u8>,
    end_delete: bool,
) -> Result<TestRequest> {
    let mut req = TestRequest {
        method: String::new(),
        ruri: None,
        headers: HashMap::new(),
        body: None,
        auth: None,
        verifications: Vec::new(),
        grab_headers: Vec::new(),
        end_delete,
    };

    let mut text_buf = String::new();
    let mut depth = 1u32;

    // Temporary state for nested elements
    let mut in_header = false;
    let mut header_name = String::new();
    let mut header_value = String::new();

    let mut in_data = false;
    let mut data_content_type = String::new();
    let mut data_filepath: Option<String> = None;

    let mut in_verify = false;
    let mut verify_callback = String::new();
    let mut verify_args: HashMap<String, Vec<String>> = HashMap::new();

    let mut in_arg = false;
    let mut arg_name = String::new();
    let mut arg_values: Vec<String> = Vec::new();

    let mut in_grabheader = false;
    let mut grab_name = String::new();
    let mut grab_variable = String::new();

    loop {
        buf.clear();
        match reader.read_event_into(buf) {
            Ok(Event::Start(ref e)) => {
                let tag = local_name(e.name().as_ref());
                depth += 1;
                text_buf.clear();

                match tag.as_str() {
                    "header" => {
                        in_header = true;
                        header_name.clear();
                        header_value.clear();
                    }
                    "data" => {
                        in_data = true;
                        data_content_type.clear();
                        data_filepath = None;
                    }
                    "verify" => {
                        in_verify = true;
                        verify_callback.clear();
                        verify_args.clear();
                    }
                    "arg" if in_verify => {
                        in_arg = true;
                        arg_name.clear();
                        arg_values.clear();
                    }
                    "grabheader" => {
                        in_grabheader = true;
                        grab_name.clear();
                        grab_variable.clear();
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(ref e)) => {
                // Some elements may be self-closing, ignore them
                let _tag = local_name(e.name().as_ref());
            }
            Ok(Event::Text(ref e)) => {
                if let Ok(decoded) = reader.decoder().decode(e.as_ref()) {
                    text_buf.push_str(&decoded);
                }
            }
            Ok(Event::CData(ref e)) => {
                if let Ok(decoded) = std::str::from_utf8(e.as_ref()) {
                    text_buf.push_str(decoded);
                }
            }
            Ok(Event::End(ref e)) => {
                let tag = local_name(e.name().as_ref());
                depth -= 1;

                match tag.as_str() {
                    "method" => req.method = text_buf.trim().to_string(),
                    "ruri" => req.ruri = Some(text_buf.trim().to_string()),

                    // Header elements
                    "name" if in_header && !in_verify => {
                        header_name = text_buf.trim().to_string();
                    }
                    "value" if in_header && !in_verify => {
                        header_value = text_buf.trim().to_string();
                    }
                    "header" if !in_verify => {
                        if !header_name.is_empty() {
                            req.headers.insert(header_name.clone(), header_value.clone());
                        }
                        in_header = false;
                    }

                    // Data elements
                    "content-type" if in_data => {
                        data_content_type = text_buf.trim().to_string();
                    }
                    "filepath" if in_data => {
                        data_filepath = Some(text_buf.trim().to_string());
                    }
                    "data" => {
                        if let Some(ref fp) = data_filepath {
                            req.body = Some(RequestBody::File {
                                path: PathBuf::from(fp),
                                content_type: data_content_type.clone(),
                            });
                        }
                        in_data = false;
                    }

                    // Verify elements
                    "callback" if in_verify => {
                        verify_callback = text_buf.trim().to_string();
                    }
                    "name" if in_arg => {
                        arg_name = text_buf.trim().to_string();
                    }
                    "value" if in_arg => {
                        arg_values.push(text_buf.trim().to_string());
                    }
                    "arg" if in_verify => {
                        if !arg_name.is_empty() {
                            verify_args.insert(arg_name.clone(), arg_values.clone());
                        }
                        in_arg = false;
                    }
                    "verify" => {
                        req.verifications.push(Verification {
                            callback: verify_callback.clone(),
                            args: verify_args.clone(),
                        });
                        in_verify = false;
                    }

                    // Grab header elements
                    "name" if in_grabheader => {
                        grab_name = text_buf.trim().to_string();
                    }
                    "variable" if in_grabheader => {
                        grab_variable = text_buf.trim().to_string();
                    }
                    "grabheader" => {
                        req.grab_headers.push(GrabHeader {
                            name: grab_name.clone(),
                            variable: grab_variable.clone(),
                        });
                        in_grabheader = false;
                    }

                    _ => {}
                }
                text_buf.clear();

                if depth == 0 {
                    break;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(Error::Other(format!("XML error in request: {e}"))),
            _ => {}
        }
    }

    Ok(req)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Extract the local name (without namespace prefix) from an element tag.
#[must_use]
fn local_name(raw: &[u8]) -> String {
    let full = String::from_utf8_lossy(raw);
    full.split(':')
        .next_back()
        .unwrap_or(&full)
        .to_string()
}

/// Get an attribute value from an element.
fn get_attr(
    e: &quick_xml::events::BytesStart<'_>,
    name: &str,
) -> std::result::Result<String, String> {
    for attr in e.attributes().flatten() {
        let key = String::from_utf8_lossy(attr.key.as_ref());
        if key == name {
            return Ok(String::from_utf8_lossy(&attr.value).to_string());
        }
    }
    Err(format!("attribute '{name}' not found"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_minimal_test_file() {
        let xml = r#"<?xml version="1.0"?>
        <caldavtest>
            <description>Test description</description>
            <require-feature>
                <feature>caldav</feature>
            </require-feature>
            <start/>
            <test-suite name="Basic">
                <test name="1">
                    <description>Test one</description>
                    <request>
                        <method>GET</method>
                        <ruri>/path</ruri>
                        <verify>
                            <callback>statusCode</callback>
                            <arg>
                                <name>status</name>
                                <value>200</value>
                            </arg>
                        </verify>
                    </request>
                </test>
            </test-suite>
            <end/>
        </caldavtest>"#;

        let result = parse_test_xml(xml, Path::new("test.xml")).unwrap();
        assert_eq!(result.description.as_deref(), Some("Test description"));
        assert_eq!(result.require_features, vec!["caldav"]);
        assert_eq!(result.test_suites.len(), 1);

        let suite = &result.test_suites[0];
        assert_eq!(suite.name, "Basic");
        assert_eq!(suite.tests.len(), 1);

        let test = &suite.tests[0];
        assert_eq!(test.name, "1");
        assert_eq!(test.description.as_deref(), Some("Test one"));
        assert_eq!(test.requests.len(), 1);

        let req = &test.requests[0];
        assert_eq!(req.method, "GET");
        assert_eq!(req.ruri.as_deref(), Some("/path"));
        assert_eq!(req.verifications.len(), 1);
        assert_eq!(req.verifications[0].callback, "statusCode");
        assert_eq!(
            req.verifications[0].args.get("status").unwrap(),
            &vec!["200".to_string()]
        );
    }

    #[test]
    fn parse_with_headers_and_data() {
        let xml = r#"<?xml version="1.0"?>
        <caldavtest>
            <description>PUT test</description>
            <start>
                <request end-delete="yes">
                    <method>PUT</method>
                    <ruri>$calendarpath1:/1.ics</ruri>
                    <data>
                        <content-type>text/calendar; charset=utf-8</content-type>
                        <filepath>Resource/CalDAV/test.txt</filepath>
                    </data>
                </request>
            </start>
            <test-suite name="Test">
                <test name="1">
                    <request>
                        <method>PROPFIND</method>
                        <ruri>$calendarpath1:/</ruri>
                        <header>
                            <name>Depth</name>
                            <value>0</value>
                        </header>
                        <verify>
                            <callback>statusCode</callback>
                            <arg>
                                <name>status</name>
                                <value>207</value>
                            </arg>
                        </verify>
                    </request>
                </test>
            </test-suite>
            <end/>
        </caldavtest>"#;

        let result = parse_test_xml(xml, Path::new("test.xml")).unwrap();
        assert_eq!(result.start_requests.len(), 1);
        assert!(result.start_requests[0].end_delete);
        assert_eq!(result.start_requests[0].method, "PUT");

        let req = &result.test_suites[0].tests[0].requests[0];
        assert_eq!(req.method, "PROPFIND");
        assert_eq!(req.headers.get("Depth").unwrap(), "0");
    }

    #[test]
    fn parse_multiple_requests_per_test() {
        let xml = r#"<?xml version="1.0"?>
        <caldavtest>
            <description>Multi-request test</description>
            <start/>
            <test-suite name="Multi">
                <test name="1">
                    <description>PUT then GET</description>
                    <request end-delete="yes">
                        <method>PUT</method>
                        <ruri>/path/1.ics</ruri>
                        <verify>
                            <callback>statusCode</callback>
                        </verify>
                    </request>
                    <request>
                        <method>GET</method>
                        <ruri>/path/1.ics</ruri>
                        <verify>
                            <callback>statusCode</callback>
                            <arg>
                                <name>status</name>
                                <value>200</value>
                            </arg>
                        </verify>
                    </request>
                </test>
            </test-suite>
            <end/>
        </caldavtest>"#;

        let result = parse_test_xml(xml, Path::new("test.xml")).unwrap();
        let test = &result.test_suites[0].tests[0];
        assert_eq!(test.requests.len(), 2);
        assert_eq!(test.requests[0].method, "PUT");
        assert_eq!(test.requests[1].method, "GET");
    }
}
