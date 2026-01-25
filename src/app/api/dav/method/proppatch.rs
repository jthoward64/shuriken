//! PROPPATCH method handler for `WebDAV` property updates.

#![allow(clippy::manual_let_else)]
#![allow(clippy::single_match_else)]

use salvo::{handler, Request, Response};
use salvo::http::StatusCode;
use salvo::writing::Text;

use crate::component::db::connection;
use crate::component::db::query::dav::collection;
use crate::component::rfc::dav::parse;
use crate::component::rfc::dav::core::{Multistatus, PropstatResponse, Propstat, Status, DavProperty};
use crate::component::rfc::dav::build::multistatus::serialize_multistatus;

/// ## Summary
/// Handles PROPPATCH requests to update `WebDAV` properties.
///
/// Parses the PROPPATCH XML request body, validates protected properties,
/// applies changes to writable properties, and returns a 207 Multi-Status response.
///
/// ## Side Effects
/// - Updates collection/resource properties in database
/// - Returns 207 Multi-Status with per-property status codes
///
/// ## Errors
/// Returns 400 for invalid XML, 403 for protected properties, 500 for server errors.
#[handler]
pub async fn proppatch(req: &mut Request, res: &mut Response) {
    // Get path to determine the resource
    let path = req.uri().path().to_string();
    
    // Read request body
    let body = match req.payload().await {
        Ok(bytes) => bytes.to_vec(),
        Err(e) => {
            tracing::error!("Failed to read PROPPATCH request body: {}", e);
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };
    
    // Parse PROPPATCH XML
    let proppatch_request = match parse::parse_proppatch(&body) {
        Ok(req) => req,
        Err(e) => {
            tracing::error!("Failed to parse PROPPATCH XML: {}", e);
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
    
    // TODO: Parse path to extract collection ID
    // TODO: Check authorization
    // For now, use a placeholder collection ID
    let collection_id = match parse_collection_id_from_path(&path) {
        Ok(id) => id,
        Err(_) => {
            tracing::error!("Invalid path format for PROPPATCH: {}", path);
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };
    
    // Build multistatus response
    let mut multistatus = Multistatus::new();
    let mut response = PropstatResponse::new(path.as_str());
    
    // Process property updates
    let mut display_name_update: Option<Option<String>> = None;
    let mut description_update: Option<Option<String>> = None;
    let mut success_props = Vec::new();
    let mut forbidden_props = Vec::new();
    
    // Process SET operations
    for prop in proppatch_request.sets() {
        match (prop.name.namespace.as_str(), prop.name.local_name.as_ref()) {
            ("DAV:", "displayname") => {
                if let Some(ref value) = prop.value {
                    display_name_update = Some(Some(value.as_text().unwrap_or("").to_string()));
                    success_props.push(DavProperty::empty(prop.name.clone()));
                } else {
                    display_name_update = Some(None);
                    success_props.push(DavProperty::empty(prop.name.clone()));
                }
            }
            ("urn:ietf:params:xml:ns:caldav", "calendar-description") |
            ("urn:ietf:params:xml:ns:carddav", "addressbook-description") => {
                if let Some(ref value) = prop.value {
                    description_update = Some(Some(value.as_text().unwrap_or("").to_string()));
                    success_props.push(DavProperty::empty(prop.name.clone()));
                } else {
                    description_update = Some(None);
                    success_props.push(DavProperty::empty(prop.name.clone()));
                }
            }
            _ => {
                // Protected or unsupported property
                forbidden_props.push(DavProperty::empty(prop.name.clone()));
            }
        }
    }
    
    // Process REMOVE operations
    for prop_name in proppatch_request.removes() {
        match (prop_name.namespace.as_str(), prop_name.local_name.as_ref()) {
            ("DAV:", "displayname") => {
                display_name_update = Some(None);
                success_props.push(DavProperty::empty(prop_name.clone()));
            }
            ("urn:ietf:params:xml:ns:caldav", "calendar-description") |
            ("urn:ietf:params:xml:ns:carddav", "addressbook-description") => {
                description_update = Some(None);
                success_props.push(DavProperty::empty(prop_name.clone()));
            }
            _ => {
                forbidden_props.push(DavProperty::empty(prop_name.clone()));
            }
        }
    }
    
    // Apply updates if any writable properties were modified
    if display_name_update.is_some() || description_update.is_some() {
        let display_name_str = display_name_update.as_ref().and_then(|opt| opt.as_deref());
        let description_str = description_update.as_ref().and_then(|opt| opt.as_deref());
        
        match collection::update_collection_properties(&mut conn, collection_id, display_name_str, description_str).await {
            Ok(_) => {
                // Success - add 200 propstat
                if !success_props.is_empty() {
                    let success_propstat = Propstat::new(Status::Ok, success_props);
                    response.add_propstat(success_propstat);
                }
            }
            Err(e) => {
                tracing::error!("Failed to update collection properties: {}", e);
                // Add failed-dependency status for all properties
                let failed_propstat = Propstat::new(Status::FailedDependency, success_props);
                response.add_propstat(failed_propstat);
            }
        }
    }
    
    // Add forbidden properties with 403 status
    if !forbidden_props.is_empty() {
        let forbidden_propstat = Propstat::new(Status::Forbidden, forbidden_props);
        response.add_propstat(forbidden_propstat);
    }
    
    multistatus.add_response(response);
    
    // Serialize and return multistatus
    match serialize_multistatus(&multistatus) {
        Ok(xml) => {
            res.status_code(StatusCode::MULTI_STATUS);
            res.add_header("Content-Type", "application/xml; charset=utf-8", true).ok();
            res.render(Text::Xml(xml));
        }
        Err(e) => {
            tracing::error!("Failed to serialize multistatus: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
        }
    }
}

/// Parses collection ID from path (placeholder implementation).
fn parse_collection_id_from_path(path: &str) -> Result<uuid::Uuid, String> {
    // TODO: Implement proper path parsing
    // For now, try to extract UUID from path segments
    for segment in path.split('/') {
        if let Ok(id) = uuid::Uuid::parse_str(segment) {
            return Ok(id);
        }
    }
    Err("No valid UUID found in path".to_string())
}
