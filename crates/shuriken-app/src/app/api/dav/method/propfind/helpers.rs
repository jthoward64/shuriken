//! Helper functions for PROPFIND request processing.

use std::sync::Arc;

use salvo::{Depot, Request};

use crate::app::api::dav::extract::headers::Depth;
use shuriken_rfc::rfc::dav::core::{
    DavProperty, Href, Multistatus, PropstatResponse, QName, property::PropertyValue,
    property::discovery,
};
use shuriken_service::auth::casbin::get_enforcer_from_depot;
use shuriken_service::auth::{
    Action, Authorizer, ExpandedSubjects, PathSegment, PermissionLevel, PrivilegeSetBuilder,
    ResourceIdentifier, ResourceLocation, authorizer_from_depot, get_resolved_location_from_depot,
    get_subjects_from_depot, get_terminal_collection_from_depot, serialize_acl_for_resource,
};

/// Load child instances for a collection (for depth=1 queries).
async fn load_child_instances(
    conn: &mut shuriken_db::db::connection::DbConnection<'_>,
    collection_id: uuid::Uuid,
) -> anyhow::Result<Vec<shuriken_db::model::dav::instance::DavInstance>> {
    use diesel_async::RunQueryDsl;
    use shuriken_db::db::query::dav::instance;

    instance::by_collection_not_deleted(collection_id)
        .load::<shuriken_db::model::dav::instance::DavInstance>(conn)
        .await
        .map_err(Into::into)
}

/// ## Summary
/// Resolves CalDAV-specific properties.
fn resolve_caldav_property(
    qname: QName,
    collection: Option<&shuriken_db::model::dav::collection::DavCollection>,
    found: &mut Vec<DavProperty>,
    not_found: &mut Vec<DavProperty>,
) {
    match qname.local_name() {
        "supported-calendar-component-set" => {
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
        "supported-collation-set" => {
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
        "max-resource-size" => {
            // RFC 4791 §5.2.5: Maximum resource size for calendar collections
            if let Some(coll) = collection {
                if matches!(coll.collection_type.as_str(), "calendar") {
                    found.push(DavProperty::xml(qname, discovery::max_resource_size()));
                } else {
                    not_found.push(DavProperty::empty(qname));
                }
            } else {
                not_found.push(DavProperty::empty(qname));
            }
        }
        "min-date-time" => {
            // RFC 4791 §5.2.6: Minimum supported date/time for calendar collections
            if let Some(coll) = collection {
                if matches!(coll.collection_type.as_str(), "calendar") {
                    found.push(DavProperty::xml(qname, discovery::min_date_time()));
                } else {
                    not_found.push(DavProperty::empty(qname));
                }
            } else {
                not_found.push(DavProperty::empty(qname));
            }
        }
        "max-date-time" => {
            // RFC 4791 §5.2.7: Maximum supported date/time for calendar collections
            if let Some(coll) = collection {
                if matches!(coll.collection_type.as_str(), "calendar") {
                    found.push(DavProperty::xml(qname, discovery::max_date_time()));
                } else {
                    not_found.push(DavProperty::empty(qname));
                }
            } else {
                not_found.push(DavProperty::empty(qname));
            }
        }
        _ => {
            not_found.push(DavProperty::empty(qname));
        }
    }
}

/// ## Summary
/// Resolves CardDAV-specific properties.
fn resolve_carddav_property(
    qname: QName,
    collection: Option<&shuriken_db::model::dav::collection::DavCollection>,
    found: &mut Vec<DavProperty>,
    not_found: &mut Vec<DavProperty>,
) {
    match qname.local_name() {
        "supported-address-data" => {
            // RFC 6352 §6.2.2: Supported vCard versions for addressbook collections
            if let Some(coll) = collection {
                if matches!(coll.collection_type.as_str(), "addressbook") {
                    found.push(DavProperty::xml(qname, discovery::supported_address_data()));
                } else {
                    not_found.push(DavProperty::empty(qname));
                }
            } else {
                not_found.push(DavProperty::empty(qname));
            }
        }
        "max-resource-size" => {
            // RFC 6352 §6.2.3: Maximum resource size for addressbook collections
            if let Some(coll) = collection {
                if matches!(coll.collection_type.as_str(), "addressbook") {
                    found.push(DavProperty::xml(
                        qname,
                        discovery::carddav_max_resource_size(),
                    ));
                } else {
                    not_found.push(DavProperty::empty(qname));
                }
            } else {
                not_found.push(DavProperty::empty(qname));
            }
        }
        _ => {
            not_found.push(DavProperty::empty(qname));
        }
    }
}

/// Context for property resolution.
struct PropertyResolutionContext<'a> {
    display_name: &'a str,
    collection_qname: &'a QName,
    collection: Option<&'a shuriken_db::model::dav::collection::DavCollection>,
    resource_path: &'a str,
    resource_location: Option<&'a ResourceLocation>,
    enforcer: Option<Arc<dyn std::any::Any + Send + Sync>>, // Opaque enforcer type
    authorizer: Option<&'a Authorizer>,
    subjects: Option<&'a ExpandedSubjects>,
    found: &'a mut Vec<DavProperty>,
    not_found: &'a mut Vec<DavProperty>,
}

/// ## Summary
/// Resolves a single property based on its namespace and name.
#[expect(clippy::too_many_lines)]
async fn resolve_single_property(qname: QName, ctx: &mut PropertyResolutionContext<'_>) {
    match (qname.namespace_uri(), qname.local_name()) {
        ("DAV:", "displayname") => {
            ctx.found.push(DavProperty::text(qname, ctx.display_name));
        }
        ("DAV:", "resourcetype") => {
            ctx.found.push(DavProperty {
                name: qname,
                value: Some(PropertyValue::ResourceType(vec![
                    QName::dav("collection"),
                    ctx.collection_qname.clone(),
                ])),
            });
        }
        ("DAV:", "acl") => {
            // RFC 3744 §5.5: DAV:acl property - current access control entries
            if let Some(enforcer) = &ctx.enforcer {
                // Downcast the Any to the concrete Enforcer type
                // This is safe because we know get_enforcer_from_depot returns Arc<casbin::Enforcer>
                let enforcer_any = enforcer.clone();
                match serialize_acl_for_resource(ctx.resource_path, enforcer_any).await {
                    Ok(acl_xml) => {
                        ctx.found.push(DavProperty::xml(qname, acl_xml));
                    }
                    Err(err) => {
                        tracing::warn!(
                            resource_path = ctx.resource_path,
                            error = %err,
                            "Failed to serialize ACL for resource"
                        );
                        ctx.not_found.push(DavProperty::empty(qname));
                    }
                }
            } else {
                // Enforcer not available - cannot determine ACL
                ctx.not_found.push(DavProperty::empty(qname));
            }
        }
        ("DAV:", "current-user-privilege-set") => {
            // RFC 3744 §5.4: DAV:current-user-privilege-set - effective privileges for current user
            if let (Some(authorizer), Some(subjects), Some(resource)) =
                (ctx.authorizer, ctx.subjects, ctx.resource_location)
            {
                // Determine the highest permission level the user has by checking actions
                // Check from highest to lowest: admin, edit, read, read_freebusy
                let permission_level = if authorizer
                    .check(subjects, resource, Action::Admin)
                    .is_ok_and(|r| r.is_allowed())
                {
                    Some(PermissionLevel::Admin)
                } else if authorizer
                    .check(subjects, resource, Action::Edit)
                    .is_ok_and(|r| r.is_allowed())
                {
                    Some(PermissionLevel::Edit)
                } else if authorizer
                    .check(subjects, resource, Action::Read)
                    .is_ok_and(|r| r.is_allowed())
                {
                    Some(PermissionLevel::Read)
                } else if authorizer
                    .check(subjects, resource, Action::ReadFreebusy)
                    .is_ok_and(|r| r.is_allowed())
                {
                    Some(PermissionLevel::ReadFreebusy)
                } else {
                    None
                };

                if let Some(level) = permission_level {
                    let builder = PrivilegeSetBuilder::for_level(level);
                    ctx.found.push(DavProperty::xml(qname, builder.to_xml()));
                } else {
                    // User has no privileges - return empty privilege set
                    ctx.found.push(DavProperty::xml(
                        qname,
                        "<D:current-user-privilege-set xmlns:D=\"DAV:\"/>".to_string(),
                    ));
                }
            } else {
                // Missing authorization context - cannot determine privileges
                ctx.not_found.push(DavProperty::empty(qname));
            }
        }
        ("DAV:", "supported-report-set") => {
            // RFC 3253 via RFC 4791/RFC 6352: Return supported REPORT methods
            if let Some(coll) = ctx.collection {
                ctx.found.push(DavProperty::xml(
                    qname,
                    discovery::supported_report_set(coll.collection_type.into()),
                ));
            } else {
                ctx.not_found.push(DavProperty::empty(qname));
            }
        }
        ("DAV:", "getetag") => {
            if let Some(coll) = ctx.collection {
                ctx.found
                    .push(DavProperty::text(qname, format!("\"{}\"", coll.synctoken)));
            } else {
                ctx.not_found.push(DavProperty::empty(qname));
            }
        }
        ("urn:ietf:params:xml:ns:caldav", _) => {
            resolve_caldav_property(qname, ctx.collection, ctx.found, ctx.not_found);
        }
        ("urn:ietf:params:xml:ns:carddav", _) => {
            resolve_carddav_property(qname, ctx.collection, ctx.found, ctx.not_found);
        }
        _ => {
            // Unknown property - return as not found
            ctx.not_found.push(DavProperty::empty(qname));
        }
    }
}

/// ## Summary
/// Builds a multistatus response for a PROPFIND request.
///
/// Queries the database for the target resource and its children (based on depth),
/// retrieves the requested properties, and constructs the response.
///
/// ## Errors
/// Returns errors for database failures or property resolution issues.
#[expect(clippy::too_many_lines)]
pub(super) async fn build_propfind_response(
    conn: &mut shuriken_db::db::connection::DbConnection<'_>,
    req: &Request,
    depot: &Depot,
    depth: Depth,
    propfind_req: &shuriken_rfc::rfc::dav::core::PropfindRequest,
) -> anyhow::Result<Multistatus> {
    let path = req.uri().path();

    // Try to get collection from depot (populated by DavPathMiddleware)
    let collection = get_terminal_collection_from_depot(depot).ok();

    let mut multistatus = Multistatus::new();

    // Build a response for the requested resource
    let href = Href::new(path);

    // Get enforcer from depot (may be None if middleware didn't inject it)
    // Wrap in Arc<dyn Any> to avoid direct casbin dependency
    let enforcer = get_enforcer_from_depot(depot)
        .ok()
        .map(|e| e as Arc<dyn std::any::Any + Send + Sync>);

    // Get the resolved resource location for ACL lookups (uses internal path format)
    let resource_location = get_resolved_location_from_depot(depot).ok();
    let resource_path = resource_location
        .as_ref()
        .and_then(|loc| loc.serialize_to_path(false, false).ok());

    // Get authorizer and subjects for privilege checking (may be None)
    let authorizer = authorizer_from_depot(depot).ok();
    let subjects = if authorizer.is_some() {
        get_subjects_from_depot(depot, conn).await.ok()
    } else {
        None
    };

    let (found_properties, not_found_properties) = get_properties_for_resource(
        conn,
        path,
        collection,
        enforcer.clone(),
        resource_path.as_deref(),
        authorizer.as_ref(),
        subjects.as_ref(),
        resource_location.as_ref().map(|r| &**r),
        propfind_req,
    )
    .await?;

    let response = if not_found_properties.is_empty() {
        PropstatResponse::ok(href, found_properties)
    } else {
        PropstatResponse::with_found_and_not_found(href, found_properties, not_found_properties)
    };
    multistatus.add_response(response);

    // If depth is 1, add child resources
    if matches!(depth, Depth::One)
        && let Some(coll) = collection
    {
        // Query for child instances in the collection
        let instances = load_child_instances(conn, coll.id).await?;

        // Get the resolved location (UUID-based) from depot for building child paths
        let resolved_location = get_resolved_location_from_depot(depot);

        // Build a response for each child instance
        for inst in instances {
            // Determine file extension from collection type
            let extension = match coll.collection_type.as_str() {
                "calendar" => ".ics",
                "addressbook" => ".vcf",
                _ => "", // Plain collections have no extension
            };

            // Build child path using ResourceLocation with instance UUID
            let child_path = if let Ok(resolved) = resolved_location {
                // Append PathSegment::Item with instance UUID (ResourceLocation will add extension in serialization)
                let mut child_segments = resolved.segments().to_vec();
                child_segments.push(PathSegment::Item(ResourceIdentifier::Id(inst.id)));
                match ResourceLocation::from_segments(child_segments)
                    .and_then(|loc| loc.serialize_to_full_path(true, false))
                {
                    Ok(path) => path,
                    Err(e) => {
                        tracing::warn!("Failed to serialize child location for PROPFIND: {}", e);
                        // Fallback: construct path manually only if ResourceLocation fails
                        format!("{}/{}{}", path.trim_end_matches('/'), inst.id, extension)
                    }
                }
            } else {
                tracing::warn!("resolved_location not available in depot for PROPFIND child");
                // Fallback: use request path with instance UUID if resolved location not available
                format!("{}/{}{}", path.trim_end_matches('/'), inst.id, extension)
            };

            let child_href = Href::new(&child_path);

            // For child resources, build properties from the instance
            let (child_found, child_not_found) = get_properties_for_instance(
                conn,
                &inst,
                collection,
                enforcer.clone(),
                propfind_req,
            )
            .await?;

            let child_response = if child_not_found.is_empty() {
                PropstatResponse::ok(child_href, child_found)
            } else {
                PropstatResponse::with_found_and_not_found(child_href, child_found, child_not_found)
            };

            multistatus.add_response(child_response);
        }
    }

    Ok(multistatus)
}

/// ## Summary
/// Retrieves properties for a resource based on the PROPFIND request.
///
/// Returns a tuple of (`found_properties`, `not_found_properties`).
///
/// ## Errors
/// Returns errors if property resolution fails.
#[expect(clippy::too_many_lines)]
async fn get_properties_for_resource(
    _conn: &mut shuriken_db::db::connection::DbConnection<'_>,
    path: &str,
    collection: Option<&shuriken_db::model::dav::collection::DavCollection>,
    enforcer: Option<Arc<dyn std::any::Any + Send + Sync>>,
    resource_path: Option<&str>,
    authorizer: Option<&Authorizer>,
    subjects: Option<&ExpandedSubjects>,
    resource_location: Option<&ResourceLocation>,
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
        Some("addressbook") => QName::carddav("addressbook"),
        _ => QName::caldav("calendar"), // Default for calendar or unknown
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

                // CALDAV:max-resource-size - RFC 4791 §5.2.5
                found.push(DavProperty::xml(
                    QName::caldav("max-resource-size"),
                    discovery::max_resource_size(),
                ));

                // CALDAV:min-date-time - RFC 4791 §5.2.6
                found.push(DavProperty::xml(
                    QName::caldav("min-date-time"),
                    discovery::min_date_time(),
                ));

                // CALDAV:max-date-time - RFC 4791 §5.2.7
                found.push(DavProperty::xml(
                    QName::caldav("max-date-time"),
                    discovery::max_date_time(),
                ));
            }

            // CardDAV-specific properties
            if matches!(coll.collection_type.as_str(), "addressbook") {
                // CARDDAV:supported-address-data - RFC 6352 §6.2.2
                found.push(DavProperty::xml(
                    QName::carddav("supported-address-data"),
                    discovery::supported_address_data(),
                ));

                // CARDDAV:max-resource-size - RFC 6352 §6.2.3
                found.push(DavProperty::xml(
                    QName::carddav("max-resource-size"),
                    discovery::carddav_max_resource_size(),
                ));
            }

            // Add getetag
            found.push(DavProperty::text(
                QName::dav("getetag"),
                format!("\"{}\"", coll.synctoken),
            ));
        }
    } else if propfind_req.is_propname() {
        // Return property names only (empty values)
        found.push(DavProperty::empty(QName::dav("displayname")));
        found.push(DavProperty::empty(QName::dav("resourcetype")));
    } else if let Some(requested_props) = propfind_req.requested_properties() {
        // Return only requested properties
        let mut ctx = PropertyResolutionContext {
            display_name,
            collection_qname: &collection_qname,
            collection,
            resource_path: resource_path.unwrap_or(path), // Use resolved path if available, fallback to HTTP path
            resource_location,
            enforcer,
            authorizer,
            subjects,
            found: &mut found,
            not_found: &mut not_found,
        };
        for prop_name in requested_props {
            let qname = prop_name.qname().clone();
            resolve_single_property(qname, &mut ctx).await;
        }
    } else {
        // Invalid request type
        tracing::warn!(
            req = ?propfind_req,
            "Invalid PROPFIND request type for resource"
        );
    }

    Ok((found, not_found))
}

/// ## Summary
/// Retrieves properties for a child instance resource.
///
/// Returns a tuple of (`found_properties`, `not_found_properties`).
///
/// ## Errors
/// Returns errors if property resolution fails.
#[expect(
    clippy::unused_async,
    reason = "async signature needed for future DB queries"
)]
async fn get_properties_for_instance(
    _conn: &mut shuriken_db::db::connection::DbConnection<'_>,
    instance: &shuriken_db::model::dav::instance::DavInstance,
    _collection: Option<&shuriken_db::model::dav::collection::DavCollection>,
    _enforcer: Option<Arc<dyn std::any::Any + Send + Sync>>,
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
    } else {
        // Invalid request type
        tracing::warn!(
            req = ?propfind_req,
            "Invalid PROPFIND request type for instance"
        );
    }

    Ok((found, not_found))
}
