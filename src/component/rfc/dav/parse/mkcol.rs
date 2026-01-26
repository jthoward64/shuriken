//! MKCALENDAR and Extended MKCOL request XML parsing.

use quick_xml::events::Event;
use quick_xml::Reader;

use super::error::{ParseError, ParseResult};

/// Parsed result from MKCALENDAR or Extended MKCOL request body.
#[derive(Debug, Clone, Default)]
pub struct MkcolRequest {
    /// Display name property (DAV:displayname).
    pub displayname: Option<String>,
    /// Description property (CALDAV:calendar-description or CARDDAV:addressbook-description).
    pub description: Option<String>,
    /// Resource type (for Extended MKCOL).
    pub resource_type: Option<String>,
}

/// ## Summary
/// Parses a MKCALENDAR or Extended MKCOL request body.
///
/// Extracts displayname and description properties from the request body.
/// This is a simplified parser that handles the most common use case of
/// setting initial properties during collection creation.
///
/// ## Errors
/// Returns an error if the XML is malformed.
pub fn parse_mkcol(xml: &[u8]) -> ParseResult<MkcolRequest> {
    if xml.is_empty() {
        // Empty body is valid - no initial properties
        return Ok(MkcolRequest::default());
    }

    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);

    let mut buf = Vec::new();
    let mut request = MkcolRequest::default();

    let mut in_prop = false;
    let mut in_resourcetype = false;
    let mut current_property: Option<String> = None;
    let mut text_content = String::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let local_name_bytes = e.local_name();
                let local_name = std::str::from_utf8(local_name_bytes.as_ref())?;

                match local_name {
                    "prop" => {
                        in_prop = true;
                    }
                    "resourcetype" if in_prop => {
                        in_resourcetype = true;
                    }
                    "displayname" if in_prop => {
                        current_property = Some("displayname".to_string());
                        text_content.clear();
                    }
                    "calendar-description" if in_prop => {
                        current_property = Some("calendar-description".to_string());
                        text_content.clear();
                    }
                    "addressbook-description" if in_prop => {
                        current_property = Some("addressbook-description".to_string());
                        text_content.clear();
                    }
                    "calendar" if in_resourcetype => {
                        request.resource_type = Some("calendar".to_string());
                    }
                    "addressbook" if in_resourcetype => {
                        request.resource_type = Some("addressbook".to_string());
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(ref e)) => {
                let local_name_bytes = e.local_name();
                let local_name = std::str::from_utf8(local_name_bytes.as_ref())?;

                match local_name {
                    "calendar" if in_resourcetype => {
                        request.resource_type = Some("calendar".to_string());
                    }
                    "addressbook" if in_resourcetype => {
                        request.resource_type = Some("addressbook".to_string());
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(ref e)) => {
                if current_property.is_some() {
                    let text_bytes = e.as_ref();
                    let text = std::str::from_utf8(text_bytes)?;
                    text_content.push_str(text);
                }
            }
            Ok(Event::End(ref e)) => {
                let local_name_bytes = e.local_name();
                let local_name = std::str::from_utf8(local_name_bytes.as_ref())?;

                match local_name {
                    "prop" => {
                        in_prop = false;
                    }
                    "resourcetype" => {
                        in_resourcetype = false;
                    }
                    "displayname" if current_property.as_deref() == Some("displayname") => {
                        request.displayname = Some(text_content.trim().to_string());
                        current_property = None;
                        text_content.clear();
                    }
                    "calendar-description"
                        if current_property.as_deref() == Some("calendar-description") =>
                    {
                        request.description = Some(text_content.trim().to_string());
                        current_property = None;
                        text_content.clear();
                    }
                    "addressbook-description"
                        if current_property.as_deref() == Some("addressbook-description") =>
                    {
                        request.description = Some(text_content.trim().to_string());
                        current_property = None;
                        text_content.clear();
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_empty_body() {
        let result = parse_mkcol(b"").expect("Should parse empty body");
        assert!(result.displayname.is_none());
        assert!(result.description.is_none());
    }

    #[test]
    fn test_parse_mkcalendar_with_properties() {
        let xml = r#"<?xml version="1.0" encoding="utf-8" ?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set>
    <D:prop>
      <D:displayname>My Calendar</D:displayname>
      <C:calendar-description>Personal calendar</C:calendar-description>
    </D:prop>
  </D:set>
</C:mkcalendar>"#;

        let result = parse_mkcol(xml.as_bytes()).expect("Should parse MKCALENDAR");
        assert_eq!(result.displayname, Some("My Calendar".to_string()));
        assert_eq!(result.description, Some("Personal calendar".to_string()));
    }

    #[test]
    fn test_parse_extended_mkcol_addressbook() {
        let xml = r#"<?xml version="1.0" encoding="utf-8" ?>
<D:mkcol xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:set>
    <D:prop>
      <D:resourcetype>
        <D:collection/>
        <C:addressbook/>
      </D:resourcetype>
      <D:displayname>My Contacts</D:displayname>
      <C:addressbook-description>Personal contacts</C:addressbook-description>
    </D:prop>
  </D:set>
</D:mkcol>"#;

        let result = parse_mkcol(xml.as_bytes()).expect("Should parse Extended MKCOL");
        assert_eq!(result.displayname, Some("My Contacts".to_string()));
        assert_eq!(result.description, Some("Personal contacts".to_string()));
        assert_eq!(result.resource_type, Some("addressbook".to_string()));
    }

    #[test]
    fn test_parse_mkcalendar_displayname_only() {
        let xml = r#"<?xml version="1.0" encoding="utf-8" ?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set>
    <D:prop>
      <D:displayname>Work Calendar</D:displayname>
    </D:prop>
  </D:set>
</C:mkcalendar>"#;

        let result = parse_mkcol(xml.as_bytes()).expect("Should parse MKCALENDAR");
        assert_eq!(result.displayname, Some("Work Calendar".to_string()));
        assert!(result.description.is_none());
    }
}
