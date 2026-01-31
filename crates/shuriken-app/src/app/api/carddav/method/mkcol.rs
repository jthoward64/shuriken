//! MKCOL method handler for Extended MKCOL (RFC 5689) for `CardDAV`.

#![allow(clippy::manual_let_else)]
#![allow(clippy::single_match_else)]

use salvo::http::StatusCode;
use salvo::{Depot, Request, Response, handler};

use crate::app::api::dav::extract::auth::get_auth_context;
use shuriken_rfc::rfc::dav::parse::{MkcolRequest, parse_mkcol};
use shuriken_service::auth::{Action, get_resolved_location_from_depot};
use shuriken_service::dav::service::collection::{CreateCollectionContext, create_collection};

/// ## Summary
/// Handles Extended MKCOL requests to create addressbook collections.
///
/// Parses the Extended MKCOL XML request body (RFC 5689) with resourcetype and properties,
/// creates an addressbook collection in the database, and sets the resourcetype.
///
/// ## Side Effects
/// - Creates addressbook collection in database
/// - Sets DAV:resourcetype to include DAV:collection and CARDDAV:addressbook
/// - Applies initial properties (displayname, addressbook-description, etc.)
/// - Returns 201 Created
///
/// ## Errors
/// Returns 400 for invalid XML, 403 for authorization failures, 409 if exists, 500 for errors.
#[handler]
pub async fn mkcol_extended(req: &mut Request, res: &mut Response, depot: &Depot) {
    // Get path to determine where to create the addressbook
    let path = req.uri().path().to_string();

    // Get database connection
    let provider = match crate::db_handler::get_db_from_depot(depot) {
        Ok(provider) => provider,
        Err(e) => {
            tracing::error!(error = %e, "Failed to get database provider");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    let mut conn = match provider.get_connection().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::error!(error = %e, "Failed to get database connection");
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    // Check authorization: user must have Edit (write) permission on parent collection
    let (subjects, authorizer) = match get_auth_context(depot, &mut conn).await {
        Ok(ctx) => ctx,
        Err(status) => {
            res.status_code(status);
            return;
        }
    };

    // Get the resolved resource location from depot (populated by DavPathMiddleware)
    let parent_resource = match get_resolved_location_from_depot(depot) {
        Ok(loc) => loc,
        Err(_) => {
            // If DavPathMiddleware didn't resolve, we can't authorize
            tracing::warn!(path = %path, "Resource location not found in depot");
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };

    if let Err(e) = authorizer.require(&subjects, parent_resource, Action::Edit) {
        tracing::debug!(error = %e, "Authorization denied for MKCOL");
        res.status_code(StatusCode::FORBIDDEN);
        return;
    }

    // Parse Extended MKCOL XML body (RFC 5689)
    let body = req.payload().await;
    let parsed_request = match body {
        Ok(bytes) if !bytes.is_empty() => match parse_mkcol(bytes) {
            Ok(request) => request,
            Err(e) => {
                tracing::error!("Failed to parse Extended MKCOL body: {}", e);
                res.status_code(StatusCode::BAD_REQUEST);
                return;
            }
        },
        Ok(_) => {
            // Empty body - no initial properties
            MkcolRequest::default()
        }
        Err(e) => {
            tracing::error!("Failed to read request body: {}", e);
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    // Extract URI from path (last segment)
    let uri = path
        .split('/')
        .next_back()
        .unwrap_or("addressbook")
        .to_string();

    // Get owner principal ID from authenticated subjects
    let owner_principal_id = match extract_owner_principal_id(&subjects) {
        Ok(id) => id,
        Err(e) => {
            tracing::error!(error = %e, "Failed to extract owner principal ID");
            res.status_code(StatusCode::BAD_REQUEST);
            return;
        }
    };

    // Create collection context
    let ctx = CreateCollectionContext {
        owner_principal_id,
        slug: uri,
        collection_type: shuriken_db::db::enums::CollectionType::Addressbook,
        displayname: parsed_request.displayname,
        description: parsed_request.description,
    };

    // Create the addressbook collection
    match create_collection(&mut conn, &ctx).await {
        Ok(result) => {
            tracing::info!(
                "Created addressbook collection: {} (ID: {})",
                result.slug,
                result.collection_id
            );
            res.status_code(StatusCode::CREATED);

            // Set Location header with full URL (RFC 4918 §8.10.4)
            // Build Location header using ResourceLocation for type safety
            let mut segments = parent_resource.segments().to_vec();
            segments.push(shuriken_service::auth::PathSegment::Collection(
                shuriken_service::auth::ResourceIdentifier::Id(result.collection_id),
            ));

            let location_url = if let Ok(resource) =
                shuriken_service::auth::ResourceLocation::from_segments(segments)
            {
                // Try to build a full URL using the resource location
                let scheme = if req.uri().scheme_str() == Some("https") {
                    "https"
                } else {
                    "http"
                };
                let host = req
                    .headers()
                    .get("Host")
                    .and_then(|h| h.to_str().ok())
                    .unwrap_or("localhost");

                match resource.serialize_to_full_path(false, false) {
                    Ok(path) => format!("{scheme}://{host}{path}"),
                    Err(e) => {
                        tracing::warn!("Failed to serialize collection resource location: {}", e);
                        // Fallback to request path
                        format!("{scheme}://{host}{path}")
                    }
                }
            } else {
                // Fallback to scheme + host + request path
                let scheme = if req.uri().scheme_str() == Some("https") {
                    "https"
                } else {
                    "http"
                };
                let host = req
                    .headers()
                    .get("Host")
                    .and_then(|h| h.to_str().ok())
                    .unwrap_or("localhost");
                format!("{scheme}://{host}{path}")
            };

            #[expect(
                clippy::let_underscore_must_use,
                reason = "Location header addition failure is non-fatal"
            )]
            let _ = res.add_header("Location", location_url, true);
        }
        Err(e) => {
            tracing::error!("Failed to create addressbook collection: {}", e);
            // Check if it's a conflict (already exists)
            if e.to_string().contains("duplicate") || e.to_string().contains("exists") {
                res.status_code(StatusCode::CONFLICT);
            } else {
                res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            }
        }
    }
}

/// Extract resource type from path.
#[expect(dead_code, reason = "May be used for future path-based routing")]
fn extract_resource_type_from_path(path: &str) -> Option<shuriken_service::auth::ResourceType> {
    use shuriken_service::auth::ResourceType;
    if path.contains("/calendars/") {
        Some(ResourceType::Calendar)
    } else if path.contains("/addressbooks/") {
        Some(ResourceType::Addressbook)
    } else {
        None
    }
}

/// Extracts owner principal ID from auth context.
fn extract_owner_principal_id(
    subjects: &shuriken_service::auth::ExpandedSubjects,
) -> anyhow::Result<uuid::Uuid> {
    use shuriken_service::auth::Subject;

    // The first subject should be the user's principal
    for subject in subjects.iter() {
        if let Subject::Principal(id) = subject {
            return Ok(*id);
        }
    }

    anyhow::bail!("No authenticated principal found in subjects")
}
