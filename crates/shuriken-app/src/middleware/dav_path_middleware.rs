//! Middleware for DAV path resolution and entity preloading.
//!
//! ## Summary
//! Parses incoming DAV request paths, resolves entities from the database,
//! and populates the request depot with both the original slug-based path
//! and the canonical UUID-based path for use by downstream handlers.
//!
//! This middleware enables:
//! - Slug-based routing (e.g., `/calendars/alice/work/event-1.ics`)
//! - UUID-based routing (e.g., `/calendars/{uuid}/{uuid}/{uuid}.ics`)
//! - Mixed routing (slugs and UUIDs in the same path)
//! - Consistent authorization via canonical UUIDs

use salvo::Depot;
use shuriken_service::auth::ResourceIdentifier;
use tracing::debug;

use crate::app::api::DAV_ROUTE_PREFIX;
use crate::middleware::path_parser::parse_and_resolve_path;
use shuriken_db::dav_types::DavIdentifier;
use shuriken_service::auth::PathSegment;
use shuriken_service::auth::depot::depot_keys;

/// Middleware handler for DAV path resolution.
///
/// ## Summary
/// Parses the request path, resolves entities, and stores both original and
/// canonical `ResourceLocation` in the depot along with resolved entities.
///
/// Depot keys populated:
/// - `PATH_LOCATION`: Original slug-based `ResourceLocation`
/// - `RESOLVED_LOCATION`: Canonical UUID-based `ResourceLocation`
/// - `OWNER_PRINCIPAL`: Resolved `Principal`
/// - `TERMINAL_COLLECTION`: Resolved `DavCollection` (terminal in hierarchy)
/// - `INSTANCE`: Resolved `DavInstance`
pub struct DavPathMiddleware;

#[salvo::async_trait]
impl salvo::Handler for DavPathMiddleware {
    #[tracing::instrument(skip_all, fields(path = %req.uri().path()))]
    async fn handle(
        &self,
        req: &mut salvo::Request,
        depot: &mut Depot,
        _res: &mut salvo::Response,
        _ctrl: &mut salvo::FlowCtrl,
    ) {
        let path = req.uri().path();
        debug!(path = %path, "DavPathMiddleware executing");

        // Strip DAV route prefix if present
        let clean_path = path.strip_prefix(DAV_ROUTE_PREFIX).unwrap_or(path);

        // Get database connection
        let db_provider = match crate::db_handler::get_db_from_depot(depot) {
            Ok(provider) => provider,
            Err(e) => {
                debug!(error = %e, "Database provider not available in dav_path_middleware");
                return;
            }
        };

        let mut conn = match db_provider.get_connection().await {
            Ok(conn) => conn,
            Err(e) => {
                debug!(error = %e, "Failed to get database connection in dav_path_middleware");
                return;
            }
        };

        // Parse and resolve path
        match parse_and_resolve_path(clean_path, &mut conn).await {
            Ok(result) => {
                debug!(
                    path = %path,
                    has_principal = result.principal.is_some(),
                    has_collection_chain = result.collection_chain.is_some(),
                    has_instance = result.instance.is_some(),
                    has_canonical = result.canonical_location.is_some(),
                    "Path resolved successfully"
                );

                if let Some(PathSegment::Collection(value)) = result
                    .original_location
                    .segments()
                    .iter()
                    .rfind(|s| matches!(s, PathSegment::Collection(_)))
                {
                    let dav_id = match value {
                        ResourceIdentifier::Slug(s) => DavIdentifier::from(s.clone()),
                        ResourceIdentifier::Id(uuid) => DavIdentifier::from(*uuid),
                    };
                    depot.insert(depot_keys::TERMINAL_COLLECTION, dav_id);
                }

                // Store original location
                depot.insert(depot_keys::PATH_LOCATION, result.original_location);

                // Store canonical location if available
                if let Some(canonical) = result.canonical_location {
                    depot.insert(depot_keys::RESOLVED_LOCATION, canonical);
                }

                // Store resolved entities
                if let Some(principal) = result.principal {
                    depot.insert(depot_keys::OWNER_PRINCIPAL, principal);
                }

                if let Some(chain) = result.collection_chain {
                    depot.insert(depot_keys::COLLECTION_CHAIN, chain);
                }

                if let Some(instance) = result.instance {
                    depot.insert(depot_keys::INSTANCE, instance);
                }
            }
            Err(e) => {
                // Log at debug level - missing entities are often expected
                // (e.g., PUT to non-existent resource, OPTIONS on collection)
                debug!(
                    error = %e,
                    path = %path,
                    "Path resolution incomplete or failed; continuing without depot entities"
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_middleware_struct_exists() {
        // Verify the middleware struct can be instantiated
        let middleware = DavPathMiddleware;
        // Use the middleware variable to satisfy clippy
        let _ = middleware;
    }
}
