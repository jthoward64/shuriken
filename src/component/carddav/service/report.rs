//! CardDAV REPORT service layer.

//! Business logic for addressbook-query and addressbook-multiget reports.

use crate::component::db::connection::DbConnection;
use crate::component::db::query::carddav::filter::find_matching_instances;
use crate::component::db::query::report_property::build_instance_properties;
use crate::component::rfc::dav::core::{
    AddressbookMultiget, AddressbookQuery, Href, Multistatus, PropertyName, PropstatResponse,
};

/// ## Summary
/// Executes an addressbook-query report.
///
/// Applies filters to find matching vCard objects and builds a multistatus response.
///
/// ## Side Effects
/// Queries the database for matching instances.
///
/// ## Errors
/// Returns database errors or filter evaluation errors.
pub async fn execute_addressbook_query(
    conn: &mut DbConnection<'_>,
    collection_id: uuid::Uuid,
    query: &AddressbookQuery,
    properties: &[PropertyName],
) -> anyhow::Result<Multistatus> {
    // Find instances matching the filter
    let instances = find_matching_instances(conn, collection_id, query).await?;

    // Build multistatus response
    let mut multistatus = Multistatus::new();
    for instance in instances {
        let href = Href::new(format!("/item-{}", instance.slug));
        let props = build_instance_properties(conn, &instance, properties).await?;
        let response = PropstatResponse::ok(href, props);
        multistatus.add_response(response);
    }

    Ok(multistatus)
}

/// ## Summary
/// Executes an addressbook-multiget report.
///
/// RFC 6352 Section 8.7: Retrieves vCard resources by full DAV:href path.
/// Each href is a complete resource path (e.g., `/addressbooks/alice/contacts/john.vcf`)
/// that is resolved to a specific instance and returned with requested properties.
///
/// ## Side Effects
/// Queries the database for each requested resource path resolution and data retrieval.
///
/// ## Errors
/// Returns database errors if queries fail. Missing resources return 404 in response.
pub async fn execute_addressbook_multiget(
    conn: &mut DbConnection<'_>,
    _collection_id: uuid::Uuid,
    multiget: &AddressbookMultiget,
    properties: &[PropertyName],
) -> anyhow::Result<Multistatus> {
    use crate::component::error::PathResolutionError;
    use crate::component::middleware::path_parser::parse_and_resolve_path;

    let mut multistatus = Multistatus::new();

    // Process each DAV:href in the multiget request
    for href in &multiget.hrefs {
        let href_str = href.as_str();

        // Parse and resolve the full DAV:href path to get the vCard instance
        match parse_and_resolve_path(href_str, conn).await {
            Ok(resolution) => {
                if let Some(inst) = resolution.instance {
                    // Successfully resolved to an instance - build response
                    let props = build_instance_properties(conn, &inst, properties).await?;
                    let response = PropstatResponse::ok(href.clone(), props);
                    multistatus.add_response(response);
                } else {
                    // Path was valid but resolved to no instance (404)
                    let response = PropstatResponse::not_found(href.clone());
                    multistatus.add_response(response);
                }
            }
            Err(PathResolutionError::PrincipalNotFound(_))
            | Err(PathResolutionError::CollectionNotFound { .. })
            | Err(PathResolutionError::InvalidPathFormat(_)) => {
                // Resource not found (404)
                let response = PropstatResponse::not_found(href.clone());
                multistatus.add_response(response);
            }
            Err(e) => {
                // Propagate unexpected errors (DB errors, etc.)
                return Err(anyhow::anyhow!("Path resolution error: {}", e));
            }
        }
    }

    Ok(multistatus)
}
