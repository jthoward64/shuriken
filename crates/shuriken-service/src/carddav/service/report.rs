//! CardDAV REPORT service layer.

//! Business logic for addressbook-query and addressbook-multiget reports.

use shuriken_db::db::connection::DbConnection;
use shuriken_db::db::query::carddav::filter::find_matching_instances;
use shuriken_db::db::query::report_property::build_instance_properties;
use shuriken_rfc::rfc::dav::core::{
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
    collection_id: uuid::Uuid,
    multiget: &AddressbookMultiget,
    properties: &[PropertyName],
) -> anyhow::Result<Multistatus> {
    use diesel_async::RunQueryDsl;
    use shuriken_db::db::query::dav::instance;

    let mut multistatus = Multistatus::new();

    // Process each DAV:href in the multiget request
    for href in &multiget.hrefs {
        let href_str = href.as_str();

        // Extract slug from href by taking the last path segment and stripping extensions
        let slug = href_str
            .trim_end_matches(".ics")
            .trim_end_matches(".vcf")
            .split('/')
            .next_back()
            .unwrap_or("")
            .to_string();

        if slug.is_empty() {
            // Invalid href format - return 404
            let response = PropstatResponse::not_found(href.clone());
            multistatus.add_response(response);
            continue;
        }

        // Query for the instance by slug and collection
        let result = instance::by_slug_and_collection(collection_id, &slug)
            .first::<shuriken_db::model::dav::instance::DavInstance>(conn)
            .await;

        match result {
            Ok(inst) => {
                // Successfully resolved to an instance - build response
                let props = build_instance_properties(conn, &inst, properties).await?;
                let response = PropstatResponse::ok(href.clone(), props);
                multistatus.add_response(response);
            }
            Err(diesel::result::Error::NotFound) => {
                // Instance not found (404)
                let response = PropstatResponse::not_found(href.clone());
                multistatus.add_response(response);
            }
            Err(e) => {
                // Propagate unexpected errors (DB errors, etc.)
                return Err(anyhow::anyhow!("Database error: {e}"));
            }
        }
    }

    Ok(multistatus)
}
