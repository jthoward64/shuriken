//! Helper functions for PROPFIND request processing.

use salvo::{Depot, Request};

use crate::app::api::dav::extract::headers::Depth;
use shuriken_rfc::rfc::dav::core::{
    DavProperty, Href, Multistatus, PropstatResponse, QName, property::PropertyValue,
    property::discovery,
};
use shuriken_service::auth::get_terminal_collection_from_depot;

/// ## Summary
/// Builds a multistatus response for a PROPFIND request.
///
/// Queries the database for the target resource and its children (based on depth),
/// retrieves the requested properties, and constructs the response.
///
/// ## Errors
/// Returns errors for database failures or property resolution issues.
pub(super) async fn build_propfind_response(
    conn: &mut shuriken_db::db::connection::DbConnection<'_>,
    req: &Request,
    depot: &Depot,
    depth: Depth,
    propfind_req: &shuriken_rfc::rfc::dav::core::PropfindRequest,
) -> anyhow::Result<Multistatus> {
    let path = req.uri().path();

    // Try to get collection from depot (populated by slug_resolver middleware)
    let collection = get_terminal_collection_from_depot(depot).ok();

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
    let (found_properties, not_found_properties) =
        get_properties_for_resource(conn, path, collection, propfind_req).await?;

    let response = if !not_found_properties.is_empty() {
        PropstatResponse::with_found_and_not_found(href, found_properties, not_found_properties)
    } else {
        PropstatResponse::ok(href, found_properties)
    };
    multistatus.add_response(response);

    // If depth is 1, add child resources
    if matches!(depth, Depth::One) {
        if let Some(coll) = collection {
            // Query for child instances in the collection
            let instances = {
                use diesel_async::RunQueryDsl;
                use shuriken_db::db::query::dav::instance;

                instance::by_collection_not_deleted(coll.id)
                    .load::<shuriken_db::model::dav::instance::DavInstance>(conn)
                    .await?
            };

            // Build a response for each child instance
            for inst in instances {
                // Determine file extension from collection type
                let extension = match coll.collection_type.as_str() {
                    "calendar" => ".ics",
                    "addressbook" => ".vcf",
                    _ => "", // Plain collections have no extension
                };
                // Build child path by appending slug with extension to collection path
                let child_path =
                    format!("{}/{}{}", path.trim_end_matches('/'), inst.slug, extension);
                let child_href = Href::new(&child_path);

                // For child resources, build properties from the instance
                let (child_found, child_not_found) =
                    get_properties_for_instance(conn, &inst, collection, propfind_req).await?;

                let child_response = if !child_not_found.is_empty() {
                    PropstatResponse::with_found_and_not_found(
                        child_href,
                        child_found,
                        child_not_found,
                    )
                } else {
                    PropstatResponse::ok(child_href, child_found)
                };

                multistatus.add_response(child_response);
            }
        }
    }

    Ok(multistatus)
}

/// ## Summary
/// Retrieves properties for a resource based on the PROPFIND request.
///
/// Returns a tuple of (found_properties, not_found_properties).
///
/// ## Errors
/// Returns errors if property resolution fails.
#[expect(clippy::too_many_lines)]
async fn get_properties_for_resource(
    _conn: &mut shuriken_db::db::connection::DbConnection<'_>,
    _path: &str,
    collection: Option<&shuriken_db::model::dav::collection::DavCollection>,
    propfind_req: &shuriken_rfc::rfc::dav::core::PropfindRequest,
) -> anyhow::Result<(Vec<DavProperty>, Vec<DavProperty>)> {
    let mut found = Vec::new();
    let mut not_found = Vec::new();

    // Get the displayname from the collection, or use a sensible default
    let display_name = collection
        .and_then(|c| c.display_name.as_deref())
        .unwrap_or("Calendar");

    // Determine the collection type for resourcetype property
    let collection_type = collection.map(|c| c.collection_type.as_str());
    let collection_qname = match collection_type {
        Some("calendar") => QName::caldav("calendar"),
        Some("addressbook") => QName::carddav("addressbook"),
        _ => QName::caldav("calendar"), // Default fallback
    };

    // Handle different PROPFIND types
    if propfind_req.is_allprop() {
        // Return all defined properties
        found.push(DavProperty::text(QName::dav("displayname"), display_name));
        found.push(DavProperty {
            name: QName::dav("resourcetype"),
            value: Some(PropertyValue::ResourceType(vec![
                QName::dav("collection"),
                collection_qname.clone(),
            ])),
        });

        // RFC 4791/RFC 6352: Add discovery properties based on collection type
        if let Some(coll) = collection {
            // DAV:supported-report-set - RFC 3253 via CalDAV/CardDAV
            found.push(DavProperty::xml(
                QName::dav("supported-report-set"),
                discovery::supported_report_set(coll.collection_type.into()),
            ));

            // CalDAV-specific properties
            if matches!(coll.collection_type.as_str(), "calendar") {
                // CALDAV:supported-calendar-component-set - RFC 4791 §5.2.3
                found.push(DavProperty::xml(
                    QName::caldav("supported-calendar-component-set"),
                    discovery::supported_calendar_component_set(),
                ));

                // CALDAV:supported-collation-set - RFC 4791 §7.5.1
                found.push(DavProperty::xml(
                    QName::caldav("supported-collation-set"),
                    discovery::supported_collation_set(),
                ));
            }

            // CardDAV-specific properties
            if matches!(coll.collection_type.as_str(), "addressbook") {
                // CARDDAV:supported-address-data - RFC 6352 §6.2.2
                found.push(DavProperty::xml(
                    QName::carddav("supported-address-data"),
                    discovery::supported_address_data(),
                ));
            }

            // Add getetag
            found.push(DavProperty::text(
                QName::dav("getetag"),
                &format!("\"{}\"", coll.synctoken),
            ));
        }
    } else if propfind_req.is_propname() {
        // Return property names only (empty values)
        found.push(DavProperty::empty(QName::dav("displayname")));
        found.push(DavProperty::empty(QName::dav("resourcetype")));
    } else if let Some(requested_props) = propfind_req.requested_properties() {
        // Return only requested properties
        for prop_name in requested_props {
            let qname = prop_name.qname().clone();

            // Resolve each property
            match (qname.namespace_uri(), qname.local_name()) {
                ("DAV:", "displayname") => {
                    found.push(DavProperty::text(qname, display_name));
                }
                ("DAV:", "resourcetype") => {
                    found.push(DavProperty {
                        name: qname,
                        value: Some(PropertyValue::ResourceType(vec![
                            QName::dav("collection"),
                            collection_qname.clone(),
                        ])),
                    });
                }
                ("DAV:", "supported-report-set") => {
                    // RFC 3253 via RFC 4791/RFC 6352: Return supported REPORT methods
                    if let Some(coll) = collection {
                        found.push(DavProperty::xml(
                            qname,
                            discovery::supported_report_set(coll.collection_type.into()),
                        ));
                    } else {
                        not_found.push(DavProperty::empty(qname));
                    }
                }
                ("urn:ietf:params:xml:ns:caldav", "supported-calendar-component-set") => {
                    // RFC 4791 §5.2.3: Supported component types for calendar collections
                    if let Some(coll) = collection {
                        if matches!(coll.collection_type.as_str(), "calendar") {
                            found.push(DavProperty::xml(
                                qname,
                                discovery::supported_calendar_component_set(),
                            ));
                        } else {
                            not_found.push(DavProperty::empty(qname));
                        }
                    } else {
                        not_found.push(DavProperty::empty(qname));
                    }
                }
                ("urn:ietf:params:xml:ns:caldav", "supported-collation-set") => {
                    // RFC 4791 §7.5.1: Supported text matching collations
                    if let Some(coll) = collection {
                        if matches!(coll.collection_type.as_str(), "calendar") {
                            found.push(DavProperty::xml(
                                qname,
                                discovery::supported_collation_set(),
                            ));
                        } else {
                            not_found.push(DavProperty::empty(qname));
                        }
                    } else {
                        not_found.push(DavProperty::empty(qname));
                    }
                }
                ("urn:ietf:params:xml:ns:carddav", "supported-address-data") => {
                    // RFC 6352 §6.2.2: Supported vCard versions for addressbook collections
                    if let Some(coll) = collection {
                        if matches!(coll.collection_type.as_str(), "addressbook") {
                            found
                                .push(DavProperty::xml(qname, discovery::supported_address_data()));
                        } else {
                            not_found.push(DavProperty::empty(qname));
                        }
                    } else {
                        not_found.push(DavProperty::empty(qname));
                    }
                }
                ("DAV:", "getetag") => {
                    if let Some(coll) = collection {
                        found.push(DavProperty::text(qname, &format!("\"{}\"", coll.synctoken)));
                    } else {
                        not_found.push(DavProperty::empty(qname));
                    }
                }
                _ => {
                    // Unknown property - return as not found
                    not_found.push(DavProperty::empty(qname));
                }
            }
        }
    }

    Ok((found, not_found))
}

/// ## Summary
/// Retrieves properties for a child instance resource.
///
/// Returns a tuple of (found_properties, not_found_properties).
///
/// ## Errors
/// Returns errors if property resolution fails.
async fn get_properties_for_instance(
    _conn: &mut shuriken_db::db::connection::DbConnection<'_>,
    instance: &shuriken_db::model::dav::instance::DavInstance,
    _collection: Option<&shuriken_db::model::dav::collection::DavCollection>,
    propfind_req: &shuriken_rfc::rfc::dav::core::PropfindRequest,
) -> anyhow::Result<(Vec<DavProperty>, Vec<DavProperty>)> {
    let mut found = Vec::new();
    let mut not_found = Vec::new();

    // Child instances are non-collection resources
    if propfind_req.is_allprop() {
        // Return all defined properties for an instance
        found.push(DavProperty::text(QName::dav("getetag"), &instance.etag));
        found.push(DavProperty::text(
            QName::dav("getcontenttype"),
            instance.content_type.as_str(),
        ));
        // resourcetype is empty for non-collection resources
        found.push(DavProperty {
            name: QName::dav("resourcetype"),
            value: Some(PropertyValue::ResourceType(vec![])),
        });
    } else if propfind_req.is_propname() {
        // Return property names only
        found.push(DavProperty::empty(QName::dav("getetag")));
        found.push(DavProperty::empty(QName::dav("getcontenttype")));
        found.push(DavProperty::empty(QName::dav("resourcetype")));
    } else if let Some(requested_props) = propfind_req.requested_properties() {
        // Return only requested properties
        for prop_name in requested_props {
            let qname = prop_name.qname().clone();

            match (qname.namespace_uri(), qname.local_name()) {
                ("DAV:", "getetag") => {
                    found.push(DavProperty::text(qname, &instance.etag));
                }
                ("DAV:", "getcontenttype") => {
                    found.push(DavProperty::text(qname, instance.content_type.as_str()));
                }
                ("DAV:", "resourcetype") => {
                    found.push(DavProperty {
                        name: qname,
                        value: Some(PropertyValue::ResourceType(vec![])),
                    });
                }
                _ => {
                    // Unknown property
                    not_found.push(DavProperty::empty(qname));
                }
            }
        }
    }

    Ok((found, not_found))
}
