/// Middleware for resolving slug-based paths and preloading entities into the depot.
///
/// ## Summary
/// Parses incoming request paths, converts slug-based identifiers to UUIDs,
/// and stores resolved entities in the request depot for downstream handlers to use.
///
/// For a path like `/calendars/alice/my-calendar/event-1.ics`:
/// - Resolves "alice" (owner) → `Principal`
/// - Resolves "my-calendar" (collection) → `DavCollection`
/// - Resolves "event-1" (instance) → `DavInstance`
/// - Stores `Principal`, `DavCollection`, `DavInstance` in depot
/// - Stores pre-constructed `ResourceId` for authorization checks
///
/// Both slug paths and UUID paths are supported and normalized.
/// File extensions (.ics, .vcf) are optional for slug paths.
use diesel::prelude::*;
use diesel_async::RunQueryDsl;
use salvo::Depot;
use tracing::{debug, warn};

#[cfg(test)]
use crate::component::auth::ResourceType;
use crate::component::auth::depot::depot_keys;
use crate::component::auth::{PathSegment, ResourceLocation};
use crate::component::db::connection::DbConnection;
use crate::component::db::query::dav::instance;
use crate::component::db::schema::{dav_collection, dav_instance, principal};
use crate::component::model::dav::collection::{DavCollection, DavCollectionWithParent};
use crate::component::model::dav::instance::DavInstance;
use crate::component::model::principal::Principal;

/// Resolves path components and preloads entities into the depot.
///
/// This middleware should be registered early in the route chain to populate
/// the depot before auth middleware and route handlers execute.
///
/// ## Errors
/// Returns an error if database operations fail during entity resolution.
#[tracing::instrument(skip_all, fields(path = %req.uri().path()))]
pub async fn resolve_path_and_load_entities(
    req: &salvo::Request,
    depot: &mut Depot,
    conn: &mut DbConnection<'_>,
) -> anyhow::Result<()> {
    let path = req.uri().path();

    // Parse ResourceId first
    let location = match ResourceLocation::parse(path) {
        Some(r) => r,
        None => {
            debug!("Path does not conform to known ResourceId format");
            return Ok(());
        }
    };

    // Extract identifiers from ResourceId segments
    let mut resource_type_opt: Option<crate::component::auth::ResourceType> = None;
    let mut owner_opt: Option<String> = None;
    let mut collection_segments: Vec<String> = Vec::new();
    let mut item_opt: Option<String> = None;

    for seg in location.segments() {
        match seg {
            PathSegment::ResourceType(rt) => resource_type_opt = Some(*rt),
            PathSegment::Owner(s) => owner_opt = Some(s.clone()),
            PathSegment::Collection(s) => collection_segments.push(s.clone()),
            PathSegment::Item(s) => {
                let cleaned = s
                    .trim_end_matches(".ics")
                    .trim_end_matches(".vcf")
                    .to_string();
                item_opt = Some(cleaned);
            }
            PathSegment::Glob { .. } => {
                tracing::error!("Glob segments are not supported in slug resolution");
                return Ok(());
            }
        }
    }

    let resource_type = match resource_type_opt {
        Some(rt) => rt,
        None => {
            warn!("No resource type segment found in path");
            return Ok(());
        }
    };

    // Resolve principal
    let owner_principal = match owner_opt {
        Some(ref owner) => match resolve_principal(conn, owner).await? {
            Some(p) => {
                depot.insert(depot_keys::OWNER_PRINCIPAL, p.clone());
                p
            }
            None => {
                warn!("Owner principal not found for identifier: {}", owner);
                return Ok(());
            }
        },
        None => {
            warn!("No owner segment found in path");
            return Ok(());
        }
    };

    // Resolve collection(s) if present
    let collection_entity =
        load_collection_hierarchy(conn, collection_segments, owner_principal.clone()).await?;
    if let Some(ref coll_with_parent) = collection_entity {
        depot.insert(depot_keys::COLLECTION_CHAIN, coll_with_parent.clone());
        depot.insert(
            depot_keys::TERMINAL_COLLECTION,
            coll_with_parent.collection.clone(),
        );
    }

    // Resolve instance if present
    let instance_entity = if let (Some(inst_slug), Some(coll_with_parent)) =
        (item_opt.as_ref(), &collection_entity)
    {
        match resolve_instance(conn, coll_with_parent.collection.id, inst_slug).await? {
            Some(inst) => {
                depot.insert(depot_keys::INSTANCE, inst.clone());
                Some(inst)
            }
            None => {
                warn!(
                    "Instance not found for slug: {} in collection ID: {}",
                    inst_slug, coll_with_parent.collection.id
                );
                return Ok(());
            }
        }
    } else {
        None
    };

    // Build and store normalized ResourceLocation
    let mut segments = vec![
        PathSegment::ResourceType(resource_type),
        PathSegment::Owner(owner_principal.id.to_string()),
    ];
    if let Some(coll_with_parent) = &collection_entity {
        segments.push(PathSegment::Collection(
            coll_with_parent.collection.id.to_string(),
        ));

        if let Some(inst) = &instance_entity {
            segments.push(PathSegment::Item(inst.id.to_string()));
        } else {
            segments.push(PathSegment::Glob { recursive: true });
        }
    }

    let resolved_location = ResourceLocation::from_segments(segments);
    depot.insert(depot_keys::RESOLVED_LOCATION, resolved_location);

    Ok(())
}

/// Parse API-style DAV paths into `(ResourceType, collection_id, item_slug)`.
#[must_use]
fn parse_api_dav_path(
    path: &str,
) -> (
    Option<crate::component::auth::ResourceType>,
    Option<uuid::Uuid>,
    Option<String>,
) {
    let parts: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    if parts.is_empty() {
        return (None, None, None);
    }
    // Find caldav or carddav segment, allowing optional "api" and "dav" prefixes
    let mut idx: Option<usize> = None;
    for (i, p) in parts.iter().enumerate() {
        if *p == "caldav" || *p == "carddav" {
            idx = Some(i);
            break;
        }
    }
    let Some(i) = idx else {
        return (None, None, None);
    };
    let rt = if parts[i] == "caldav" {
        crate::component::auth::ResourceType::Calendar
    } else {
        crate::component::auth::ResourceType::Addressbook
    };
    // Next segment must be UUID collection id
    if i + 1 >= parts.len() {
        return (Some(rt), None, None);
    }
    let collection_id = uuid::Uuid::parse_str(parts[i + 1]).ok();
    // Optional item slug
    let item_slug = if i + 2 < parts.len() {
        Some(parts.last().unwrap().to_string())
    } else {
        None
    };
    (Some(rt), collection_id, item_slug)
}

async fn load_collection_hierarchy(
    conn: &mut DbConnection<'_>,
    collection_segments: Vec<String>,
    principal: Principal,
) -> Result<Option<DavCollectionWithParent>, anyhow::Error> {
    let mut current_parent: Option<uuid::Uuid> = None;
    let mut resolved: Option<DavCollectionWithParent> = None;
    for slug in &collection_segments {
        let mut query = dav_collection::table
            .filter(dav_collection::owner_principal_id.eq(principal.id))
            .filter(dav_collection::slug.eq(slug.as_str()))
            .filter(dav_collection::deleted_at.is_null())
            .into_boxed();

        // Enforce proper parent linkage
        query = if let Some(parent_id) = current_parent {
            query.filter(dav_collection::parent_collection_id.eq(parent_id))
        } else {
            query.filter(dav_collection::parent_collection_id.is_null())
        };

        let found = query
            .select(DavCollection::as_select())
            .first(conn)
            .await
            .optional()?;
        match found {
            Some(c) => {
                current_parent = Some(c.id);
                resolved = Some(DavCollectionWithParent {
                    collection: c,
                    parent_collection: resolved.map(|r| Box::new(r.collection.clone())),
                });
            }
            None => {
                resolved = None;
                break;
            }
        }
    }

    Ok(resolved)
}

/// Test-friendly resolver that accepts a raw path string.
///
/// ## Summary
/// Provides a convenient way for integration tests to exercise the slug
/// resolution logic without constructing a full `salvo::Request`.
///
/// ## Errors
/// Returns any database query errors encountered during resolution.
pub async fn resolve_path_for_testing(
    path: &str,
    conn: &mut DbConnection<'_>,
) -> anyhow::Result<(
    Option<Principal>,
    Option<DavCollection>,
    Option<DavInstance>,
    Option<ResourceLocation>,
)> {
    let resource = match ResourceLocation::parse(path) {
        Some(r) => r,
        None => return Ok((None, None, None, None)),
    };

    // Extract identifiers directly from ResourceId
    let mut owner_opt: Option<String> = None;
    let mut collection_segments: Vec<String> = Vec::new();
    let mut item_opt: Option<String> = None;
    for seg in resource.segments() {
        match seg {
            PathSegment::Owner(s) => owner_opt = Some(s.clone()),
            PathSegment::Collection(s) => collection_segments.push(s.clone()),
            PathSegment::Item(s) => {
                let cleaned = s
                    .trim_end_matches(".ics")
                    .trim_end_matches(".vcf")
                    .to_string();
                item_opt = Some(cleaned);
            }
            PathSegment::ResourceType(_) | PathSegment::Glob { .. } => {}
        }
    }

    // Resolve principal
    let owner_principal = match owner_opt {
        Some(ref owner) => resolve_principal(conn, owner).await?,
        None => None,
    };

    // Resolve collection if present
    // Resolve nested collection chain if present
    let collection_entity =
        fetch_collection_by_slug(conn, collection_segments, &owner_principal).await?;

    // Resolve instance if present
    let instance_entity =
        if let (Some(inst_slug), Some(coll)) = (item_opt.as_ref(), &collection_entity) {
            resolve_instance(conn, coll.id, inst_slug).await?
        } else {
            None
        };

    // Return parsed ResourceId
    let resource_id = Some(resource);

    Ok((
        owner_principal,
        collection_entity,
        instance_entity,
        resource_id,
    ))
}

async fn fetch_collection_by_slug(
    conn: &mut DbConnection<'_>,
    collection_segments: Vec<String>,
    owner_principal: &Option<Principal>,
) -> Result<Option<DavCollection>, anyhow::Error> {
    let collection_entity =
        if let (false, Some(principal)) = (collection_segments.is_empty(), owner_principal) {
            let mut current_parent: Option<uuid::Uuid> = None;
            let mut resolved: Option<DavCollection> = None;
            for slug in &collection_segments {
                let mut query = dav_collection::table
                    .filter(dav_collection::owner_principal_id.eq(principal.id))
                    .filter(dav_collection::slug.eq(slug.as_str()))
                    .filter(dav_collection::deleted_at.is_null())
                    .into_boxed();

                query = if let Some(parent_id) = current_parent {
                    query.filter(dav_collection::parent_collection_id.eq(parent_id))
                } else {
                    query.filter(dav_collection::parent_collection_id.is_null())
                };

                let found = query
                    .select(DavCollection::as_select())
                    .first(conn)
                    .await
                    .optional()?;
                match found {
                    Some(c) => {
                        current_parent = Some(c.id);
                        resolved = Some(c);
                    }
                    None => {
                        resolved = None;
                        break;
                    }
                }
            }

            resolved
        } else {
            None
        };
    Ok(collection_entity)
}

// NOTE: `extract_identifiers` removed. We use `ResourceId::segments()` directly
// in resolvers to avoid redundant helpers and keep logic aligned with auth.

/// Resolve a principal by slug or UUID.
async fn resolve_principal(
    conn: &mut DbConnection<'_>,
    identifier: &str,
) -> anyhow::Result<Option<Principal>> {
    // Try parsing as UUID first
    if let Ok(uuid) = uuid::Uuid::parse_str(identifier) {
        return principal::table
            .filter(principal::id.eq(uuid))
            .filter(principal::deleted_at.is_null())
            .select(Principal::as_select())
            .first(conn)
            .await
            .optional()
            .map_err(Into::into);
    }

    // Otherwise treat as slug
    principal::table
        .filter(principal::slug.eq(identifier))
        .filter(principal::deleted_at.is_null())
        .select(Principal::as_select())
        .first(conn)
        .await
        .optional()
        .map_err(Into::into)
}

/// Resolve an instance by slug or UUID.
async fn resolve_instance(
    conn: &mut DbConnection<'_>,
    collection_id: uuid::Uuid,
    identifier: &str,
) -> anyhow::Result<Option<DavInstance>> {
    // Try parsing as UUID first
    if let Ok(uuid) = uuid::Uuid::parse_str(identifier) {
        return dav_instance::table
            .filter(dav_instance::id.eq(uuid))
            .filter(dav_instance::collection_id.eq(collection_id))
            .filter(dav_instance::deleted_at.is_null())
            .select(DavInstance::as_select())
            .first(conn)
            .await
            .optional()
            .map_err(Into::into);
    }

    // Otherwise treat as slug
    instance::by_slug_and_collection(collection_id, identifier)
        .select(DavInstance::as_select())
        .first(conn)
        .await
        .optional()
        .map_err(Into::into)
}

/// Build a `ResourceId` for authorization from resolved entities.
#[cfg(test)]
fn build_resource_id(
    resource_type: ResourceType,
    principal: &Principal,
    collection: Option<&DavCollection>,
    instance_slug: Option<&str>,
) -> ResourceLocation {
    let mut segments = vec![
        PathSegment::ResourceType(resource_type),
        PathSegment::Owner(principal.slug.clone()),
    ];

    if let Some(coll) = collection {
        segments.push(PathSegment::Collection(coll.slug.clone()));

        if let Some(slug) = instance_slug {
            segments.push(PathSegment::Item(slug.to_string()));
        } else {
            // Collection-level access with wildcard for items
            segments.push(PathSegment::Glob { recursive: true });
        }
    } else {
        // Owner-level access with wildcard
        segments.push(PathSegment::Glob { recursive: true });
    }

    ResourceLocation::from_segments(segments)
}

/// ## Summary
/// Salvo handler wrapper for path resolution middleware.
///
/// Resolves slug-based paths and populates the depot with ResourceId and entity data
/// for downstream handlers to use in authorization and request processing.
#[salvo::async_trait]
impl salvo::Handler for SlugResolverHandler {
    async fn handle(
        &self,
        req: &mut salvo::Request,
        depot: &mut Depot,
        _res: &mut salvo::Response,
        _ctrl: &mut salvo::FlowCtrl,
    ) {
        let path = req.uri().path();
        tracing::debug!(path = %path, "SlugResolverHandler executing");

        let db_provider = match crate::component::db::connection::get_db_from_depot(depot) {
            Ok(provider) => provider,
            Err(e) => {
                tracing::debug!(error = %e, "Database provider not available in slug_resolver middleware");
                return;
            }
        };

        let mut conn = match db_provider.get_connection().await {
            Ok(conn) => conn,
            Err(e) => {
                tracing::debug!(error = %e, "Failed to get database connection in slug_resolver middleware");
                return;
            }
        };

        match resolve_path_and_load_entities(req, depot, &mut conn).await {
            Ok(()) => {
                tracing::debug!(path = %path, "Path resolved successfully");
            }
            Err(e) => {
                tracing::debug!(error = %e, path = %path, "Path resolution failed; continuing without depot entities");
            }
        }
    }
}

/// ## Summary
/// Middleware handler for path resolution.
/// Use this as a handler in routes to resolve paths and populate the depot.
pub struct SlugResolverHandler;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_resource_id_owner_level() {
        let principal = Principal {
            id: uuid::Uuid::new_v4(),
            principal_type: "user".to_string(),
            display_name: Some("Alice".to_string()),
            updated_at: chrono::Utc::now(),
            deleted_at: None,
            slug: "alice".to_string(),
        };

        let resource_id = build_resource_id(ResourceType::Calendar, &principal, None, None);

        let segments = resource_id.segments();
        assert_eq!(segments.len(), 3);
        assert!(matches!(
            segments[0],
            PathSegment::ResourceType(ResourceType::Calendar)
        ));
        assert!(matches!(&segments[1], PathSegment::Owner(s) if s == "alice"));
        assert!(matches!(segments[2], PathSegment::Glob { recursive: true }));
    }

    #[test]
    fn test_build_resource_id_collection_level() {
        let principal = Principal {
            id: uuid::Uuid::new_v4(),
            principal_type: "user".to_string(),
            display_name: Some("Alice".to_string()),
            updated_at: chrono::Utc::now(),
            deleted_at: None,
            slug: "alice".to_string(),
        };

        let collection = DavCollection {
            id: uuid::Uuid::new_v4(),
            owner_principal_id: principal.id,
            collection_type: "calendar".to_string(),
            display_name: Some("Work".to_string()),
            description: None,
            timezone_tzid: None,
            synctoken: 1,
            updated_at: chrono::Utc::now(),
            deleted_at: None,
            supported_components: None,
            slug: "work".to_string(),
            parent_collection_id: None,
        };

        let resource_id =
            build_resource_id(ResourceType::Calendar, &principal, Some(&collection), None);

        let segments = resource_id.segments();
        assert_eq!(segments.len(), 4);
        assert!(matches!(
            segments[0],
            PathSegment::ResourceType(ResourceType::Calendar)
        ));
        assert!(matches!(&segments[1], PathSegment::Owner(s) if s == "alice"));
        assert!(matches!(&segments[2], PathSegment::Collection(s) if s == "work"));
        assert!(matches!(segments[3], PathSegment::Glob { recursive: true }));
    }

    #[test]
    fn test_build_resource_id_instance_level() {
        let principal = Principal {
            id: uuid::Uuid::new_v4(),
            principal_type: "user".to_string(),
            display_name: Some("Alice".to_string()),
            updated_at: chrono::Utc::now(),
            deleted_at: None,
            slug: "alice".to_string(),
        };

        let collection = DavCollection {
            id: uuid::Uuid::new_v4(),
            owner_principal_id: principal.id,
            collection_type: "calendar".to_string(),
            display_name: Some("Work".to_string()),
            description: None,
            timezone_tzid: None,
            synctoken: 1,
            updated_at: chrono::Utc::now(),
            deleted_at: None,
            supported_components: None,
            slug: "work".to_string(),
            parent_collection_id: None,
        };

        let resource_id = build_resource_id(
            ResourceType::Calendar,
            &principal,
            Some(&collection),
            Some("event-1"),
        );

        let segments = resource_id.segments();
        assert_eq!(segments.len(), 4);
        assert!(matches!(
            segments[0],
            PathSegment::ResourceType(ResourceType::Calendar)
        ));
        assert!(matches!(&segments[1], PathSegment::Owner(s) if s == "alice"));
        assert!(matches!(&segments[2], PathSegment::Collection(s) if s == "work"));
        assert!(matches!(&segments[3], PathSegment::Item(s) if s == "event-1"));
    }

    #[test]
    fn test_build_resource_id_addressbook() {
        let principal = Principal {
            id: uuid::Uuid::new_v4(),
            principal_type: "user".to_string(),
            display_name: Some("Bob".to_string()),
            updated_at: chrono::Utc::now(),
            deleted_at: None,
            slug: "bob".to_string(),
        };

        let collection = DavCollection {
            id: uuid::Uuid::new_v4(),
            owner_principal_id: principal.id,
            collection_type: "addressbook".to_string(),
            display_name: Some("Contacts".to_string()),
            description: None,
            timezone_tzid: None,
            synctoken: 1,
            updated_at: chrono::Utc::now(),
            deleted_at: None,
            supported_components: None,
            slug: "contacts".to_string(),
            parent_collection_id: None,
        };

        let resource_id = build_resource_id(
            ResourceType::Addressbook,
            &principal,
            Some(&collection),
            Some("john-doe"),
        );

        let segments = resource_id.segments();
        assert_eq!(segments.len(), 4);
        assert!(matches!(
            segments[0],
            PathSegment::ResourceType(ResourceType::Addressbook)
        ));
        assert!(matches!(&segments[1], PathSegment::Owner(s) if s == "bob"));
        assert!(matches!(&segments[2], PathSegment::Collection(s) if s == "contacts"));
        assert!(matches!(&segments[3], PathSegment::Item(s) if s == "john-doe"));
    }

    // Integration tests with database
    // (Integration tests moved to tests/integration/slug_resolver.rs)
}
