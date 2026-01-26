//! REPORT request XML parsing.

use quick_xml::Reader;
use quick_xml::events::Event;

use super::error::{ParseError, ParseResult};
use crate::component::rfc::dav::core::{
    AddressbookFilter, AddressbookQuery, CalendarFilter, CalendarQuery, CompFilter, FilterTest,
    Href, MatchType, Namespace, ParamFilter, PropFilter, PropertyName, QName, RecurrenceExpansion, ReportRequest,
    ReportType, SyncCollection, SyncLevel, TextMatch, TimeRange,
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
                    "expand-property" => parse_expand_property(xml),
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
#[expect(clippy::too_many_lines)]
fn parse_calendar_query(xml: &[u8]) -> ParseResult<ReportRequest> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);

    let mut buf = Vec::new();
    let mut namespaces: Vec<(String, String)> = Vec::new();
    let mut properties: Vec<PropertyName> = Vec::new();
    let mut filter: Option<CalendarFilter> = None;
    let mut expand: Option<(TimeRange, RecurrenceExpansion)> = None;
    let limit: Option<u32> = None;
    let mut in_prop = false;
    let mut in_filter = false;
    let mut depth: usize = 0;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                collect_namespaces(e, &mut namespaces)?;
                let local_name_bytes = e.local_name();
                let local_name = std::str::from_utf8(local_name_bytes.as_ref())?.to_owned();

                match local_name.as_str() {
                    "prop" if !in_filter => {
                        in_prop = true;
                    }
                    "filter" => {
                        in_filter = true;
                        depth = 1;
                    }
                    "comp-filter" if in_filter && depth == 1 => {
                        // Parse the root comp-filter (VCALENDAR)
                        let name = get_attribute(e, "name")?;
                        if name == "VCALENDAR" {
                            filter = Some(parse_calendar_filter_content(
                                &mut reader,
                                &mut buf,
                                &namespaces,
                            )?);
                        }
                    }
                    "calendar-data" if in_prop => {
                        // Parse calendar-data element for partial retrieval
                        let qname = resolve_qname(e, &namespaces)?;
                        properties.push(PropertyName::new(qname));
                    }
                    _ if in_prop && !in_filter => {
                        let qname = resolve_qname(e, &namespaces)?;
                        properties.push(PropertyName::new(qname));
                    }
                    _ if in_filter => {
                        depth += 1;
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(ref e)) => {
                collect_namespaces(e, &mut namespaces)?;
                let local_name_bytes = e.local_name();
                let local_name = std::str::from_utf8(local_name_bytes.as_ref())?.to_owned();

                match local_name.as_str() {
                    "expand" if !in_filter => {
                        // Parse <C:expand start="..." end="..."/>
                        let time_range = parse_time_range(e)?;
                        expand = Some((time_range, RecurrenceExpansion::Expand));
                    }
                    "limit-recurrence-set" if !in_filter => {
                        // Parse <C:limit-recurrence-set start="..." end="..."/>
                        if expand.is_none() {
                            let time_range = parse_time_range(e)?;
                            expand = Some((time_range, RecurrenceExpansion::LimitRecurrenceSet));
                        }
                    }
                    "calendar-data" if in_prop => {
                        let qname = resolve_qname(e, &namespaces)?;
                        properties.push(PropertyName::new(qname));
                    }
                    _ if in_prop && !in_filter => {
                        let qname = resolve_qname(e, &namespaces)?;
                        properties.push(PropertyName::new(qname));
                    }
                    _ => {}
                }
            }
            Ok(Event::End(ref e)) => {
                let local_name_bytes = e.local_name();
                let local_name = std::str::from_utf8(local_name_bytes.as_ref())?;
                match local_name {
                    "prop" if !in_filter => {
                        in_prop = false;
                    }
                    "filter" => {
                        in_filter = false;
                        depth = 0;
                    }
                    _ if in_filter => {
                        depth = depth.saturating_sub(1);
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

    let query = CalendarQuery {
        filter,
        expand,
        limit,
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
/// Parses an addressbook-query report.
#[expect(clippy::too_many_lines)]
fn parse_addressbook_query(xml: &[u8]) -> ParseResult<ReportRequest> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);

    let mut buf = Vec::new();
    let mut namespaces: Vec<(String, String)> = Vec::new();
    let mut properties: Vec<PropertyName> = Vec::new();
    let mut filter: Option<AddressbookFilter> = None;
    let limit: Option<u32> = None;
    let mut in_prop = false;
    let mut in_filter = false;
    let mut depth: usize = 0;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                collect_namespaces(e, &mut namespaces)?;
                let local_name_bytes = e.local_name();
                let local_name = std::str::from_utf8(local_name_bytes.as_ref())?.to_owned();

                match local_name.as_str() {
                    "prop" if !in_filter => {
                        in_prop = true;
                    }
                    "filter" => {
                        in_filter = true;
                        depth = 1;
                        // Parse filter test attribute
                        let test = get_attribute(e, "test").unwrap_or_else(|_| "anyof".to_string());
                        let filter_test = if test == "allof" {
                            FilterTest::AllOf
                        } else {
                            FilterTest::AnyOf
                        };
                        filter = Some(parse_addressbook_filter_content(
                            &mut reader,
                            &mut buf,
                            &namespaces,
                            filter_test,
                        )?);
                    }
                    "address-data" if in_prop => {
                        let qname = resolve_qname(e, &namespaces)?;
                        properties.push(PropertyName::new(qname));
                    }
                    _ if in_prop && !in_filter => {
                        let qname = resolve_qname(e, &namespaces)?;
                        properties.push(PropertyName::new(qname));
                    }
                    _ if in_filter => {
                        depth += 1;
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(ref e)) => {
                collect_namespaces(e, &mut namespaces)?;
                let local_name_bytes = e.local_name();
                let local_name = std::str::from_utf8(local_name_bytes.as_ref())?.to_owned();

                match local_name.as_str() {
                    "address-data" if in_prop => {
                        let qname = resolve_qname(e, &namespaces)?;
                        properties.push(PropertyName::new(qname));
                    }
                    _ if in_prop && !in_filter => {
                        let qname = resolve_qname(e, &namespaces)?;
                        properties.push(PropertyName::new(qname));
                    }
                    _ => {}
                }
            }
            Ok(Event::End(ref e)) => {
                let local_name_bytes = e.local_name();
                let local_name = std::str::from_utf8(local_name_bytes.as_ref())?;
                match local_name {
                    "prop" if !in_filter => {
                        in_prop = false;
                    }
                    "filter" => {
                        in_filter = false;
                        depth = 0;
                    }
                    _ if in_filter => {
                        depth = depth.saturating_sub(1);
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

    let query = AddressbookQuery { filter, limit };
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

/// Gets an attribute value from an element.
fn get_attribute(e: &quick_xml::events::BytesStart<'_>, name: &str) -> ParseResult<String> {
    for attr in e.attributes().flatten() {
        let key = std::str::from_utf8(attr.key.as_ref())?;
        if key == name {
            return Ok(std::str::from_utf8(&attr.value)?.to_owned());
        }
    }
    Err(ParseError::missing_attribute(name))
}

/// Parses calendar filter content (nested comp-filters).
fn parse_calendar_filter_content(
    reader: &mut Reader<&[u8]>,
    buf: &mut Vec<u8>,
    namespaces: &[(String, String)],
) -> ParseResult<CalendarFilter> {
    let mut filter = CalendarFilter::vcalendar();
    let mut depth = 1;

    loop {
        buf.clear();
        match reader.read_event_into(buf) {
            Ok(Event::Start(e)) => {
                let local_name = std::str::from_utf8(e.local_name().as_ref())?.to_owned();
                depth += 1;

                if local_name == "comp-filter" && depth == 2 {
                    // Extract name attribute before consuming the element
                    let name = get_attribute(&e, "name")?.clone();
                    let comp_filter = parse_comp_filter_with_name(reader, buf, namespaces, name)?;
                    filter.filters.push(comp_filter);
                }
            }
            Ok(Event::Empty(e)) => {
                let local_name = std::str::from_utf8(e.local_name().as_ref())?.to_owned();
                if local_name == "comp-filter" && depth == 1 {
                    let name = get_attribute(&e, "name")?;
                    filter.filters.push(CompFilter::new(name));
                }
            }
            Ok(Event::End(e)) => {
                let local_name = std::str::from_utf8(e.local_name().as_ref())?.to_owned();
                depth -= 1;
                if local_name == "comp-filter" && depth == 0 {
                    break;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(ParseError::xml(e.to_string())),
            _ => {}
        }
    }

    Ok(filter)
}

/// Parses a comp-filter element when name is already extracted.
#[expect(clippy::too_many_lines)]
fn parse_comp_filter_with_name(
    reader: &mut Reader<&[u8]>,
    buf: &mut Vec<u8>,
    namespaces: &[(String, String)],
    name: String,
) -> ParseResult<CompFilter> {
    let mut comp_filter = CompFilter::new(name);
    let mut depth = 1;

    loop {
        buf.clear();
        match reader.read_event_into(buf) {
            Ok(Event::Start(e)) => {
                let local_name = std::str::from_utf8(e.local_name().as_ref())?.to_owned();
                depth += 1;

                match local_name.as_str() {
                    "comp-filter" => {
                        let name = get_attribute(&e, "name")?.clone();
                        let nested = parse_comp_filter_with_name(reader, buf, namespaces, name)?;
                        comp_filter.comp_filters.push(nested);
                    }
                    "prop-filter" => {
                        let name = get_attribute(&e, "name")?.clone();
                        let prop_filter =
                            parse_prop_filter_with_name(reader, buf, namespaces, name)?;
                        comp_filter.prop_filters.push(prop_filter);
                    }
                    "time-range" => {
                        comp_filter.time_range = Some(parse_time_range(&e)?);
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(e)) => {
                let local_name = std::str::from_utf8(e.local_name().as_ref())?.to_owned();
                match local_name.as_str() {
                    "is-not-defined" => {
                        comp_filter.is_not_defined = true;
                    }
                    "time-range" => {
                        comp_filter.time_range = Some(parse_time_range(&e)?);
                    }
                    _ => {}
                }
            }
            Ok(Event::End(e)) => {
                let local_name = std::str::from_utf8(e.local_name().as_ref())?.to_owned();
                depth -= 1;
                if local_name == "comp-filter" && depth == 0 {
                    break;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(ParseError::xml(e.to_string())),
            _ => {}
        }
    }

    Ok(comp_filter)
}

/// Parses a prop-filter element when name is already extracted.
#[expect(clippy::too_many_lines)]
fn parse_prop_filter_with_name(
    reader: &mut Reader<&[u8]>,
    buf: &mut Vec<u8>,
    _namespaces: &[(String, String)],
    name: String,
) -> ParseResult<PropFilter> {
    let mut prop_filter = PropFilter::new(name);
    let mut depth = 1;

    loop {
        buf.clear();
        match reader.read_event_into(buf) {
            Ok(Event::Start(e)) => {
                let local_name = std::str::from_utf8(e.local_name().as_ref())?.to_owned();
                depth += 1;

                match local_name.as_str() {
                    "text-match" => {
                        // Extract attributes before recursing to avoid borrow conflicts
                        let mut collation = None;
                        let mut negate = false;
                        let mut match_type = MatchType::Contains;
                        for attr in e.attributes().flatten() {
                            let key = std::str::from_utf8(attr.key.as_ref())?;
                            let value = std::str::from_utf8(&attr.value)?;
                            match key {
                                "collation" => collation = Some(value.to_owned()),
                                "negate-condition" => negate = value == "yes" || value == "true",
                                "match-type" => {
                                    match_type = match value {
                                        "equals" => MatchType::Equals,
                                        "starts-with" => MatchType::StartsWith,
                                        "ends-with" => MatchType::EndsWith,
                                        // Default to contains per RFC 4791
                                        _ => MatchType::Contains,
                                    };
                                }
                                _ => {}
                            }
                        }
                        prop_filter.text_match = Some(parse_text_match_content(
                            reader, collation, negate, match_type,
                        )?);
                    }
                    "time-range" => {
                        prop_filter.time_range = Some(parse_time_range(&e)?);
                    }
                    "param-filter" => {
                        let name = get_attribute(&e, "name")?.clone();
                        let param_filter = parse_param_filter_with_name(reader, buf, name)?;
                        prop_filter.param_filters.push(param_filter);
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(e)) => {
                let local_name = std::str::from_utf8(e.local_name().as_ref())?.to_owned();
                match local_name.as_str() {
                    "is-not-defined" => {
                        prop_filter.is_not_defined = true;
                    }
                    "time-range" => {
                        prop_filter.time_range = Some(parse_time_range(&e)?);
                    }
                    _ => {}
                }
            }
            Ok(Event::End(e)) => {
                let local_name = std::str::from_utf8(e.local_name().as_ref())?.to_owned();
                depth -= 1;
                if local_name == "prop-filter" && depth == 0 {
                    break;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(ParseError::xml(e.to_string())),
            _ => {}
        }
    }

    Ok(prop_filter)
}

/// Parses a param-filter element when name is already extracted.
#[expect(clippy::too_many_lines)]
fn parse_param_filter_with_name(
    reader: &mut Reader<&[u8]>,
    buf: &mut Vec<u8>,
    name: String,
) -> ParseResult<ParamFilter> {
    let mut param_filter = ParamFilter {
        name,
        is_not_defined: false,
        text_match: None,
    };
    let mut depth = 1;

    loop {
        buf.clear();
        match reader.read_event_into(buf) {
            Ok(Event::Start(e)) => {
                let local_name = std::str::from_utf8(e.local_name().as_ref())?.to_owned();
                depth += 1;

                if local_name == "text-match" {
                    // Extract attributes before recursing to avoid borrow conflicts
                    let mut collation = None;
                    let mut negate = false;
                    let mut match_type = MatchType::Contains;
                    for attr in e.attributes().flatten() {
                        let key = std::str::from_utf8(attr.key.as_ref())?;
                        let value = std::str::from_utf8(&attr.value)?;
                        match key {
                            "collation" => collation = Some(value.to_owned()),
                            "negate-condition" => negate = value == "yes" || value == "true",
                            "match-type" => {
                                match_type = match value {
                                    "equals" => MatchType::Equals,
                                    "starts-with" => MatchType::StartsWith,
                                    "ends-with" => MatchType::EndsWith,
                                    // Default to contains per RFC 6352
                                    _ => MatchType::Contains,
                                };
                            }
                            _ => {}
                        }
                    }
                    param_filter.text_match = Some(parse_text_match_content(
                        reader, collation, negate, match_type,
                    )?);
                }
            }
            Ok(Event::Empty(e)) => {
                let local_name = std::str::from_utf8(e.local_name().as_ref())?.to_owned();
                if local_name == "is-not-defined" {
                    param_filter.is_not_defined = true;
                }
            }
            Ok(Event::End(e)) => {
                let local_name = std::str::from_utf8(e.local_name().as_ref())?.to_owned();
                depth -= 1;
                if local_name == "param-filter" && depth == 0 {
                    break;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(ParseError::xml(e.to_string())),
            _ => {}
        }
    }

    Ok(param_filter)
}

/// Parses text-match content (text between tags).
fn parse_text_match_content(
    reader: &mut Reader<&[u8]>,
    collation: Option<String>,
    negate: bool,
    match_type: MatchType,
) -> ParseResult<TextMatch> {
    // Parse text content - use our own buffer
    let mut text_content = String::new();
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match reader.read_event_into(&mut buf) {
            Ok(Event::Text(e)) => {
                let decoded = reader.decoder().decode(e.as_ref())?;
                text_content.push_str(&decoded);
            }
            Ok(Event::End(e)) => {
                let local_name = std::str::from_utf8(e.local_name().as_ref())?.to_owned();
                if local_name == "text-match" {
                    break;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(ParseError::xml(e.to_string())),
            _ => {}
        }
    }

    Ok(TextMatch {
        value: text_content.trim().to_owned(),
        collation,
        match_type,
        negate,
    })
}

/// Parses a time-range element.
fn parse_time_range(elem: &quick_xml::events::BytesStart<'_>) -> ParseResult<TimeRange> {
    let mut start = None;
    let mut end = None;

    for attr in elem.attributes().flatten() {
        let key = std::str::from_utf8(attr.key.as_ref())?;
        let value = std::str::from_utf8(&attr.value)?;

        match key {
            "start" => {
                start = chrono::DateTime::parse_from_rfc3339(value)
                    .ok()
                    .map(|dt| dt.with_timezone(&chrono::Utc));
            }
            "end" => {
                end = chrono::DateTime::parse_from_rfc3339(value)
                    .ok()
                    .map(|dt| dt.with_timezone(&chrono::Utc));
            }
            _ => {}
        }
    }

    Ok(TimeRange { start, end })
}

/// Parses addressbook filter content (nested prop-filters).
fn parse_addressbook_filter_content(
    reader: &mut Reader<&[u8]>,
    buf: &mut Vec<u8>,
    namespaces: &[(String, String)],
    test: FilterTest,
) -> ParseResult<AddressbookFilter> {
    let mut prop_filters = Vec::new();
    let mut depth = 1;

    loop {
        buf.clear();
        match reader.read_event_into(buf) {
            Ok(Event::Start(e)) => {
                let local_name = std::str::from_utf8(e.local_name().as_ref())?.to_owned();
                depth += 1;

                if local_name == "prop-filter" && depth == 2 {
                    let name = get_attribute(&e, "name")?.clone();
                    let prop_filter = parse_prop_filter_with_name(reader, buf, namespaces, name)?;
                    prop_filters.push(prop_filter);
                }
            }
            Ok(Event::Empty(e)) => {
                let local_name = std::str::from_utf8(e.local_name().as_ref())?.to_owned();
                if local_name == "prop-filter" && depth == 1 {
                    let name = get_attribute(&e, "name")?;
                    prop_filters.push(PropFilter::new(name));
                }
            }
            Ok(Event::End(e)) => {
                let local_name = std::str::from_utf8(e.local_name().as_ref())?.to_owned();
                depth -= 1;
                if local_name == "filter" && depth == 0 {
                    break;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(ParseError::xml(e.to_string())),
            _ => {}
        }
    }

    Ok(AddressbookFilter { prop_filters, test })
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

/// Parses an expand-property report.
///
/// ## Summary
/// Parses expand-property REPORT requests per RFC 3253.
///
/// ## Errors
/// Returns parse errors if XML is invalid.
fn parse_expand_property(xml: &[u8]) -> ParseResult<ReportRequest> {
    use crate::component::rfc::dav::core::{ExpandProperty, ExpandPropertyItem};

    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);

    let mut buf = Vec::new();
    let mut namespaces: Vec<(String, String)> = Vec::new();
    let mut properties: Vec<PropertyName> = Vec::new();
    let mut expand_items: Vec<ExpandPropertyItem> = Vec::new();

    loop {
        buf.clear();
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e) | Event::Empty(ref e)) => {
                collect_namespaces(e, &mut namespaces)?;
                let local_name_bytes = e.local_name();
                let local_name = std::str::from_utf8(local_name_bytes.as_ref())?.to_owned();

                if local_name == "property" {
                    // Parse property element with name attribute
                    let name_value = get_attribute(e, "name")?;
                    let qname = QName::dav(name_value);
                    let prop_name = PropertyName::new(qname);

                    // For now, we don't support nested expansion
                    // A full implementation would recursively parse nested <property> elements
                    expand_items.push(ExpandPropertyItem {
                        name: prop_name.clone(),
                        properties: Vec::new(),
                    });
                    properties.push(prop_name);
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(ParseError::xml(e.to_string())),
            _ => {}
        }
    }

    let expand_property = ExpandProperty {
        properties: expand_items,
    };

    Ok(ReportRequest {
        report_type: ReportType::ExpandProperty(expand_property),
        properties,
    })
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
