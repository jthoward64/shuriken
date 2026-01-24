//! REPORT request XML parsing.

use quick_xml::Reader;
use quick_xml::events::Event;

use super::error::{ParseError, ParseResult};
use crate::component::rfc::dav::core::{
    AddressbookQuery, CalendarFilter, CalendarQuery, Href, Namespace, PropertyName, QName,
    ReportRequest, SyncCollection, SyncLevel,
};

/// Parses a REPORT request body.
///
/// ## Summary
/// Parses the XML body of a REPORT request and returns the
/// parsed request structure.
///
/// ## Errors
/// Returns an error if the XML is malformed or contains
/// unsupported report types.
pub fn parse_report(xml: &[u8]) -> ParseResult<ReportRequest> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);

    let mut buf = Vec::new();
    let mut namespaces: Vec<(String, String)> = Vec::new();

    // First, determine the report type
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e) | Event::Empty(ref e)) => {
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

                let local_name_bytes = e.local_name();
                let local_name = std::str::from_utf8(local_name_bytes.as_ref())?.to_owned();

                // Dispatch based on report type
                return match local_name.as_str() {
                    "calendar-query" => parse_calendar_query(xml),
                    "calendar-multiget" => parse_calendar_multiget(xml),
                    "addressbook-query" => parse_addressbook_query(xml),
                    "addressbook-multiget" => parse_addressbook_multiget(xml),
                    "sync-collection" => parse_sync_collection(xml),
                    _ => Err(ParseError::unexpected_element(&local_name)),
                };
            }
            Ok(Event::Eof) => {
                return Err(ParseError::missing_element("report root element"));
            }
            Err(e) => return Err(ParseError::xml(e.to_string())),
            _ => {}
        }
        buf.clear();
    }
}

/// Parses a calendar-query report.
fn parse_calendar_query(xml: &[u8]) -> ParseResult<ReportRequest> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);

    let mut buf = Vec::new();
    let mut namespaces: Vec<(String, String)> = Vec::new();
    let mut properties: Vec<PropertyName> = Vec::new();
    let mut filter: Option<CalendarFilter> = None;
    let mut in_prop = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e) | Event::Empty(ref e)) => {
                collect_namespaces(e, &mut namespaces)?;
                let local_name_bytes = e.local_name();
                let local_name = std::str::from_utf8(local_name_bytes.as_ref())?.to_owned();

                match local_name.as_str() {
                    "prop" => {
                        in_prop = true;
                    }
                    "filter" => {
                        // Parse filter separately
                        filter = Some(CalendarFilter::vcalendar());
                    }
                    _ if in_prop => {
                        let qname = resolve_qname(e, &namespaces)?;
                        properties.push(PropertyName::new(qname));
                    }
                    _ => {}
                }
            }
            Ok(Event::End(ref e)) => {
                let local_name_bytes = e.local_name();
                let local_name = std::str::from_utf8(local_name_bytes.as_ref())?;
                if local_name == "prop" {
                    in_prop = false;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(ParseError::xml(e.to_string())),
            _ => {}
        }
        buf.clear();
    }

    let query = CalendarQuery {
        filter,
        expand: None,
        limit: None,
    };

    Ok(ReportRequest::calendar_query(query, properties))
}

/// Parses a calendar-multiget report.
#[expect(clippy::too_many_lines)]
fn parse_calendar_multiget(xml: &[u8]) -> ParseResult<ReportRequest> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);

    let mut buf = Vec::new();
    let mut text_buf = String::new();
    let mut namespaces: Vec<(String, String)> = Vec::new();
    let mut properties: Vec<PropertyName> = Vec::new();
    let mut hrefs: Vec<Href> = Vec::new();
    let mut in_prop = false;
    let mut in_href = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e) | Event::Empty(ref e)) => {
                collect_namespaces(e, &mut namespaces)?;
                let local_name_bytes = e.local_name();
                let local_name = std::str::from_utf8(local_name_bytes.as_ref())?.to_owned();

                match local_name.as_str() {
                    "prop" => {
                        in_prop = true;
                    }
                    "href" => {
                        in_href = true;
                        text_buf.clear();
                    }
                    _ if in_prop => {
                        let qname = resolve_qname(e, &namespaces)?;
                        properties.push(PropertyName::new(qname));
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(ref e)) => {
                if in_href {
                    let decoded = reader.decoder().decode(e.as_ref())?;
                    text_buf.push_str(&decoded);
                }
            }
            Ok(Event::End(ref e)) => {
                let local_name_bytes = e.local_name();
                let local_name = std::str::from_utf8(local_name_bytes.as_ref())?;
                match local_name {
                    "prop" => {
                        in_prop = false;
                    }
                    "href" => {
                        in_href = false;
                        if !text_buf.is_empty() {
                            hrefs.push(Href::new(text_buf.clone()));
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

    Ok(ReportRequest::calendar_multiget(hrefs, properties))
}

/// Parses an addressbook-query report.
fn parse_addressbook_query(xml: &[u8]) -> ParseResult<ReportRequest> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);

    let mut buf = Vec::new();
    let mut namespaces: Vec<(String, String)> = Vec::new();
    let mut properties: Vec<PropertyName> = Vec::new();
    let mut in_prop = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e) | Event::Empty(ref e)) => {
                collect_namespaces(e, &mut namespaces)?;
                let local_name_bytes = e.local_name();
                let local_name = std::str::from_utf8(local_name_bytes.as_ref())?.to_owned();

                match local_name.as_str() {
                    "prop" => {
                        in_prop = true;
                    }
                    _ if in_prop => {
                        let qname = resolve_qname(e, &namespaces)?;
                        properties.push(PropertyName::new(qname));
                    }
                    _ => {}
                }
            }
            Ok(Event::End(ref e)) => {
                let local_name_bytes = e.local_name();
                let local_name = std::str::from_utf8(local_name_bytes.as_ref())?;
                if local_name == "prop" {
                    in_prop = false;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(ParseError::xml(e.to_string())),
            _ => {}
        }
        buf.clear();
    }

    let query = AddressbookQuery::new();
    Ok(ReportRequest::addressbook_query(query, properties))
}

/// Parses an addressbook-multiget report.
#[expect(clippy::too_many_lines)]
fn parse_addressbook_multiget(xml: &[u8]) -> ParseResult<ReportRequest> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);

    let mut buf = Vec::new();
    let mut text_buf = String::new();
    let mut namespaces: Vec<(String, String)> = Vec::new();
    let mut properties: Vec<PropertyName> = Vec::new();
    let mut hrefs: Vec<Href> = Vec::new();
    let mut in_prop = false;
    let mut in_href = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e) | Event::Empty(ref e)) => {
                collect_namespaces(e, &mut namespaces)?;
                let local_name_bytes = e.local_name();
                let local_name = std::str::from_utf8(local_name_bytes.as_ref())?.to_owned();

                match local_name.as_str() {
                    "prop" => {
                        in_prop = true;
                    }
                    "href" => {
                        in_href = true;
                        text_buf.clear();
                    }
                    _ if in_prop => {
                        let qname = resolve_qname(e, &namespaces)?;
                        properties.push(PropertyName::new(qname));
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(ref e)) => {
                if in_href {
                    let decoded = reader.decoder().decode(e.as_ref())?;
                    text_buf.push_str(&decoded);
                }
            }
            Ok(Event::End(ref e)) => {
                let local_name_bytes = e.local_name();
                let local_name = std::str::from_utf8(local_name_bytes.as_ref())?;
                match local_name {
                    "prop" => {
                        in_prop = false;
                    }
                    "href" => {
                        in_href = false;
                        if !text_buf.is_empty() {
                            hrefs.push(Href::new(text_buf.clone()));
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

    Ok(ReportRequest::addressbook_multiget(hrefs, properties))
}

/// Parses a sync-collection report.
#[expect(clippy::too_many_lines)]
fn parse_sync_collection(xml: &[u8]) -> ParseResult<ReportRequest> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);

    let mut buf = Vec::new();
    let mut text_buf = String::new();
    let mut namespaces: Vec<(String, String)> = Vec::new();
    let mut properties: Vec<PropertyName> = Vec::new();
    let mut sync_token = String::new();
    let mut sync_level = SyncLevel::One;
    let mut in_prop = false;
    let mut in_sync_token = false;
    let mut in_sync_level = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e) | Event::Empty(ref e)) => {
                collect_namespaces(e, &mut namespaces)?;
                let local_name_bytes = e.local_name();
                let local_name = std::str::from_utf8(local_name_bytes.as_ref())?.to_owned();

                match local_name.as_str() {
                    "prop" => {
                        in_prop = true;
                    }
                    "sync-token" => {
                        in_sync_token = true;
                        text_buf.clear();
                    }
                    "sync-level" => {
                        in_sync_level = true;
                        text_buf.clear();
                    }
                    _ if in_prop => {
                        let qname = resolve_qname(e, &namespaces)?;
                        properties.push(PropertyName::new(qname));
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(ref e)) => {
                let decoded = reader.decoder().decode(e.as_ref())?;
                if in_sync_token || in_sync_level {
                    text_buf.push_str(&decoded);
                }
            }
            Ok(Event::End(ref e)) => {
                let local_name_bytes = e.local_name();
                let local_name = std::str::from_utf8(local_name_bytes.as_ref())?;
                match local_name {
                    "prop" => {
                        in_prop = false;
                    }
                    "sync-token" => {
                        in_sync_token = false;
                        sync_token = text_buf.trim().to_string();
                    }
                    "sync-level" => {
                        in_sync_level = false;
                        sync_level = match text_buf.trim() {
                            "infinity" => SyncLevel::Infinity,
                            _ => SyncLevel::One, // Default for "1" or any other value
                        };
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

    let sync = SyncCollection {
        sync_token,
        sync_level,
        limit: None,
    };

    Ok(ReportRequest::sync_collection(sync, properties))
}

/// Collects namespace declarations from an element.
fn collect_namespaces(
    e: &quick_xml::events::BytesStart<'_>,
    namespaces: &mut Vec<(String, String)>,
) -> ParseResult<()> {
    for attr in e.attributes().flatten() {
        let key = std::str::from_utf8(attr.key.as_ref())?;
        let value = std::str::from_utf8(&attr.value)?;
        if let Some(prefix) = key.strip_prefix("xmlns:") {
            namespaces.push((prefix.to_string(), value.to_string()));
        } else if key == "xmlns" {
            namespaces.push((String::new(), value.to_string()));
        } else {
            // Other attributes are ignored
        }
    }
    Ok(())
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
    use crate::component::rfc::dav::core::ReportType;

    #[test]
    fn parse_calendar_multiget_report() {
        let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<C:calendar-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <D:href>/calendars/user/cal/event1.ics</D:href>
  <D:href>/calendars/user/cal/event2.ics</D:href>
</C:calendar-multiget>"#;

        let req = parse_report(xml).unwrap();

        match req.report_type {
            ReportType::CalendarMultiget(mg) => {
                assert_eq!(mg.hrefs.len(), 2);
                assert_eq!(mg.hrefs[0].as_str(), "/calendars/user/cal/event1.ics");
            }
            _ => panic!("wrong report type"),
        }

        assert_eq!(req.properties.len(), 2);
    }

    #[test]
    fn parse_sync_collection_report() {
        let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<D:sync-collection xmlns:D="DAV:">
  <D:sync-token>http://example.com/sync/123</D:sync-token>
  <D:sync-level>1</D:sync-level>
  <D:prop>
    <D:getetag/>
  </D:prop>
</D:sync-collection>"#;

        let req = parse_report(xml).unwrap();

        match req.report_type {
            ReportType::SyncCollection(sync) => {
                assert_eq!(sync.sync_token, "http://example.com/sync/123");
                assert_eq!(sync.sync_level, SyncLevel::One);
            }
            _ => panic!("wrong report type"),
        }
    }

    #[test]
    fn parse_calendar_query_report() {
        let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT"/>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>"#;

        let req = parse_report(xml).unwrap();

        match req.report_type {
            ReportType::CalendarQuery(query) => {
                assert!(query.filter.is_some());
            }
            _ => panic!("wrong report type"),
        }
    }

    #[test]
    fn parse_addressbook_multiget_report() {
        let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<CR:addressbook-multiget xmlns:D="DAV:" xmlns:CR="urn:ietf:params:xml:ns:carddav">
  <D:prop>
    <D:getetag/>
    <CR:address-data/>
  </D:prop>
  <D:href>/addressbooks/user/contacts/contact1.vcf</D:href>
</CR:addressbook-multiget>"#;

        let req = parse_report(xml).unwrap();

        match req.report_type {
            ReportType::AddressbookMultiget(mg) => {
                assert_eq!(mg.hrefs.len(), 1);
            }
            _ => panic!("wrong report type"),
        }
    }
}
