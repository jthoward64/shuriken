//! Helper functions for PROPFIND request processing.

use salvo::Request;

use crate::app::api::dav::extract::headers::Depth;
use crate::component::db::connection;
use crate::component::rfc::dav::core::{
    DavProperty, Href, Multistatus, PropstatResponse, QName, property::PropertyValue,
};

/// ## Summary
/// Builds a multistatus response for a PROPFIND request.
///
/// Queries the database for the target resource and its children (based on depth),
/// retrieves the requested properties, and constructs the response.
///
/// ## Errors
/// Returns errors for database failures or property resolution issues.
#[expect(dead_code)]
pub(super) async fn build_propfind_response(
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
#[expect(clippy::unused_async, clippy::too_many_lines)]
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
    } else {
        // No specific properties requested - this case shouldn't happen
        // as allprop and propname are already handled above
    }
    
    Ok(properties)
}
