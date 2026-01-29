//! Helper functions for GET and HEAD request processing.

use salvo::http::{HeaderValue, StatusCode};
use salvo::{Depot, Request, Response};

use shuriken_service::auth::get_resolved_location_from_depot;
use shuriken_service::auth::{
    Action, ResourceType, authorizer_from_depot, get_instance_from_depot, get_subjects_from_depot,
    get_terminal_collection_from_depot,
};
use shuriken_db::db::map::dav::{serialize_ical_tree, serialize_vcard_tree};
use shuriken_db::db::query::dav::{entity, instance};
use shuriken_db::model::dav::instance::DavInstance;

/// ## Summary
/// Shared implementation for GET and HEAD handlers.
///
/// Parses the request path to extract collection ID and resource URI,
/// loads the resource from the database, and returns appropriate response.
///
/// ## Parameters
/// - `is_head`: If true, response body is omitted (HEAD request); if false, includes body (GET request)
///
/// ## Side Effects
/// - Sets HTTP status code and headers on response
/// - For GET requests, writes response body
pub(super) async fn handle_get_or_head(
    req: &mut Request,
    res: &mut Response,
    is_head: bool,
    depot: &Depot,
) {
    // Extract the resource path from the request
    let request_path = req.uri().path();

    // Prefer middleware-resolved values from depot
    let (collection_id, slug) = match (
        get_terminal_collection_from_depot(depot),
        get_instance_from_depot(depot),
    ) {
        (Ok(coll), Ok(inst)) => (coll.id, inst.slug.clone()),
        (Ok(coll), Err(_)) => {
            // No instance slug; GET/HEAD requires an instance target
            tracing::debug!(collection_id = %coll.id, "Instance slug missing in depot for GET/HEAD");
            res.status_code(StatusCode::NOT_FOUND);
            return;
        }
        _ => {
            tracing::debug!(path = %request_path, "Failed to parse path");
            res.status_code(StatusCode::NOT_FOUND);
            return;
        }
    };

    if collection_id.is_nil() {
        res.status_code(StatusCode::NOT_FOUND);
        return;
    }

    tracing::debug!(
        collection_id = %collection_id,
        slug = %slug,
        "Parsed request path"
    );

    // If middleware already loaded instance, reuse it but STILL check authorization
    let maybe_inst = get_instance_from_depot(depot).ok().cloned();
    let (instance, canonical_bytes) = if let Some(inst) = maybe_inst {
        // Authorization check: require read access even when using depot-cached instance
        let provider = match crate::db_handler::get_db_from_depot(depot) {
            Ok(p) => p,
            Err(e) => {
                tracing::error!(error = %e, "Failed to get database provider");
                res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
                return;
            }
        };
        let mut conn = match provider.get_connection().await {
            Ok(c) => c,
            Err(e) => {
                tracing::error!(error = %e, "Failed to get database connection");
                res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
                return;
            }
        };
        if let Err(e) = check_read_authorization(depot, &mut conn, &inst).await {
            tracing::debug!(error = %e, instance_id = %inst.id, "Authorization denied");
            res.status_code(StatusCode::FORBIDDEN);
            return;
        }

        match load_entity_bytes_for_instance(&mut conn, &inst).await {
            Ok(Some(bytes)) => (inst, bytes),
            Ok(None) => {
                tracing::debug!("Entity tree missing for instance");
                res.status_code(StatusCode::NOT_FOUND);
                return;
            }
            Err(e) => {
                tracing::error!(error = %e, "Database error");
                res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
                return;
            }
        }
    } else {
        let Some((instance, canonical_bytes)) =
            get_collection_instance(res, depot, collection_id, slug).await
        else {
            return;
        };
        (instance, canonical_bytes)
    };

    // Check If-Match for conditional GET/HEAD
    // If-Match must be checked before If-None-Match (RFC 7232)
    if !check_if_match(req, &instance.etag) {
        res.status_code(StatusCode::PRECONDITION_FAILED);
        return;
    }

    // Check If-None-Match for conditional GET/HEAD
    // Both GET and HEAD should support conditional requests and return 304 Not Modified
    if check_if_none_match(req, &instance.etag) {
        res.status_code(StatusCode::NOT_MODIFIED);
        return;
    }

    // Set response headers and body
    set_response_headers_and_body(res, &instance, &canonical_bytes, is_head);
}
async fn load_entity_bytes_for_instance(
    conn: &mut shuriken_db::db::connection::DbConnection<'_>,
    inst: &DavInstance,
) -> anyhow::Result<Option<Vec<u8>>> {
    use shuriken_db::db::query::dav::entity;

    let Some((_, tree)) = entity::get_entity_with_tree(conn, inst.entity_id).await? else {
        return Ok(None);
    };

    let canonical_text = if inst.content_type.starts_with("text/calendar") {
        serialize_ical_tree(tree)?
    } else if inst.content_type.starts_with("text/vcard") {
        serialize_vcard_tree(&tree)?
    } else {
        anyhow::bail!("unsupported content type: {}", inst.content_type);
    };

    Ok(Some(canonical_text.into_bytes()))
}

async fn get_collection_instance(
    res: &mut Response,
    depot: &Depot,
    collection_id: uuid::Uuid,
    slug: String,
) -> Option<(DavInstance, Vec<u8>)> {
    let provider = match crate::db_handler::get_db_from_depot(depot) {
        Ok(provider) => provider,
        Err(e) => {
            tracing::error!(error = %e, "Failed to get database provider");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return None;
        }
    };
    let mut conn = match provider.get_connection().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::error!(error = %e, "Failed to get database connection");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return None;
        }
    };

    // Load the instance first to determine its type
    let (instance, canonical_bytes) = match load_instance(&mut conn, collection_id, &slug).await {
        Ok(Some(data)) => data,
        Ok(None) => {
            tracing::debug!(
                collection_id = %collection_id,
                slug = %slug,
                "Resource not found"
            );
            res.status_code(StatusCode::NOT_FOUND);
            return None;
        }
        Err(e) => {
            tracing::error!(error = %e, "Database error");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return None;
        }
    };

    // Authorization check: require read access on the instance
    if let Err(e) = check_read_authorization(depot, &mut conn, &instance).await {
        tracing::debug!(error = %e, instance_id = %instance.id, "Authorization denied");
        res.status_code(StatusCode::FORBIDDEN);
        return None;
    }

    Some((instance, canonical_bytes))
}

/// Check read authorization for a DAV instance.
///
/// Determines the resource type from content-type and checks if the user
/// has read permission on the instance (or its parent collection).
async fn check_read_authorization(
    depot: &salvo::Depot,
    conn: &mut shuriken_db::db::connection::DbConnection<'_>,
    instance: &DavInstance,
) -> Result<(), crate::error::AppError> {
    // Get expanded subjects (user + groups + public)
    let subjects = get_subjects_from_depot(depot, conn).await?;

    // Determine resource type from content-type
    let resource_type = if instance.content_type.starts_with("text/calendar") {
        ResourceType::Calendar
    } else if instance.content_type.starts_with("text/vcard") {
        ResourceType::Addressbook
    } else {
        // Unknown content type - treat as calendar (safer default)
        tracing::warn!(
            content_type = %instance.content_type,
            "Unknown content type, defaulting to Calendar for authorization"
        );
        ResourceType::Calendar
    };

    // Use resolved ResourceLocation from depot if available, otherwise build from instance
    let resource = match get_resolved_location_from_depot(depot) {
        Ok(loc) => loc.clone(),
        Err(_) => {
            // Fallback: Build resource location from instance data
            use shuriken_service::auth::{PathSegment, ResourceLocation};
            let segments = vec![
                PathSegment::ResourceType(resource_type),
                PathSegment::Collection(instance.collection_id.to_string()),
                PathSegment::Item(instance.slug.clone()),
            ];
            ResourceLocation::from_segments(segments)
        }
    };

    // Check authorization
    let authorizer = authorizer_from_depot(depot)?;
    authorizer.require(&subjects, &resource, Action::Read)?;

    Ok(())
}

/// ## Summary
/// Loads a `DAV` instance and its content from the database.
///
/// ## Errors
/// Returns database errors if the query fails.
async fn load_instance(
    conn: &mut shuriken_db::db::connection::DbConnection<'_>,
    collection_id: uuid::Uuid,
    slug: &str,
) -> anyhow::Result<Option<(DavInstance, Vec<u8>)>> {
    use diesel::prelude::*;
    use diesel_async::RunQueryDsl;

    // Load the instance
    let inst = instance::by_slug_and_collection(collection_id, slug)
        .select(shuriken_db::model::dav::instance::DavInstance::as_select())
        .first::<DavInstance>(conn)
        .await
        .optional()?;

    let Some(inst) = inst else {
        return Ok(None);
    };

    let Some((_, tree)) = entity::get_entity_with_tree(conn, inst.entity_id).await? else {
        return Ok(None);
    };

    let canonical_text = if inst.content_type.starts_with("text/calendar") {
        serialize_ical_tree(tree)?
    } else if inst.content_type.starts_with("text/vcard") {
        serialize_vcard_tree(&tree)?
    } else {
        anyhow::bail!("unsupported content type: {}", inst.content_type);
    };

    let canonical_bytes = canonical_text.into_bytes();

    Ok(Some((inst, canonical_bytes)))
}

/// ## Summary
/// Sets response headers and body for a successful GET/HEAD request.
///
/// ## Side Effects
/// Sets `ETag`, `Last-Modified`, `Content-Type` headers and response body (for GET).
fn set_response_headers_and_body(
    res: &mut Response,
    instance: &DavInstance,
    canonical_bytes: &[u8],
    is_head: bool,
) {
    // Set ETag header
    if let Ok(etag_value) = HeaderValue::from_str(&instance.etag) {
        #[expect(
            clippy::let_underscore_must_use,
            reason = "Header addition failure is non-fatal"
        )]
        let _ = res.add_header("ETag", etag_value, true);
    }

    // Set Last-Modified header
    let last_modified = instance
        .last_modified
        .format("%a, %d %b %Y %H:%M:%S GMT")
        .to_string();
    if let Ok(lm_value) = HeaderValue::from_str(&last_modified) {
        #[expect(
            clippy::let_underscore_must_use,
            reason = "Header addition failure is non-fatal"
        )]
        let _ = res.add_header("Last-Modified", lm_value, true);
    }

    // Set Content-Type header
    if let Ok(ct_value) = HeaderValue::from_str(instance.content_type.as_str()) {
        #[expect(
            clippy::let_underscore_must_use,
            reason = "Header addition failure is non-fatal"
        )]
        let _ = res.add_header("Content-Type", ct_value, true);
    }

    res.status_code(StatusCode::OK);

    // Set body only for GET (not HEAD)
    if !is_head && let Err(e) = res.write_body(canonical_bytes.to_vec()) {
        tracing::error!("Failed to write response body: {}", e);
    }
}

/// ## Summary
/// Checks `If-Match` header for conditional GET.
///
/// Returns true if the request should proceed (ETag matches or no If-Match header).
/// Returns false if the request should fail with 412 Precondition Failed.
#[must_use]
fn check_if_match(req: &Request, instance_etag: &str) -> bool {
    if let Some(if_match) = req.headers().get("If-Match")
        && let Ok(value) = if_match.to_str()
    {
        // Check if any of the ETags match (or "*" which matches any)
        return value
            .split(',')
            .map(str::trim)
            .any(|etag| etag == instance_etag || etag == "*");
    }
    // No If-Match header means proceed
    true
}

/// ## Summary
/// Checks `If-None-Match` header for conditional GET.
///
/// Returns true if the request should be served with 304 Not Modified.
#[must_use]
fn check_if_none_match(req: &Request, instance_etag: &str) -> bool {
    if let Some(if_none_match) = req.headers().get("If-None-Match")
        && let Ok(value) = if_none_match.to_str()
    {
        // Check if any of the ETags match
        return value
            .split(',')
            .map(str::trim)
            .any(|etag| etag == instance_etag || etag == "*");
    }
    false
}
