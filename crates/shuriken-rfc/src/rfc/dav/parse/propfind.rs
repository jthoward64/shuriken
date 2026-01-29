//! PROPFIND request XML parsing.

use quick_xml::Reader;
use quick_xml::events::Event;

use super::error::{ParseError, ParseResult};
use crate::rfc::dav::core::{Namespace, PropertyName, PropfindRequest, PropfindType, QName};

/// Parses a PROPFIND request body.
///
/// ## Summary
/// Parses the XML body of a PROPFIND request and returns the
/// parsed request structure.
///
/// ## Errors
/// Returns an error if the XML is malformed or contains
/// unsupported elements.
#[tracing::instrument(skip(xml), fields(xml_len = xml.len()))]
#[expect(clippy::too_many_lines)]
pub fn parse_propfind(xml: &[u8]) -> ParseResult<PropfindRequest> {
    if xml.is_empty() {
        tracing::debug!("Empty PROPFIND body, returning allprop");
        // Empty body means allprop
        return Ok(PropfindRequest::allprop());
    }

    tracing::debug!("Parsing PROPFIND XML request");

    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);

    let mut buf = Vec::new();
    let mut namespaces: Vec<(String, String)> = Vec::new();
    let mut in_propfind = false;
    let mut propfind_type: Option<PropfindType> = None;
    let mut properties: Vec<PropertyName> = Vec::new();
    let mut include: Vec<PropertyName> = Vec::new();
    let mut in_prop = false;
    let mut in_include = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e) | Event::Empty(ref e)) => {
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
                    "propfind" => {
                        in_propfind = true;
                    }
                    "allprop" if in_propfind => {
                        propfind_type = Some(PropfindType::AllProp {
                            include: Vec::new(),
                        });
                    }
                    "propname" if in_propfind => {
                        propfind_type = Some(PropfindType::PropName);
                    }
                    "prop" if in_propfind => {
                        in_prop = true;
                        if propfind_type.is_none() {
                            propfind_type = Some(PropfindType::Prop(Vec::new()));
                        }
                    }
                    "include" if in_propfind => {
                        in_include = true;
                    }
                    _ if in_prop || in_include => {
                        // This is a property element
                        let qname = resolve_qname(e, &namespaces)?;
                        if in_prop {
                            properties.push(PropertyName::new(qname));
                        } else {
                            include.push(PropertyName::new(qname));
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::End(ref e)) => {
                let local_name_bytes = e.local_name();
                let local_name = std::str::from_utf8(local_name_bytes.as_ref())?;

                match local_name {
                    "propfind" => {
                        in_propfind = false;
                    }
                    "prop" => {
                        in_prop = false;
                    }
                    "include" => {
                        in_include = false;
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

    // Build the result
    let request = match propfind_type {
        Some(PropfindType::AllProp { .. }) => PropfindRequest::allprop_with_include(include),
        Some(PropfindType::PropName) => PropfindRequest::propname(),
        Some(PropfindType::Prop(_)) => PropfindRequest::prop(properties),
        None => PropfindRequest::allprop(),
    };

    Ok(request)
}

/// Resolves a `QName` from an element, using namespace declarations.
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

    // Look up namespace
    let namespace = namespaces
        .iter()
        .rev()
        .find(|(p, _)| *p == prefix)
        .map_or("DAV:", |(_, ns)| ns.as_str()); // Default to DAV: namespace

    Ok(QName::new(
        Namespace::new(namespace.to_string()),
        local_name,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_empty_body() {
        let req = parse_propfind(b"").unwrap();
        assert!(req.is_allprop());
    }

    #[test]
    fn parse_allprop() {
        let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:allprop/>
</D:propfind>"#;

        let req = parse_propfind(xml).unwrap();
        assert!(req.is_allprop());
    }

    #[test]
    fn parse_propname() {
        let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:propname/>
</D:propfind>"#;

        let req = parse_propfind(xml).unwrap();
        assert!(req.is_propname());
    }

    #[test]
    fn parse_prop() {
        let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:displayname/>
    <D:resourcetype/>
    <C:calendar-description/>
  </D:prop>
</D:propfind>"#;

        let req = parse_propfind(xml).unwrap();
        let props = req.requested_properties().unwrap();
        assert_eq!(props.len(), 3);
        assert_eq!(props[0].local_name(), "displayname");
        assert_eq!(props[1].local_name(), "resourcetype");
        assert_eq!(props[2].local_name(), "calendar-description");
    }

    #[test]
    fn parse_allprop_with_include() {
        let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:allprop/>
  <D:include>
    <C:calendar-data/>
  </D:include>
</D:propfind>"#;

        let req = parse_propfind(xml).unwrap();
        assert!(req.is_allprop());

        if let PropfindType::AllProp { include } = &req.propfind_type {
            assert_eq!(include.len(), 1);
            assert_eq!(include[0].local_name(), "calendar-data");
        } else {
            panic!("expected allprop");
        }
    }
}
