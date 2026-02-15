//! PROPFIND handler for principal resources.
//!
//! Handles PROPFIND requests on principal URLs (e.g., `/api/dav/principal/testuser/`).

use salvo::http::StatusCode;
use salvo::{Depot, Request, Response, handler};

use shuriken_rfc::rfc::dav::build::multistatus::serialize_multistatus;
use shuriken_rfc::rfc::dav::core::{DavProperty, Href, Multistatus, PropstatResponse, PropertyValue, QName};
use shuriken_rfc::rfc::dav::parse::propfind::parse_propfind;

use crate::app::api::dav::extract::headers::parse_depth;

/// ## Summary
/// Handles PROPFIND requests on principal resources.
///
/// Returns principal properties including:
/// - displayname
/// - resourcetype (principal + collection)
/// - current-user-principal (optional)
/// - principal-URL (optional)
/// - supported-report-set
///
/// ## Side Effects
/// - Parses request body XML
/// - Returns 207 Multi-Status XML response
///
/// ## Errors
/// Returns 400 for malformed requests, 404 for missing principals, 500 for server errors.
#[handler]
#[tracing::instrument(skip_all, fields(
    method = "PROPFIND",
    path = %req.uri().path()
))]
pub async fn principal_propfind(req: &mut Request, res: &mut Response, _depot: &Depot) {
    tracing::info!("Handling PROPFIND request on principal");

    // Parse Depth header (default to 0 for PROPFIND)
    let _depth = parse_depth(req);

    // Parse request body
    let body = match req.payload().await {
        Ok(bytes) => bytes.to_vec(),
        Err(e) => {
            tracing::error!(error = %e, "Failed to read request body");
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };

    // Parse PROPFIND request (empty body = allprop)
    let propfind_req = match parse_propfind(&body) {
        Ok(req) => req,
        Err(e) => {
            tracing::error!(error = %e, "Failed to parse PROPFIND request");
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };

    tracing::debug!("PROPFIND request parsed successfully");

    // Build response for the principal resource
    let path = req.uri().path();
    let href = Href::new(path);

    let mut found_properties = Vec::new();
    let mut not_found_properties = Vec::new();

    // Determine which properties to return based on request type
    if propfind_req.is_allprop() {
        // Return all standard principal properties
        found_properties.push(DavProperty::text(
            QName::dav("displayname"),
            "Principal",
        ));
        found_properties.push(DavProperty {
            name: QName::dav("resourcetype"),
            value: Some(PropertyValue::ResourceType(vec![
                QName::dav("collection"),
                QName::dav("principal"),
            ])),
        });

        // Add supported-report-set
        found_properties.push(DavProperty {
            name: QName::dav("supported-report-set"),
            value: Some(PropertyValue::SupportedReports(vec![
                QName::dav("expand-property"),
                QName::dav("principal-property-search"),
                QName::dav("principal-search-property-set"),
            ])),
        });
    } else if propfind_req.is_propname() {
        // Return property names only
        found_properties.push(DavProperty {
            name: QName::dav("displayname"),
            value: None,
        });
        found_properties.push(DavProperty {
            name: QName::dav("resourcetype"),
            value: None,
        });
        found_properties.push(DavProperty {
            name: QName::dav("supported-report-set"),
            value: None,
        });
    } else if let Some(props) = propfind_req.requested_properties() {
        // Return requested properties
        for prop_name in props {
            let qname = prop_name.qname();
            match (qname.namespace_uri(), qname.local_name()) {
                ("DAV:", "displayname") => {
                    found_properties.push(DavProperty::text(
                        QName::dav("displayname"),
                        "Principal",
                    ));
                }
                ("DAV:", "resourcetype") => {
                    found_properties.push(DavProperty {
                        name: QName::dav("resourcetype"),
                        value: Some(PropertyValue::ResourceType(vec![
                            QName::dav("collection"),
                            QName::dav("principal"),
                        ])),
                    });
                }
                ("DAV:", "supported-report-set") => {
                    found_properties.push(DavProperty {
                        name: QName::dav("supported-report-set"),
                        value: Some(PropertyValue::SupportedReports(vec![
                            QName::dav("expand-property"),
                            QName::dav("principal-property-search"),
                            QName::dav("principal-search-property-set"),
                        ])),
                    });
                }
                _ => {
                    // Unknown property
                    not_found_properties.push(DavProperty {
                        name: qname,
                        value: None,
                    });
                }
            }
        }
    }

    // Build propstat response
    let response = if not_found_properties.is_empty() {
        PropstatResponse::ok(href, found_properties)
    } else {
        PropstatResponse::with_found_and_not_found(href, found_properties, not_found_properties)
    };

    // Build multistatus
    let mut multistatus = Multistatus::new();
    multistatus.responses.push(response);

    // Serialize and send response
    match serialize_multistatus(&multistatus) {
        Ok(xml) => {
            res.status_code(StatusCode::MULTI_STATUS);
            res.add_header("Content-Type", "application/xml; charset=utf-8", true)
                .expect("Failed to add Content-Type header");
            res.write_body(xml).expect("Failed to write response body");
        }
        Err(e) => {
            tracing::error!(error = %e, "Failed to serialize multistatus");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
        }
    }
}
