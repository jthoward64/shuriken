//! Multistatus XML serialization.

use quick_xml::Writer;
use quick_xml::events::{BytesDecl, BytesEnd, BytesStart, BytesText, Event};

use crate::component::rfc::dav::core::{Multistatus, PropstatResponse};

/// Serializes a multistatus response to XML.
///
/// ## Summary
/// Converts a `Multistatus` response structure into properly formatted
/// `WebDAV` XML for the response body.
///
/// ## Errors
/// Returns an error if XML writing fails or if the generated XML is not valid UTF-8
/// (which should never happen with well-formed input).
pub fn serialize_multistatus(multistatus: &Multistatus) -> Result<String, quick_xml::Error> {
    let mut writer = Writer::new(Vec::new());

    // XML declaration
    writer.write_event(Event::Decl(BytesDecl::new("1.0", Some("utf-8"), None)))?;

    // Start multistatus element with namespace
    let mut elem = BytesStart::new("D:multistatus");
    elem.push_attribute(("xmlns:D", "DAV:"));
    elem.push_attribute(("xmlns:C", "urn:ietf:params:xml:ns:caldav"));
    elem.push_attribute(("xmlns:CR", "urn:ietf:params:xml:ns:carddav"));
    writer.write_event(Event::Start(elem))?;

    // Write each response
    for response in &multistatus.responses {
        write_response(&mut writer, response)?;
    }

    // Response description if present
    if let Some(ref desc) = multistatus.description {
        write_text_element(&mut writer, "D:responsedescription", desc)?;
    }

    // Sync token if present
    if let Some(ref token) = multistatus.sync_token {
        write_text_element(&mut writer, "D:sync-token", token)?;
    }

    // End multistatus
    writer.write_event(Event::End(BytesEnd::new("D:multistatus")))?;

    let result = writer.into_inner();
    String::from_utf8(result).map_err(|e| {
        tracing::error!("Generated invalid UTF-8 in multistatus XML: {}", e);
        quick_xml::Error::Io(std::sync::Arc::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Invalid UTF-8 in XML output",
        )))
    })
}

/// Writes a single response element.
fn write_response<W: std::io::Write>(
    writer: &mut Writer<W>,
    response: &PropstatResponse,
) -> Result<(), quick_xml::Error> {
    writer.write_event(Event::Start(BytesStart::new("D:response")))?;

    // Write href
    write_text_element(writer, "D:href", response.href.as_str())?;

    // Write each propstat
    for propstat in &response.propstats {
        writer.write_event(Event::Start(BytesStart::new("D:propstat")))?;

        // Write prop container
        writer.write_event(Event::Start(BytesStart::new("D:prop")))?;

        for prop in &propstat.properties {
            write_property(writer, prop)?;
        }

        writer.write_event(Event::End(BytesEnd::new("D:prop")))?;

        // Write status using the existing status_line method
        write_text_element(writer, "D:status", &propstat.status.status_line())?;

        // Description if present
        if let Some(ref desc) = propstat.description {
            write_text_element(writer, "D:responsedescription", desc)?;
        }

        writer.write_event(Event::End(BytesEnd::new("D:propstat")))?;
    }

    // Response description if present
    if let Some(ref desc) = response.description {
        write_text_element(writer, "D:responsedescription", desc)?;
    }

    writer.write_event(Event::End(BytesEnd::new("D:response")))?;

    Ok(())
}

/// Writes a property element.
#[expect(clippy::too_many_lines)]
fn write_property<W: std::io::Write>(
    writer: &mut Writer<W>,
    prop: &crate::component::rfc::dav::core::DavProperty,
) -> Result<(), quick_xml::Error> {
    use crate::component::rfc::dav::core::property::PropertyValue;

    let prefix = namespace_prefix(prop.name.namespace_uri());
    let elem_name = format!("{}:{}", prefix, prop.name.local_name());

    match &prop.value {
        Some(PropertyValue::Text(text)) => {
            write_text_element(writer, &elem_name, text)?;
        }
        Some(PropertyValue::Href(href)) => {
            writer.write_event(Event::Start(BytesStart::new(&elem_name)))?;
            write_text_element(writer, "D:href", href)?;
            writer.write_event(Event::End(BytesEnd::new(&elem_name)))?;
        }
        Some(PropertyValue::HrefSet(hrefs)) => {
            writer.write_event(Event::Start(BytesStart::new(&elem_name)))?;
            for href in hrefs {
                write_text_element(writer, "D:href", href)?;
            }
            writer.write_event(Event::End(BytesEnd::new(&elem_name)))?;
        }
        Some(PropertyValue::Integer(n)) => {
            write_text_element(writer, &elem_name, &n.to_string())?;
        }
        Some(PropertyValue::DateTime(dt)) => {
            let formatted = dt.format("%Y-%m-%dT%H:%M:%SZ").to_string();
            write_text_element(writer, &elem_name, &formatted)?;
        }
        Some(PropertyValue::ResourceType(types)) => {
            writer.write_event(Event::Start(BytesStart::new(&elem_name)))?;
            for rt in types {
                let rt_prefix = namespace_prefix(rt.namespace_uri());
                let rt_name = format!("{}:{}", rt_prefix, rt.local_name());
                writer.write_event(Event::Empty(BytesStart::new(&rt_name)))?;
            }
            writer.write_event(Event::End(BytesEnd::new(&elem_name)))?;
        }
        Some(PropertyValue::SupportedReports(reports)) => {
            writer.write_event(Event::Start(BytesStart::new(&elem_name)))?;
            for report in reports {
                writer.write_event(Event::Start(BytesStart::new("D:supported-report")))?;
                writer.write_event(Event::Start(BytesStart::new("D:report")))?;
                let r_prefix = namespace_prefix(report.namespace_uri());
                let r_name = format!("{}:{}", r_prefix, report.local_name());
                writer.write_event(Event::Empty(BytesStart::new(&r_name)))?;
                writer.write_event(Event::End(BytesEnd::new("D:report")))?;
                writer.write_event(Event::End(BytesEnd::new("D:supported-report")))?;
            }
            writer.write_event(Event::End(BytesEnd::new(&elem_name)))?;
        }
        Some(PropertyValue::SupportedComponents(components)) => {
            writer.write_event(Event::Start(BytesStart::new(&elem_name)))?;
            for comp in components {
                let mut comp_elem = BytesStart::new("C:comp");
                comp_elem.push_attribute(("name", comp.as_str()));
                writer.write_event(Event::Empty(comp_elem))?;
            }
            writer.write_event(Event::End(BytesEnd::new(&elem_name)))?;
        }
        Some(PropertyValue::ContentData(data)) => {
            write_text_element(writer, &elem_name, data)?;
        }
        Some(PropertyValue::Xml(xml)) => {
            // Raw XML content - write element then raw content
            writer.write_event(Event::Start(BytesStart::new(&elem_name)))?;
            // Note: This writes raw XML which should be well-formed
            writer
                .get_mut()
                .write_all(xml.as_bytes())
                .map_err(|e| quick_xml::Error::Io(std::sync::Arc::new(std::io::Error::other(e))))?;
            writer.write_event(Event::End(BytesEnd::new(&elem_name)))?;
        }
        Some(PropertyValue::Empty) | None => {
            // Empty element
            writer.write_event(Event::Empty(BytesStart::new(&elem_name)))?;
        }
    }

    Ok(())
}

/// Writes a simple text element.
fn write_text_element<W: std::io::Write>(
    writer: &mut Writer<W>,
    name: &str,
    text: &str,
) -> Result<(), quick_xml::Error> {
    writer.write_event(Event::Start(BytesStart::new(name)))?;
    writer.write_event(Event::Text(BytesText::new(text)))?;
    writer.write_event(Event::End(BytesEnd::new(name)))?;
    Ok(())
}

/// Gets the namespace prefix for a given namespace URI.
fn namespace_prefix(ns: &str) -> &'static str {
    match ns {
        "DAV:" => "D",
        "urn:ietf:params:xml:ns:caldav" => "C",
        "urn:ietf:params:xml:ns:carddav" => "CR",
        "http://calendarserver.org/ns/" => "CS",
        _ => "X",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::component::rfc::dav::core::{
        DavProperty, Href, Propstat, QName, Status, property::PropertyValue,
    };

    #[test]
    fn serialize_simple_multistatus() {
        let propstat = Propstat {
            properties: vec![DavProperty {
                name: QName::dav("displayname"),
                value: Some(PropertyValue::Text("My Calendar".to_string())),
            }],
            status: Status::Ok,
            description: None,
        };

        let response = PropstatResponse {
            href: Href::new("/calendars/user/default/"),
            propstats: vec![propstat],
            error: None,
            description: None,
        };

        let multistatus = Multistatus {
            responses: vec![response],
            description: None,
            sync_token: None,
        };

        let xml = serialize_multistatus(&multistatus).unwrap();

        assert!(xml.contains("D:multistatus"));
        assert!(xml.contains("D:response"));
        assert!(xml.contains("D:displayname"));
        assert!(xml.contains("My Calendar"));
        assert!(xml.contains("HTTP/1.1 200 OK"));
    }

    #[test]
    fn serialize_with_sync_token() {
        let multistatus = Multistatus {
            responses: Vec::new(),
            description: None,
            sync_token: Some("http://example.com/sync/12345".to_string()),
        };

        let xml = serialize_multistatus(&multistatus).unwrap();

        assert!(xml.contains("D:sync-token"));
        assert!(xml.contains("http://example.com/sync/12345"));
    }
}
