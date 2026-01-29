//! `WebDAV` sync-collection REPORT handler.

use salvo::http::StatusCode;
use salvo::{Depot, Request, Response, handler};

use crate::app::api::dav::extract::auth::get_auth_context;
use shuriken_rfc::rfc::dav::build::multistatus::serialize_multistatus;
use shuriken_rfc::rfc::dav::core::{ExpandProperty, Multistatus, ReportType, SyncCollection};
use shuriken_service::auth::{
    Action, get_resolved_location_from_depot, get_terminal_collection_from_depot,
};

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
pub async fn report(req: &mut Request, res: &mut Response, depot: &Depot) {
    // Check if the collection was resolved by slug_resolver middleware
    // If not, return 404 (resource not found)
    if get_terminal_collection_from_depot(depot).is_err() {
        tracing::debug!("Collection not found in depot for REPORT request");
        res.status_code(StatusCode::NOT_FOUND);
        return;
    }

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
    let req_data = match shuriken_rfc::rfc::dav::parse::report::parse_report(body) {
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
            handle_sync_collection(req, res, sync, req_data.properties, depot).await;
        }
        ReportType::ExpandProperty(expand) => {
            handle_expand_property(req, res, expand, req_data.properties, depot).await;
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
    req: &mut Request,
    res: &mut Response,
    sync: SyncCollection,
    properties: Vec<shuriken_rfc::rfc::dav::core::PropertyName>,
    depot: &Depot,
) {
    let provider = match crate::db_handler::get_db_from_depot(depot) {
        Ok(provider) => provider,
        Err(e) => {
            tracing::error!(error = %e, "Failed to get database provider");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    let mut conn = match provider.get_connection().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::error!(error = %e, "Failed to get database connection");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    // Check authorization: user must have Read permission on the collection
    let (subjects, authorizer) = match get_auth_context(depot, &mut conn).await {
        Ok(ctx) => ctx,
        Err(status) => {
            res.status_code(status);
            return;
        }
    };

    // Get collection from depot (resolved by slug_resolver middleware)
    let collection = match get_terminal_collection_from_depot(depot) {
        Ok(coll) => coll,
        Err(_) => {
            tracing::debug!("Collection not found in depot for sync-collection REPORT");
            res.status_code(StatusCode::NOT_FOUND);
            return;
        }
    };

    // Get the resource location for authorization (resolved by slug_resolver middleware)
    let resource = match get_resolved_location_from_depot(depot) {
        Ok(loc) => loc.clone(),
        Err(_) => {
            tracing::error!("Failed to get resource location from depot");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    if let Err(e) = authorizer.require(&subjects, &resource, Action::Read) {
        tracing::debug!(error = %e, "Authorization denied for sync-collection REPORT");
        res.status_code(StatusCode::FORBIDDEN);
        return;
    }

    // Get base path from request
    let base_path = req.uri().path();

    // Build response
    let multistatus =
        match build_sync_collection_response(&mut conn, &sync, &properties, collection, base_path)
            .await
        {
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
async fn build_sync_collection_response(
    conn: &mut shuriken_db::db::connection::DbConnection<'_>,
    sync: &SyncCollection,
    properties: &[shuriken_rfc::rfc::dav::core::PropertyName],
    collection: &shuriken_db::model::dav::collection::DavCollection,
    base_path: &str,
) -> anyhow::Result<Multistatus> {
    use diesel::{ExpressionMethods, QueryDsl};
    use diesel_async::RunQueryDsl;
    use shuriken_db::db::query::dav::{instance, tombstone};
    use shuriken_rfc::rfc::dav::core::{DavProperty, Href, PropstatResponse, QName};

    // Parse sync token (0 for initial sync, otherwise parse as i64)
    let baseline_token: i64 = if sync.sync_token.is_empty() {
        0
    } else {
        sync.sync_token.parse().map_err(|e| {
            tracing::warn!(token = %sync.sync_token, error = %e, "Invalid sync token format");
            anyhow::anyhow!("Invalid sync-token: must be a valid integer")
        })?
    };

    // Query instances changed since baseline
    let instances = instance::by_collection_not_deleted(collection.id)
        .filter(shuriken_db::db::schema::dav_instance::sync_revision.gt(baseline_token))
        .load::<shuriken_db::model::dav::instance::DavInstance>(conn)
        .await?;

    // Query tombstones for deleted resources (only in delta sync, not initial)
    let tombstones = if baseline_token > 0 {
        tombstone::by_collection(collection.id)
            .filter(shuriken_db::db::schema::dav_tombstone::sync_revision.gt(baseline_token))
            .load::<shuriken_db::model::dav::tombstone::DavTombstone>(conn)
            .await?
    } else {
        vec![]
    };

    let mut multistatus = Multistatus::new();

    // Add changed/added instances to response
    for inst in instances {
        let href = Href::new(&format!(
            "{}{}.ics",
            base_path.trim_end_matches('/'),
            inst.slug
        ));

        // Build properties based on what was requested
        let props = if properties.is_empty() {
            // Return all default properties
            vec![
                DavProperty::text(QName::dav("getetag"), &inst.etag),
                DavProperty::text(QName::dav("getcontenttype"), inst.content_type.as_str()),
            ]
        } else {
            // Return requested properties
            let mut props = Vec::new();
            for prop_name in properties {
                let qname = prop_name.qname();
                match (qname.namespace_uri(), qname.local_name()) {
                    ("DAV:", "getetag") => {
                        props.push(DavProperty::text(qname.clone(), &inst.etag));
                    }
                    ("DAV:", "getcontenttype") => {
                        props.push(DavProperty::text(qname.clone(), inst.content_type.as_str()));
                    }
                    _ => {
                        // Unknown property - skip or add as not found
                    }
                }
            }
            props
        };

        multistatus.add_response(PropstatResponse::ok(href, props));
    }

    // Add deleted resources to response (404 status)
    for tomb in tombstones {
        // Use first URI variant if available
        if let Some(Some(uri)) = tomb.uri_variants.get(0) {
            let href = Href::new(&format!("{}{}", base_path.trim_end_matches('/'), uri));
            multistatus.add_response(PropstatResponse::not_found(href));
        }
    }

    // Add sync-token to multistatus
    multistatus.set_sync_token(&collection.synctoken.to_string());

    Ok(multistatus)
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
#[expect(dead_code, reason = "Scaffolded REPORT handler not wired yet")]
pub async fn handle_expand_property(
    req: &mut Request,
    res: &mut Response,
    expand: ExpandProperty,
    properties: Vec<shuriken_rfc::rfc::dav::core::PropertyName>,
    depot: &Depot,
) {
    let provider = match crate::db_handler::get_db_from_depot(depot) {
        Ok(provider) => provider,
        Err(e) => {
            tracing::error!(error = %e, "Failed to get database provider");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    let mut conn = match provider.get_connection().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::error!(error = %e, "Failed to get database connection");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    // Check authorization: user must have Read permission on the collection
    let (subjects, authorizer) = match get_auth_context(depot, &mut conn).await {
        Ok(ctx) => ctx,
        Err(status) => {
            res.status_code(status);
            return;
        }
    };

    // Get collection from depot (resolved by slug_resolver middleware)
    let _collection = match get_terminal_collection_from_depot(depot) {
        Ok(coll) => coll,
        Err(_) => {
            tracing::debug!("Collection not found in depot for expand-property REPORT");
            res.status_code(StatusCode::NOT_FOUND);
            return;
        }
    };

    // Get the resource location for authorization (resolved by slug_resolver middleware)
    let resource = match get_resolved_location_from_depot(depot) {
        Ok(loc) => loc.clone(),
        Err(_) => {
            tracing::error!("Failed to get resource location from depot");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    if let Err(e) = authorizer.require(&subjects, &resource, Action::Read) {
        tracing::debug!(error = %e, "Authorization denied for expand-property REPORT");
        res.status_code(StatusCode::FORBIDDEN);
        return;
    }

    // Build response
    let multistatus =
        match build_expand_property_response(&mut conn, req, &expand, &properties).await {
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
#[expect(clippy::too_many_lines)]
async fn build_expand_property_response(
    conn: &mut shuriken_db::db::connection::DbConnection<'_>,
    req: &Request,
    expand: &ExpandProperty,
    _properties: &[shuriken_rfc::rfc::dav::core::PropertyName],
) -> anyhow::Result<Multistatus> {
    use shuriken_rfc::rfc::dav::core::{DavProperty, Href, PropertyValue, PropstatResponse};
    use std::collections::HashSet;

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
                        if visited.contains(href) {
                            tracing::warn!("Cycle detected for href: {}, skipping", href);
                            expanded_properties.push(property);
                        } else {
                            visited.insert(href.clone());

                            // Fetch nested properties for this href
                            let nested_props = fetch_nested_properties(
                                conn,
                                href,
                                &prop_item.properties,
                                &mut visited,
                                1, // Start at depth 1
                            )
                            .await?;

                            // If we have nested properties, wrap them in the original property
                            if nested_props.is_empty() {
                                expanded_properties.push(property);
                            } else {
                                // Create a property with nested response
                                expanded_properties.push(DavProperty {
                                    name: prop_name.qname(),
                                    value: Some(PropertyValue::Xml(format_nested_response(
                                        href,
                                        &nested_props,
                                    ))),
                                });
                            }
                        }
                    }
                    PropertyValue::HrefSet(hrefs) => {
                        // Handle multiple hrefs
                        let mut expanded_hrefs = Vec::new();

                        for href in hrefs {
                            if visited.contains(href) {
                                continue;
                            }
                            visited.insert(href.clone());

                            let nested_props = fetch_nested_properties(
                                conn,
                                href,
                                &prop_item.properties,
                                &mut visited,
                                1, // Start at depth 1
                            )
                            .await?;

                            if !nested_props.is_empty() {
                                expanded_hrefs.push(format_nested_response(href, &nested_props));
                            }
                        }

                        if expanded_hrefs.is_empty() {
                            expanded_properties.push(property);
                        } else {
                            expanded_properties.push(DavProperty {
                                name: prop_name.qname(),
                                value: Some(PropertyValue::Xml(expanded_hrefs.join("\n"))),
                            });
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
#[expect(clippy::too_many_lines)]
async fn fetch_property(
    _conn: &mut shuriken_db::db::connection::DbConnection<'_>,
    path: &str,
    prop_name: &shuriken_rfc::rfc::dav::core::PropertyName,
) -> anyhow::Result<Option<shuriken_rfc::rfc::dav::core::DavProperty>> {
    use shuriken_rfc::rfc::dav::core::{DavProperty, PropertyValue, QName};

    let qname = prop_name.qname();

    // Stub implementation: Return common properties based on path patterns
    // In a full implementation, this would query the database
    let property = match (qname.namespace_uri(), qname.local_name()) {
        ("DAV:", "current-user-principal" | "principal-URL") => {
            Some(DavProperty::href(qname, "/principals/user/"))
        }
        ("DAV:", "displayname") => {
            // Extract display name based on path
            let name = path.split('/').next_back().unwrap_or("Resource");
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
            tracing::debug!(
                "Unknown property requested: {}:{}",
                qname.namespace_uri(),
                qname.local_name()
            );
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
#[expect(clippy::type_complexity)]
fn fetch_nested_properties<'a>(
    conn: &'a mut shuriken_db::db::connection::DbConnection<'_>,
    href: &'a str,
    nested_props: &'a [shuriken_rfc::rfc::dav::core::ExpandPropertyItem],
    visited: &'a mut std::collections::HashSet<String>,
    depth: usize,
) -> std::pin::Pin<
    Box<
        dyn std::future::Future<
                Output = anyhow::Result<Vec<shuriken_rfc::rfc::dav::core::DavProperty>>,
            > + Send
            + 'a,
    >,
> {
    // Recursion depth limit
    const MAX_DEPTH: usize = 10;

    Box::pin(async move {
        use shuriken_rfc::rfc::dav::core::{DavProperty, PropertyValue};

        let mut properties = Vec::new();

        if depth >= MAX_DEPTH {
            tracing::warn!(
                "Maximum expansion depth ({}) reached, stopping recursion",
                MAX_DEPTH
            );
            return Ok(properties);
        }

        for prop_item in nested_props {
            if let Some(property) = fetch_property(conn, href, &prop_item.name).await? {
                // Check if this property should be recursively expanded
                if prop_item.properties.is_empty() {
                    properties.push(property);
                } else if let Some(PropertyValue::Href(nested_href)) = &property.value {
                    if visited.contains(nested_href) {
                        properties.push(property);
                    } else {
                        visited.insert(nested_href.clone());

                        let deeper_props = fetch_nested_properties(
                            conn,
                            nested_href,
                            &prop_item.properties,
                            visited,
                            depth + 1,
                        )
                        .await?;

                        if deeper_props.is_empty() {
                            properties.push(property);
                        } else {
                            properties.push(DavProperty {
                                name: prop_item.name.qname(),
                                value: Some(PropertyValue::Xml(format_nested_response(
                                    nested_href,
                                    &deeper_props,
                                ))),
                            });
                        }
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
#[expect(
    clippy::let_underscore_must_use,
    reason = "Write to String is infallible"
)]
fn format_nested_response(
    href: &str,
    properties: &[shuriken_rfc::rfc::dav::core::DavProperty],
) -> String {
    use shuriken_rfc::rfc::dav::core::PropertyValue;
    use std::fmt::Write;

    let mut xml = format!("<D:response><D:href>{href}</D:href><D:propstat><D:prop>");

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
                    let _ = write!(xml, "<{prefix}:{name}>{text}</{prefix}:{name}>");
                }
                PropertyValue::Href(href) => {
                    let _ = write!(
                        xml,
                        "<{prefix}:{name}><D:href>{href}</D:href></{prefix}:{name}>"
                    );
                }
                PropertyValue::Empty => {
                    let _ = write!(xml, "<{prefix}:{name}/>");
                }
                PropertyValue::Xml(content) => {
                    let _ = write!(xml, "<{prefix}:{name}>{content}</{prefix}:{name}>");
                }
                _ => {
                    // For complex types, just use empty element for now
                    let _ = write!(xml, "<{prefix}:{name}/>");
                }
            }
        } else {
            let _ = write!(xml, "<{prefix}:{name}/>");
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
