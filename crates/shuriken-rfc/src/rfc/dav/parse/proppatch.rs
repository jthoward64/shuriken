//! PROPPATCH request XML parsing.

use quick_xml::Reader;
use quick_xml::events::Event;

use super::error::{ParseError, ParseResult};
use super::validate_numeric_char_refs;
use crate::rfc::dav::core::{
    DavProperty, Namespace, PropertyValue, ProppatchRequest, QName, SetOrRemove,
};

/// Parses a PROPPATCH request body.
///
/// ## Summary
/// Parses the XML body of a PROPPATCH request and returns the
/// parsed request structure.
///
/// ## Errors
/// Returns an error if the XML is malformed.
///
/// ## Panics
/// This function does not panic. Internal unwraps are guarded by
/// prior conditional checks ensuring the values are present.
#[expect(
    clippy::too_many_lines,
    clippy::unwrap_used,
    clippy::cognitive_complexity
)]
pub fn parse_proppatch(xml: &[u8]) -> ParseResult<ProppatchRequest> {
    validate_numeric_char_refs(xml)?;
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);

    let mut buf = Vec::new();
    let mut text_buf = String::new();
    let mut namespaces: Vec<(String, String)> = Vec::new();

    let mut request = ProppatchRequest::new();
    let mut current_operation: Option<SetOrRemove> = None;
    let mut in_prop = false;
    let mut current_prop_name: Option<QName> = None;
    let mut property_depth = 0;
    let mut property_content = String::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let local_name_bytes = e.local_name();
                let local_name = std::str::from_utf8(local_name_bytes.as_ref())?.to_owned();

                // Collect namespace declarations
                for attr in e.attributes().flatten() {
                    let key = std::str::from_utf8(attr.key.as_ref())?;
                    let value = std::str::from_utf8(&attr.value)?;
                    if let Some(prefix) = key.strip_prefix("xmlns:") {
                        namespaces.push((prefix.to_string(), value.to_string()));
                    } else if key == "xmlns" {
                        namespaces.push((String::new(), value.to_string()));
                    } else {
                        // Other attributes ignored
                    }
                }

                match local_name.as_str() {
                    "set" => {
                        current_operation = Some(SetOrRemove::Set);
                    }
                    "remove" => {
                        current_operation = Some(SetOrRemove::Remove);
                    }
                    "prop" if current_operation.is_some() => {
                        in_prop = true;
                    }
                    _ if in_prop => {
                        if current_prop_name.is_none() {
                            // This is the property element
                            current_prop_name = Some(resolve_qname(e, &namespaces)?);
                            property_depth = 1;
                            property_content.clear();
                        } else {
                            // Nested element within property
                            property_depth += 1;
                            // Capture as raw XML
                            let name_bytes = e.name();
                            let name = std::str::from_utf8(name_bytes.as_ref())?;
                            property_content.push('<');
                            property_content.push_str(name);
                            property_content.push('>');
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(ref e)) => {
                let local_name_bytes = e.local_name();
                let _local_name = std::str::from_utf8(local_name_bytes.as_ref())?.to_owned();

                // Collect namespace declarations
                for attr in e.attributes().flatten() {
                    let key = std::str::from_utf8(attr.key.as_ref())?;
                    let value = std::str::from_utf8(&attr.value)?;
                    if let Some(prefix) = key.strip_prefix("xmlns:") {
                        namespaces.push((prefix.to_string(), value.to_string()));
                    } else if key == "xmlns" {
                        namespaces.push((String::new(), value.to_string()));
                    } else {
                        // Other attributes ignored
                    }
                }

                if in_prop {
                    if current_prop_name.is_none() {
                        // Empty property element (for remove or empty set)
                        let qname = resolve_qname(e, &namespaces)?;

                        match current_operation {
                            Some(SetOrRemove::Set) => {
                                request.set(DavProperty::empty(qname));
                            }
                            Some(SetOrRemove::Remove) => {
                                request.remove(qname);
                            }
                            None => {}
                        }
                    } else {
                        // Nested empty element within property
                        let name_bytes = e.name();
                        let name = std::str::from_utf8(name_bytes.as_ref())?;
                        property_content.push('<');
                        property_content.push_str(name);
                        // Capture attributes
                        for attr in e.attributes().flatten() {
                            let key = std::str::from_utf8(attr.key.as_ref())?;
                            let value = std::str::from_utf8(&attr.value)?;
                            property_content.push(' ');
                            property_content.push_str(key);
                            property_content.push_str("=\"");
                            property_content.push_str(value);
                            property_content.push('"');
                        }
                        property_content.push_str("/>");
                    }
                }
            }
            Ok(Event::Text(ref e)) => {
                if current_prop_name.is_some() {
                    text_buf.clear();
                    let decoded = reader.decoder().decode(e.as_ref())?;
                    property_content.push_str(&decoded);
                }
            }
            Ok(Event::CData(ref e)) => {
                if current_prop_name.is_some() {
                    let text = std::str::from_utf8(e.as_ref())?;
                    property_content.push_str(text);
                }
            }
            Ok(Event::End(ref e)) => {
                let local_name_bytes = e.local_name();
                let local_name = std::str::from_utf8(local_name_bytes.as_ref())?.to_owned();

                match local_name.as_str() {
                    "set" | "remove" => {
                        current_operation = None;
                    }
                    "prop" if current_operation.is_some() => {
                        in_prop = false;
                    }
                    _ if in_prop && current_prop_name.is_some() => {
                        property_depth -= 1;

                        if property_depth == 0 {
                            // End of property element
                            let qname = current_prop_name.take().unwrap();

                            match current_operation {
                                Some(SetOrRemove::Set) => {
                                    let value = if property_content.trim().is_empty() {
                                        PropertyValue::Empty
                                    } else if property_content.contains('<') {
                                        PropertyValue::Xml(property_content.clone())
                                    } else {
                                        PropertyValue::Text(property_content.clone())
                                    };

                                    request.set(DavProperty {
                                        name: qname,
                                        value: Some(value),
                                    });
                                }
                                Some(SetOrRemove::Remove) => {
                                    request.remove(qname);
                                }
                                None => {}
                            }

                            property_content.clear();
                        } else {
                            // End of nested element
                            let name_bytes = e.name();
                            let name = std::str::from_utf8(name_bytes.as_ref())?;
                            property_content.push_str("</");
                            property_content.push_str(name);
                            property_content.push('>');
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(ParseError::xml(e.to_string())),
            _ => {}
        }
        buf.clear();
    }

    Ok(request)
}

/// Resolves a `QName` from an element.
fn resolve_qname(
    e: &quick_xml::events::BytesStart<'_>,
    namespaces: &[(String, String)],
) -> ParseResult<QName> {
    let name_bytes = e.name();
    let name = std::str::from_utf8(name_bytes.as_ref())?.to_owned();

    let (prefix, local_name) = if let Some(colon_pos) = name.find(':') {
        (
            name[..colon_pos].to_owned(),
            name[colon_pos + 1..].to_owned(),
        )
    } else {
        (String::new(), name)
    };

    let namespace = namespaces
        .iter()
        .rev()
        .find(|(p, _)| *p == prefix)
        .map_or("DAV:", |(_, ns)| ns.as_str());

    Ok(QName::new(
        Namespace::new(namespace.to_string()),
        local_name,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_set_displayname() {
        let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <D:displayname>New Calendar Name</D:displayname>
    </D:prop>
  </D:set>
</D:propertyupdate>"#;

        let req = parse_proppatch(xml).unwrap();
        let sets = req.sets();

        assert_eq!(sets.len(), 1);
        assert_eq!(sets[0].name.local_name(), "displayname");

        match &sets[0].value {
            Some(PropertyValue::Text(s)) => assert_eq!(s, "New Calendar Name"),
            _ => panic!("expected text value"),
        }
    }

    #[test]
    fn parse_remove_property() {
        let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:remove>
    <D:prop>
      <C:calendar-description/>
    </D:prop>
  </D:remove>
</D:propertyupdate>"#;

        let req = parse_proppatch(xml).unwrap();
        let removes = req.removes();

        assert_eq!(removes.len(), 1);
        assert_eq!(removes[0].local_name(), "calendar-description");
    }

    #[test]
    fn parse_mixed_operations() {
        let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set>
    <D:prop>
      <D:displayname>New Name</D:displayname>
    </D:prop>
  </D:set>
  <D:remove>
    <D:prop>
      <C:calendar-description/>
    </D:prop>
  </D:remove>
  <D:set>
    <D:prop>
      <C:calendar-timezone>BEGIN:VTIMEZONE...</C:calendar-timezone>
    </D:prop>
  </D:set>
</D:propertyupdate>"#;

        let req = parse_proppatch(xml).unwrap();

        assert_eq!(req.sets().len(), 2);
        assert_eq!(req.removes().len(), 1);
    }

    #[test]
    fn parse_xml_content() {
        let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set>
    <D:prop>
      <C:supported-calendar-component-set>
        <C:comp name="VEVENT"/>
        <C:comp name="VTODO"/>
      </C:supported-calendar-component-set>
    </D:prop>
  </D:set>
</D:propertyupdate>"#;

        let req = parse_proppatch(xml).unwrap();
        let sets = req.sets();

        assert_eq!(sets.len(), 1);
        match &sets[0].value {
            Some(PropertyValue::Xml(s)) => {
                assert!(s.contains("VEVENT"));
                assert!(s.contains("VTODO"));
            }
            _ => panic!("expected XML value"),
        }
    }
}
