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
use crate::component::auth::{PathSegment, ResourceId};
use crate::component::db::connection::DbConnection;
use crate::component::db::query::dav::instance;
use crate::component::db::schema::{dav_collection, dav_instance, principal};
use crate::component::model::dav::collection::DavCollection;
use crate::component::model::dav::instance::DavInstance;
use crate::component::model::principal::Principal;

/// Depot keys for storing resolved path entities
pub mod depot_keys {
    pub const OWNER_PRINCIPAL: &str = "__owner_principal";
    // COLLECTION now stores a `Vec<DavCollection>` ordered by precedence
    // (most-specific/deepest first, then parents up to root).
    pub const COLLECTION: &str = "__collection";
    pub const INSTANCE: &str = "__instance";
    pub const RESOURCE_ID: &str = "__resource_id";
    pub const PARSED_COLLECTION_ID: &str = "__parsed_collection_id";
    pub const PARSED_INSTANCE_SLUG: &str = "__parsed_instance_slug";
}

/// Resolves path components and preloads entities into the depot.
///
/// This middleware should be registered early in the route chain to populate
/// the depot before auth middleware and route handlers execute.
///
/// ## Errors
/// Returns an error if database operations fail during entity resolution.
pub async fn resolve_path_and_load_entities(
    req: &salvo::Request,
    depot: &mut Depot,
    conn: &mut DbConnection<'_>,
) -> anyhow::Result<()> {
    let path = req.uri().path();
    debug!(path = %path, "Resolving path via ResourceId or API DAV parser");

    // Try canonical ResourceId parse first
    let resource_opt = ResourceId::parse(path);

    // Fallback: parse API DAV style paths like
    // /api/dav/{caldav|carddav}/{collection_id}/{item?}
    // or /api/{caldav|carddav}/{collection_id}/{item?}
    let (resource_type_opt, collection_id_opt, item_slug_opt) = if resource_opt.is_none() {
        parse_api_dav_path(path)
    } else {
        (None, None, None)
    };

    if resource_opt.is_none() && resource_type_opt.is_none() {
        debug!("Path does not parse into ResourceId or API DAV style; skipping resolution");
        return Ok(());
    }

    // Extract identifiers either from ResourceId or API DAV
    let mut owner_opt: Option<String> = None;
    let mut collection_segments: Vec<String> = Vec::new();
    let mut item_opt: Option<String> = None;
    let mut resource_type_for_api: Option<crate::component::auth::ResourceType> = None;
    let mut collection_id_for_api: Option<uuid::Uuid> = None;

    if let Some(resource) = &resource_opt {
        debug!(resource = %resource, "Parsed ResourceId");
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
    } else if let (Some(rt), Some(cid)) = (resource_type_opt, collection_id_opt) {
        resource_type_for_api = Some(rt);
        collection_id_for_api = Some(cid);
        if let Some(item) = item_slug_opt {
            let cleaned = item
                .trim_end_matches(".ics")
                .trim_end_matches(".vcf")
                .to_string();
            item_opt = Some(cleaned);
        }
    }

    // Resolve owner principal (by slug or by collection owner if API path)
    let owner_principal = if let Some(ref owner_str) = owner_opt {
        resolve_principal(conn, owner_str).await?
    } else if let Some(cid) = collection_id_for_api {
        let coll = dav_collection::table
            .filter(dav_collection::id.eq(cid))
            .filter(dav_collection::deleted_at.is_null())
            .select(DavCollection::as_select())
            .first(conn)
            .await
            .optional()?;
        match coll {
            Some(c) => resolve_principal_by_id(conn, c.owner_principal_id).await?,
            None => None,
        }
    } else {
        None
    };

    if let Some(ref principal) = owner_principal {
        debug!(principal_id = %principal.id, slug = %principal.slug, "Resolved owner principal");
        depot.insert(depot_keys::OWNER_PRINCIPAL, principal.clone());
    } else {
        if let Some(ref owner_slug) = owner_opt {
            warn!(owner = %owner_slug, "Owner principal not found");
        } else if let Some(cid) = collection_id_for_api {
            warn!(collection_id = %cid, "Owner principal not found for collection id");
        } else {
            warn!("Owner principal not found");
        }
        return Ok(()); // Principal not found, handlers will return 404
    }

    // Resolve collection chain either by slug segments or by collection id
    let collection_entity = if collection_id_for_api.is_some() {
        let coll = load_collection_chain_by_id(depot, conn, collection_id_for_api.unwrap()).await?;
        coll
    } else {
        load_collection_hierarchy(depot, conn, collection_segments, owner_principal.clone()).await?
    };

    // Resolve instance if present
    if let (Some(inst_slug), Some(coll)) = (item_opt.as_ref(), &collection_entity) {
        let inst = resolve_instance(conn, coll.id, inst_slug).await?;
        if let Some(ref i) = inst {
            debug!(instance_id = %i.id, slug = %i.slug, "Resolved instance");
            depot.insert(depot_keys::INSTANCE, i.clone());
            depot.insert(depot_keys::PARSED_INSTANCE_SLUG, i.slug.clone());
        }
    }

    // Store constructed ResourceId for authorization
    let resource = if let Some(r) = resource_opt {
        r
    } else {
        // Build ResourceId from API path using resolved principal + chain
        if let (Some(principal), Some(rt)) = (owner_principal.clone(), resource_type_for_api) {
            let mut segments = Vec::new();
            segments.push(PathSegment::ResourceType(rt));
            segments.push(PathSegment::Owner(principal.slug.clone()));
            // Build collection segments from chain stored in depot (root-first)
            if let Ok(chain) = depot.get::<Vec<DavCollection>>(depot_keys::COLLECTION) {
                let mut chain_clone: Vec<DavCollection> = chain.clone();
                // Currently stored deepest-first; reverse to root-first for ResourceId path
                chain_clone.reverse();
                for c in &chain_clone {
                    segments.push(PathSegment::Collection(c.slug.clone()));
                }
            }
            if let Some(item) = &item_opt {
                segments.push(PathSegment::Item(item.clone()));
            }
            ResourceId::from_segments(segments)
        } else {
            // Insufficient data to construct ResourceId
            return Ok(());
        }
    };
    depot.insert(depot_keys::RESOURCE_ID, resource);

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

async fn resolve_principal_by_id(
    conn: &mut DbConnection<'_>,
    principal_id: uuid::Uuid,
) -> anyhow::Result<Option<Principal>> {
    let row = principal::table
        .filter(principal::id.eq(principal_id))
        .select(Principal::as_select())
        .first(conn)
        .await
        .optional()?;
    Ok(row)
}

async fn load_collection_chain_by_id(
    depot: &mut Depot,
    conn: &mut DbConnection<'_>,
    collection_id: uuid::Uuid,
) -> anyhow::Result<Option<DavCollection>> {
    // Load starting collection
    let mut current = dav_collection::table
        .filter(dav_collection::id.eq(collection_id))
        .filter(dav_collection::deleted_at.is_null())
        .select(DavCollection::as_select())
        .first(conn)
        .await
        .optional()?;

    let mut chain: Vec<DavCollection> = Vec::new();
    while let Some(coll) = current {
        chain.push(coll.clone());
        if let Some(parent_id) = coll.parent_collection_id {
            current = dav_collection::table
                .filter(dav_collection::id.eq(parent_id))
                .filter(dav_collection::deleted_at.is_null())
                .select(DavCollection::as_select())
                .first(conn)
                .await
                .optional()?;
        } else {
            break;
        }
    }

    if let Some(last) = chain.as_slice().first() {
        // `chain` is deepest-first because we started from requested collection
        debug!(collection_id = %last.id, slug = %last.slug, depth = chain.len(), "Resolved collection chain by id");
        depot.insert(depot_keys::COLLECTION, chain.clone());
        depot.insert(depot_keys::PARSED_COLLECTION_ID, last.id);
        Ok(Some(last.clone()))
    } else {
        Ok(None)
    }
}

async fn load_collection_hierarchy(
    depot: &mut Depot,
    conn: &mut DbConnection<'_>,
    collection_segments: Vec<String>,
    owner_principal: Option<Principal>,
) -> Result<Option<DavCollection>, anyhow::Error> {
    let collection_entity = if let (false, Some(principal)) =
        (collection_segments.is_empty(), &owner_principal)
    {
        let mut current_parent: Option<uuid::Uuid> = None;
        let mut chain: Vec<DavCollection> = Vec::new();
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
                    chain.push(c);
                }
                None => {
                    break;
                }
            }
        }

        if let Some(last) = chain.last() {
            debug!(collection_id = %last.id, slug = %last.slug, depth = chain.len(), "Resolved collection chain");
            let mut precedence = chain.clone();
            precedence.reverse();
            depot.insert(depot_keys::COLLECTION, precedence);
            depot.insert(depot_keys::PARSED_COLLECTION_ID, last.id);
            Some(last.clone())
        } else {
            None
        }
    } else {
        None
    };
    Ok(collection_entity)
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
    Option<ResourceId>,
)> {
    let resource = match ResourceId::parse(path) {
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
#[cfg_attr(test, allow(dead_code))]
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

/// Build a ResourceId for authorization from resolved entities.
#[cfg(test)]
fn build_resource_id(
    resource_type: ResourceType,
    principal: &Principal,
    collection: Option<&DavCollection>,
    instance_slug: Option<&str>,
) -> ResourceId {
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

    ResourceId::from_segments(segments)
}

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
