//! PROPFIND method handler for `WebDAV` resources.

#![allow(dead_code)]

use salvo::http::StatusCode;
use salvo::{Request, Response, handler};

use crate::app::api::dav::extract::headers::{Depth, parse_depth};
use crate::component::db::connection;
use crate::component::rfc::dav::build::multistatus::serialize_multistatus;
use crate::component::rfc::dav::core::{
    DavProperty, Href, Multistatus, PropstatResponse, QName, property::PropertyValue,
};
use crate::component::rfc::dav::parse::propfind::parse_propfind;

/// ## Summary
/// Handles PROPFIND requests for `WebDAV` resources.
///
/// Parses the request body to determine which properties to return,
/// queries the database for resources at the specified depth,
/// and builds a multistatus response.
///
/// ## Side Effects
/// - Parses request body XML
/// - Queries the database
/// - Returns 207 Multi-Status XML response
///
/// ## Errors
/// Returns 400 for malformed requests, 404 for missing resources, 500 for server errors.
#[handler]
pub async fn propfind(req: &mut Request, res: &mut Response) {
    // Parse Depth header (default to 0 for PROPFIND)
    let depth = parse_depth(req).unwrap_or_else(Depth::default_for_propfind);
    
    // Parse request body
    let body = match req.payload().await {
        Ok(bytes) => bytes.to_vec(),
        Err(e) => {
            tracing::error!("Failed to read request body: {}", e);
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };
    
    // Parse PROPFIND request (empty body = allprop)
    let propfind_req = match parse_propfind(&body) {
        Ok(req) => req,
        Err(e) => {
            tracing::error!("Failed to parse PROPFIND request: {}", e);
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };
    
    // Get database connection
    let mut conn = match connection::connect().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::error!("Failed to get database connection: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };
    
    // Build multistatus response
    let multistatus = match build_propfind_response(&mut conn, req, depth, &propfind_req).await {
        Ok(ms) => ms,
        Err(e) => {
            tracing::error!("Failed to build PROPFIND response: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };
    
    // Serialize to XML
    let xml = match serialize_multistatus(&multistatus) {
        Ok(xml) => xml,
        Err(e) => {
            tracing::error!("Failed to serialize multistatus: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };
    
    // Set response
    res.status_code(StatusCode::MULTI_STATUS);
    res.add_header(
        "Content-Type",
        salvo::http::HeaderValue::from_static("application/xml; charset=utf-8"),
        true,
    )
    .expect("valid header");
    res.write_body(xml).expect("valid body");
}

/// ## Summary
/// Builds a multistatus response for a PROPFIND request.
///
/// Queries the database for the target resource and its children (based on depth),
/// retrieves the requested properties, and constructs the response.
///
/// ## Errors
/// Returns errors for database failures or property resolution issues.
#[allow(clippy::unused_async)]
async fn build_propfind_response(
    conn: &mut connection::DbConnection<'_>,
    req: &Request,
    depth: Depth,
    propfind_req: &crate::component::rfc::dav::core::PropfindRequest,
) -> anyhow::Result<Multistatus> {
    let path = req.uri().path();
    
    // TODO: Parse path to determine if this is a collection or item
    // TODO: Load resource from database
    
    let mut multistatus = Multistatus::new();
    
    // For now, create a stub response
    // In a real implementation, we would:
    // 1. Parse the path to get collection_id or instance_id
    // 2. Load the resource from the database
    // 3. Based on depth, load children if this is a collection
    // 4. For each resource, get the requested properties
    // 5. Build PropstatResponse for each resource
    
    // Stub: Return a minimal response for the requested resource
    let href = Href::new(path);
    let properties = get_properties_for_resource(conn, path, propfind_req).await?;
    
    let response = PropstatResponse::ok(href, properties);
    multistatus.add_response(response);
    
    // If depth is 1, add child resources (stub)
    if matches!(depth, Depth::One) {
        // TODO: Query for child resources and add them to multistatus
    }
    
    Ok(multistatus)
}

/// ## Summary
/// Retrieves properties for a resource based on the PROPFIND request.
///
/// ## Errors
/// Returns errors if property resolution fails.
#[allow(clippy::unused_async)]
#[allow(clippy::too_many_lines)]
async fn get_properties_for_resource(
    _conn: &mut connection::DbConnection<'_>,
    _path: &str,
    propfind_req: &crate::component::rfc::dav::core::PropfindRequest,
) -> anyhow::Result<Vec<DavProperty>> {
    let mut properties = Vec::new();
    
    // Handle different PROPFIND types
    if propfind_req.is_allprop() {
        // Return all defined properties
        properties.push(DavProperty::text(
            QName::dav("displayname"),
            "Calendar",
        ));
        properties.push(DavProperty {
            name: QName::dav("resourcetype"),
            value: Some(PropertyValue::ResourceType(vec![
                QName::dav("collection"),
                QName::caldav("calendar"),
            ])),
        });
        properties.push(DavProperty {
            name: QName::dav("supported-report-set"),
            value: Some(PropertyValue::SupportedReports(vec![
                QName::caldav("calendar-query"),
                QName::caldav("calendar-multiget"),
                QName::dav("sync-collection"),
            ])),
        });
    } else if propfind_req.is_propname() {
        // Return property names only (empty values)
        properties.push(DavProperty::not_found(QName::dav("displayname")));
        properties.push(DavProperty::not_found(QName::dav("resourcetype")));
    } else if let Some(requested_props) = propfind_req.requested_properties() {
        // Return only requested properties
        for prop_name in requested_props {
            let qname = prop_name.qname().clone();
            
            // Resolve each property
            // For now, stub with placeholder values
            match (qname.namespace_uri(), qname.local_name()) {
                ("DAV:", "displayname") => {
                    properties.push(DavProperty::text(qname, "Calendar"));
                }
                ("DAV:", "resourcetype") => {
                    properties.push(DavProperty {
                        name: qname,
                        value: Some(PropertyValue::ResourceType(vec![
                            QName::dav("collection"),
                            QName::caldav("calendar"),
                        ])),
                    });
                }
                ("DAV:", "supported-report-set") => {
                    properties.push(DavProperty {
                        name: qname,
                        value: Some(PropertyValue::SupportedReports(vec![
                            QName::caldav("calendar-query"),
                            QName::caldav("calendar-multiget"),
                            QName::dav("sync-collection"),
                        ])),
                    });
                }
                _ => {
                    // Unknown property - return as not found
                    properties.push(DavProperty::not_found(qname));
                }
            }
        }
    }
    
    Ok(properties)
}
