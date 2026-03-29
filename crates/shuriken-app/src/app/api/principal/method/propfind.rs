//! PROPFIND handler for principal resources.
//!
//! Handles PROPFIND requests on principal URLs (e.g., `/api/dav/principal/testuser/`).

use salvo::http::StatusCode;
use salvo::{Depot, Request, Response, handler};

use shuriken_rfc::rfc::dav::build::multistatus::serialize_multistatus;
use shuriken_rfc::rfc::dav::core::{
    DavProperty, Href, Multistatus, PropstatResponse, PropertyValue, QName,
};
use shuriken_rfc::rfc::dav::parse::propfind::parse_propfind;

use crate::app::api::dav::extract::headers::{Depth, parse_depth};
use crate::app::api::dav::response::error::write_precondition_error;
use shuriken_rfc::rfc::dav::core::PreconditionError;
use shuriken_service::auth::{
    PathSegment, ResourceLocation, ResourceType, get_user_from_depot,
};

/// ## Summary
/// Builds the href for the current user's principal URL.
///
/// ## Errors
/// Returns `None` if the user is not authenticated or if path serialization fails.
fn current_user_principal_href(depot: &Depot) -> Option<String> {
    let user = get_user_from_depot(depot).ok()?;
    let location = ResourceLocation::from_segments(vec![
        PathSegment::ResourceType(ResourceType::Principal),
        PathSegment::owner_from_id(user.principal_id),
    ])
    .ok()?;
    location.serialize_to_full_path(false, false).ok()
}

/// ## Summary
/// Resolves a single property for a principal resource.
fn resolve_principal_property(
    qname: QName,
    depot: &Depot,
    path: &str,
    found: &mut Vec<DavProperty>,
    not_found: &mut Vec<DavProperty>,
) {
    match (qname.namespace_uri(), qname.local_name()) {
        ("DAV:", "displayname") => {
            found.push(DavProperty::text(qname, "Principal"));
        }
        ("DAV:", "resourcetype") => {
            found.push(DavProperty {
                name: qname,
                value: Some(PropertyValue::ResourceType(vec![
                    QName::dav("collection"),
                    QName::dav("principal"),
                ])),
            });
        }
        ("DAV:", "supported-report-set") => {
            found.push(DavProperty {
                name: qname,
                value: Some(PropertyValue::SupportedReports(vec![
                    QName::dav("expand-property"),
                    QName::dav("principal-property-search"),
                    QName::dav("principal-search-property-set"),
                ])),
            });
        }
        ("DAV:", "current-user-principal") => {
            if let Some(href) = current_user_principal_href(depot) {
                found.push(DavProperty::href(qname, href));
            } else {
                // Unauthenticated - return unauthenticated element
                found.push(DavProperty::xml(
                    qname,
                    "<D:unauthenticated/>".to_string(),
                ));
            }
        }
        ("DAV:", "principal-URL") => {
            // The principal-URL is this resource's own URL
            found.push(DavProperty::href(qname, path));
        }
        _ => {
            not_found.push(DavProperty {
                name: qname,
                value: None,
            });
        }
    }
}

/// ## Summary
/// Handles PROPFIND requests on principal resources.
///
/// Returns principal properties including:
/// - displayname
/// - resourcetype (principal + collection)
/// - current-user-principal
/// - principal-URL
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
pub async fn principal_propfind(req: &mut Request, res: &mut Response, depot: &Depot) {
    tracing::info!("Handling PROPFIND request on principal");

    // Parse Depth header (default to 0 for PROPFIND)
    let depth = parse_depth(req).unwrap_or_else(Depth::default_for_propfind);

    // RFC 4918 §9.1: Reject Depth:infinity requests
    if matches!(depth, Depth::Infinity) {
        tracing::debug!("Rejecting Depth:infinity PROPFIND on principal");
        write_precondition_error(res, &PreconditionError::PropfindFiniteDepth);
        return;
    }

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
        let all_props = [
            "displayname",
            "resourcetype",
            "supported-report-set",
            "current-user-principal",
            "principal-URL",
        ];
        for name in all_props {
            resolve_principal_property(
                QName::dav(name),
                depot,
                path,
                &mut found_properties,
                &mut not_found_properties,
            );
        }
    } else if propfind_req.is_propname() {
        // Return property names only
        found_properties.push(DavProperty::empty(QName::dav("displayname")));
        found_properties.push(DavProperty::empty(QName::dav("resourcetype")));
        found_properties.push(DavProperty::empty(QName::dav("supported-report-set")));
        found_properties.push(DavProperty::empty(QName::dav("current-user-principal")));
        found_properties.push(DavProperty::empty(QName::dav("principal-URL")));
    } else if let Some(props) = propfind_req.requested_properties() {
        // Return requested properties
        for prop_name in props {
            resolve_principal_property(
                prop_name.qname(),
                depot,
                path,
                &mut found_properties,
                &mut not_found_properties,
            );
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
    multistatus.add_response(response);

    // Serialize and send response
    match serialize_multistatus(&multistatus) {
        Ok(xml) => {
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
        Err(e) => {
            tracing::error!(error = %e, "Failed to serialize multistatus");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
        }
    }
}
