//! `WebDAV` sync-collection REPORT handler.

use salvo::http::StatusCode;
use salvo::{Request, Response, handler};

use crate::component::db::connection;
use crate::component::rfc::dav::build::multistatus::serialize_multistatus;
use crate::component::rfc::dav::core::{ExpandProperty, Multistatus, ReportType, SyncCollection};

/// ## Summary
/// Main REPORT method dispatcher for `WebDAV`.
///
/// Parses the REPORT request body and dispatches to the appropriate handler
/// based on the report type (`sync-collection`, `expand-property`, etc.).
///
/// ## Side Effects
/// - Parses XML request body
/// - Dispatches to specific report handlers
///
/// ## Errors
/// Returns 400 for invalid requests, 501 for unsupported reports.
#[handler]
pub async fn report(req: &mut Request, res: &mut Response) {
    // Read request body
    let body = match req.payload().await {
        Ok(body) => body,
        Err(e) => {
            tracing::error!("Failed to read request body: {}", e);
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };

    // Parse REPORT request
    let req_data = match crate::component::rfc::dav::parse::report::parse_report(body) {
        Ok(parsed_report) => parsed_report,
        Err(e) => {
            tracing::error!("Failed to parse REPORT request: {}", e);
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };

    // Dispatch based on report type
    match req_data.report_type {
        ReportType::SyncCollection(sync) => {
            handle_sync_collection(req, res, sync, req_data.properties).await;
        }
        ReportType::ExpandProperty(expand) => {
            handle_expand_property(req, res, expand, req_data.properties).await;
        }
        _ => {
            tracing::warn!("Unsupported REPORT type for WebDAV endpoint");
            res.status_code(StatusCode::NOT_IMPLEMENTED);
        }
    }
}

/// ## Summary
/// Handles `sync-collection` REPORT requests (RFC 6578).
///
/// Returns changes since the last sync token, enabling efficient
/// incremental synchronization.
///
/// ## Side Effects
/// - Queries the database for changed/deleted resources since sync token
/// - Returns 207 Multi-Status XML response with new sync token
///
/// ## Errors
/// Returns 400 for invalid sync tokens, 404 for missing collections, 500 for server errors.
pub async fn handle_sync_collection(
    _req: &mut Request,
    res: &mut Response,
    sync: SyncCollection,
    properties: Vec<crate::component::rfc::dav::core::PropertyName>,
) {
    let mut conn = match connection::connect().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::error!("Failed to get database connection: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    // Build response
    let multistatus = match build_sync_collection_response(&mut conn, &sync, &properties).await {
        Ok(ms) => ms,
        Err(e) => {
            tracing::error!("Failed to build sync-collection response: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    write_multistatus_response(res, &multistatus);
}

/// ## Summary
/// Builds a multistatus response for sync-collection.
///
/// Queries for changes since the provided sync token and constructs response.
///
/// ## Errors
/// Returns database errors or invalid sync token errors.
#[expect(clippy::unused_async)]
async fn build_sync_collection_response(
    _conn: &mut connection::DbConnection<'_>,
    _sync: &SyncCollection,
    _properties: &[crate::component::rfc::dav::core::PropertyName],
) -> anyhow::Result<Multistatus> {
    // TODO: Implement sync logic
    // 1. Parse collection path from request
    // 2. Parse sync token (or use 0 for initial sync)
    // 3. Query instances with sync_revision > token
    // 4. Query tombstones with sync_revision > token
    // 5. Build response with:
    //    - Changed resources (with requested properties)
    //    - Deleted resources (404 status)
    // 6. Set new sync token in response (collection.synctoken)
    // 7. Apply limit if specified (return 507 if truncated)

    Ok(Multistatus::new())
}

/// ## Summary
/// Handles `expand-property` REPORT requests (RFC 3253 §3.8).
///
/// Expands properties on resources, commonly used for principal discovery.
///
/// ## Side Effects
/// - Queries the database for resources and their properties
/// - Returns 207 Multi-Status XML response with expanded properties
///
/// ## Errors
/// Returns 400 for invalid requests, 500 for server errors.
pub async fn handle_expand_property(
    req: &mut Request,
    res: &mut Response,
    expand: ExpandProperty,
    properties: Vec<crate::component::rfc::dav::core::PropertyName>,
) {
    let mut conn = match connection::connect().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::error!("Failed to get database connection: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    // Build response
    let multistatus = match build_expand_property_response(&mut conn, req, &expand, &properties).await {
        Ok(ms) => ms,
        Err(e) => {
            tracing::error!("Failed to build expand-property response: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    write_multistatus_response(res, &multistatus);
}

/// ## Summary
/// Builds a multistatus response for expand-property.
///
/// Expands requested properties on resources by following hrefs and
/// recursively fetching nested properties. Implements cycle detection
/// to prevent infinite loops.
///
/// ## Errors
/// Returns database errors if queries fail.
#[expect(clippy::unused_async)]
async fn build_expand_property_response(
    conn: &mut connection::DbConnection<'_>,
    req: &Request,
    expand: &ExpandProperty,
    _properties: &[crate::component::rfc::dav::core::PropertyName],
) -> anyhow::Result<Multistatus> {
    use std::collections::HashSet;
    use crate::component::rfc::dav::core::{DavProperty, Href, PropstatResponse, PropertyValue};

    tracing::info!("Processing expand-property request");

    // Track visited resources for cycle detection
    let mut visited = HashSet::new();
    
    // Get the target resource path from the request
    let target_path = req.uri().path();
    let target_href = Href::new(target_path);
    
    // Mark the target as visited
    visited.insert(target_path.to_string());

    // Start building the multistatus response
    let mut multistatus = Multistatus::new();
    
    // Process each property to expand
    let mut expanded_properties = Vec::new();
    
    for prop_item in &expand.properties {
        let prop_name = &prop_item.name;
        
        // Fetch the property value for the target resource
        if let Some(property) = fetch_property(conn, target_path, prop_name).await? {
            // Check if this property contains an href that should be expanded
            if let Some(value) = &property.value {
                match value {
                    PropertyValue::Href(href) => {
                        // Recursively expand the href if it hasn't been visited
                        if !visited.contains(href) {
                            visited.insert(href.clone());
                            
                            // Fetch nested properties for this href
                            let nested_props = fetch_nested_properties(
                                conn,
                                href,
                                &prop_item.properties,
                                &mut visited,
                            ).await?;
                            
                            // If we have nested properties, wrap them in the original property
                            if !nested_props.is_empty() {
                                // Create a property with nested response
                                expanded_properties.push(DavProperty {
                                    name: prop_name.qname(),
                                    value: Some(PropertyValue::Xml(
                                        format_nested_response(href, &nested_props)
                                    )),
                                });
                            } else {
                                expanded_properties.push(property);
                            }
                        } else {
                            tracing::warn!("Cycle detected for href: {}, skipping", href);
                            expanded_properties.push(property);
                        }
                    }
                    PropertyValue::HrefSet(hrefs) => {
                        // Handle multiple hrefs
                        let mut expanded_hrefs = Vec::new();
                        
                        for href in hrefs {
                            if !visited.contains(href) {
                                visited.insert(href.clone());
                                
                                let nested_props = fetch_nested_properties(
                                    conn,
                                    href,
                                    &prop_item.properties,
                                    &mut visited,
                                ).await?;
                                
                                if !nested_props.is_empty() {
                                    expanded_hrefs.push(format_nested_response(href, &nested_props));
                                }
                            }
                        }
                        
                        if !expanded_hrefs.is_empty() {
                            expanded_properties.push(DavProperty {
                                name: prop_name.qname(),
                                value: Some(PropertyValue::Xml(expanded_hrefs.join("\n"))),
                            });
                        } else {
                            expanded_properties.push(property);
                        }
                    }
                    _ => {
                        // Non-href property, return as-is
                        expanded_properties.push(property);
                    }
                }
            } else {
                // Property with no value
                expanded_properties.push(property);
            }
        } else {
            // Property not found
            expanded_properties.push(DavProperty::not_found(prop_name.qname()));
        }
    }
    
    // Add the response for the target resource
    let response = PropstatResponse::ok(target_href, expanded_properties);
    multistatus.add_response(response);
    
    tracing::info!("Expand-property response built successfully");
    
    Ok(multistatus)
}

/// ## Summary
/// Fetches a single property for a resource at the given path.
///
/// ## Errors
/// Returns database errors if queries fail.
#[expect(clippy::unused_async)]
async fn fetch_property(
    _conn: &mut connection::DbConnection<'_>,
    path: &str,
    prop_name: &crate::component::rfc::dav::core::PropertyName,
) -> anyhow::Result<Option<crate::component::rfc::dav::core::DavProperty>> {
    use crate::component::rfc::dav::core::{DavProperty, PropertyValue, QName};
    
    let qname = prop_name.qname();
    
    // Stub implementation: Return common properties based on path patterns
    // In a full implementation, this would query the database
    let property = match (qname.namespace_uri(), qname.local_name()) {
        ("DAV:", "current-user-principal") => {
            Some(DavProperty::href(qname, "/principals/user/"))
        }
        ("DAV:", "principal-URL") => {
            Some(DavProperty::href(qname, "/principals/user/"))
        }
        ("DAV:", "displayname") => {
            // Extract display name based on path
            let name = path.split('/').last().unwrap_or("Resource");
            Some(DavProperty::text(qname, name))
        }
        ("DAV:", "resourcetype") => {
            // Determine resource type based on path
            if path.contains("/principals/") {
                Some(DavProperty {
                    name: qname,
                    value: Some(PropertyValue::ResourceType(vec![
                        QName::dav("collection"),
                        QName::dav("principal"),
                    ])),
                })
            } else if path.contains("/calendars/") {
                Some(DavProperty {
                    name: qname,
                    value: Some(PropertyValue::ResourceType(vec![
                        QName::dav("collection"),
                        QName::caldav("calendar"),
                    ])),
                })
            } else if path.contains("/addressbooks/") {
                Some(DavProperty {
                    name: qname,
                    value: Some(PropertyValue::ResourceType(vec![
                        QName::dav("collection"),
                        QName::carddav("addressbook"),
                    ])),
                })
            } else {
                Some(DavProperty {
                    name: qname,
                    value: Some(PropertyValue::ResourceType(Vec::new())),
                })
            }
        }
        ("urn:ietf:params:xml:ns:caldav", "calendar-home-set") => {
            Some(DavProperty::href(qname, "/calendars/user/"))
        }
        ("urn:ietf:params:xml:ns:carddav", "addressbook-home-set") => {
            Some(DavProperty::href(qname, "/addressbooks/user/"))
        }
        _ => {
            // Unknown property
            tracing::debug!("Unknown property requested: {}:{}", qname.namespace_uri(), qname.local_name());
            None
        }
    };
    
    Ok(property)
}

/// ## Summary
/// Fetches nested properties for a resource at the given href.
///
/// Recursively expands properties with cycle detection.
///
/// ## Errors
/// Returns database errors if queries fail.
fn fetch_nested_properties<'a>(
    conn: &'a mut connection::DbConnection<'_>,
    href: &'a str,
    nested_props: &'a [crate::component::rfc::dav::core::ExpandPropertyItem],
    visited: &'a mut std::collections::HashSet<String>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = anyhow::Result<Vec<crate::component::rfc::dav::core::DavProperty>>> + Send + 'a>> {
    Box::pin(async move {
        use crate::component::rfc::dav::core::{DavProperty, PropertyValue};
        
        let mut properties = Vec::new();
        
        // Recursion depth limit
        const MAX_DEPTH: usize = 10;
        if visited.len() > MAX_DEPTH {
            tracing::warn!("Maximum expansion depth reached, stopping recursion");
            return Ok(properties);
        }
        
        for prop_item in nested_props {
            if let Some(property) = fetch_property(conn, href, &prop_item.name).await? {
                // Check if this property should be recursively expanded
                if !prop_item.properties.is_empty() {
                    if let Some(value) = &property.value {
                        match value {
                            PropertyValue::Href(nested_href) => {
                                if !visited.contains(nested_href) {
                                    visited.insert(nested_href.clone());
                                    
                                    let deeper_props = fetch_nested_properties(
                                        conn,
                                        nested_href,
                                        &prop_item.properties,
                                        visited,
                                    ).await?;
                                    
                                    if !deeper_props.is_empty() {
                                        properties.push(DavProperty {
                                            name: prop_item.name.qname(),
                                            value: Some(PropertyValue::Xml(
                                                format_nested_response(nested_href, &deeper_props)
                                            )),
                                        });
                                    } else {
                                        properties.push(property);
                                    }
                                } else {
                                    properties.push(property);
                                }
                            }
                            _ => {
                                properties.push(property);
                            }
                        }
                    } else {
                        properties.push(property);
                    }
                } else {
                    properties.push(property);
                }
            }
        }
        
        Ok(properties)
    })
}

/// ## Summary
/// Formats a nested response with href and properties as XML.
fn format_nested_response(
    href: &str,
    properties: &[crate::component::rfc::dav::core::DavProperty],
) -> String {
    use crate::component::rfc::dav::core::PropertyValue;
    
    let mut xml = format!("<D:response><D:href>{}</D:href><D:propstat><D:prop>", href);
    
    for prop in properties {
        let ns = prop.name.namespace_uri();
        let name = prop.name.local_name();
        
        // Use appropriate prefix based on namespace
        let prefix = if ns == "DAV:" {
            "D"
        } else if ns == "urn:ietf:params:xml:ns:caldav" {
            "C"
        } else if ns == "urn:ietf:params:xml:ns:carddav" {
            "CARD"
        } else {
            "D"
        };
        
        if let Some(value) = &prop.value {
            match value {
                PropertyValue::Text(text) => {
                    xml.push_str(&format!("<{}:{}>{}</{}:{}>", prefix, name, text, prefix, name));
                }
                PropertyValue::Href(href) => {
                    xml.push_str(&format!("<{}:{}><D:href>{}</D:href></{}:{}>", prefix, name, href, prefix, name));
                }
                PropertyValue::Empty => {
                    xml.push_str(&format!("<{}:{}/>", prefix, name));
                }
                PropertyValue::Xml(content) => {
                    xml.push_str(&format!("<{}:{}>{}</{}:{}>", prefix, name, content, prefix, name));
                }
                _ => {
                    // For complex types, just use empty element for now
                    xml.push_str(&format!("<{}:{}/>", prefix, name));
                }
            }
        } else {
            xml.push_str(&format!("<{}:{}/>", prefix, name));
        }
    }
    
    xml.push_str("</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>");
    
    xml
}

/// ## Summary
/// Writes a multistatus response to the HTTP response.
///
/// Serializes to XML and sets appropriate headers.
fn write_multistatus_response(res: &mut Response, multistatus: &Multistatus) {
    let xml = match serialize_multistatus(multistatus) {
        Ok(xml) => xml,
        Err(e) => {
            tracing::error!("Failed to serialize multistatus: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    res.status_code(StatusCode::MULTI_STATUS);
    #[expect(
        clippy::let_underscore_must_use,
        reason = "Header addition failure is non-fatal"
    )]
    let _ = res.add_header(
        "Content-Type",
        salvo::http::HeaderValue::from_static("application/xml; charset=utf-8"),
        true,
    );
    #[expect(
        clippy::let_underscore_must_use,
        reason = "Write body failure is non-fatal"
    )]
    let _ = res.write_body(xml);
}
