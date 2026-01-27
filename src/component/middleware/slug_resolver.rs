/// Middleware for resolving slug-based paths and preloading entities into the depot.
///
/// ## Summary
/// Parses incoming request paths, converts slug-based identifiers to UUIDs,
/// and stores resolved entities in the request depot for downstream handlers to use.
///
/// For a path like `/calendars/alice/my-calendar/event-1.ics`:
/// - Resolves "alice" (owner) → Principal
/// - Resolves "my-calendar" (collection) → DavCollection
/// - Resolves "event-1" (instance) → DavInstance
/// - Stores Principal, DavCollection, DavInstance in depot
/// - Stores pre-constructed ResourceId for authorization checks
///
/// Both slug paths and UUID paths are supported and normalized.
/// File extensions (.ics, .vcf) are optional for slug paths.
use diesel::prelude::*;
use diesel_async::RunQueryDsl;
use salvo::Depot;
use tracing::{debug, warn};

use crate::component::auth::{PathSegment, ResourceId, ResourceType};
use crate::component::db::connection::DbConnection;
use crate::component::db::query::dav::{collection, instance};
use crate::component::db::schema::{dav_collection, dav_instance, principal};
use crate::component::model::dav::collection::DavCollection;
use crate::component::model::dav::instance::DavInstance;
use crate::component::model::principal::Principal;

/// Depot keys for storing resolved path entities
pub mod depot_keys {
    pub const OWNER_PRINCIPAL: &str = "__owner_principal";
    // COLLECTION now stores a Vec<DavCollection> ordered by precedence
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
    debug!(path = %path, "Resolving path via ResourceId parser");

    // Parse the path using auth's ResourceId
    let resource = match ResourceId::parse(path) {
        Some(r) => r,
        None => {
            debug!("Path does not parse into ResourceId; skipping resolution");
            return Ok(());
        }
    };
    debug!(resource = %resource, "Parsed ResourceId");

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

    // Resolve owner principal
    let owner_str = match owner_opt {
        Some(s) => s,
        None => {
            warn!("Owner segment missing in ResourceId");
            return Ok(());
        }
    };
    let owner_principal = resolve_principal(conn, &owner_str).await?;

    if let Some(ref principal) = owner_principal {
        debug!(principal_id = %principal.id, slug = %principal.slug, "Resolved owner principal");
        depot.insert(depot_keys::OWNER_PRINCIPAL, principal.clone());
    } else {
        warn!(owner = %owner_str, "Owner principal not found");
        return Ok(()); // Principal not found, handlers will return 404
    }

    // Resolve collection if present
    // Resolve nested collection chain if present
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

    // Resolve instance if present
    if let (Some(inst_slug), Some(coll)) = (item_opt.as_ref(), &collection_entity) {
        let inst = resolve_instance(conn, coll.id, inst_slug).await?;
        if let Some(ref i) = inst {
            debug!(instance_id = %i.id, slug = %i.slug, "Resolved instance");
            depot.insert(depot_keys::INSTANCE, i.clone());
            depot.insert(depot_keys::PARSED_INSTANCE_SLUG, i.slug.clone());
        }
    }

    // Store parsed ResourceId for authorization
    depot.insert(depot_keys::RESOURCE_ID, resource);

    Ok(())
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

/// Resolve a collection by slug or UUID.
async fn resolve_collection(
    conn: &mut DbConnection<'_>,
    owner_principal_id: uuid::Uuid,
    identifier: &str,
) -> anyhow::Result<Option<DavCollection>> {
    // Try parsing as UUID first
    if let Ok(uuid) = uuid::Uuid::parse_str(identifier) {
        return dav_collection::table
            .filter(dav_collection::id.eq(uuid))
            .filter(dav_collection::owner_principal_id.eq(owner_principal_id))
            .filter(dav_collection::deleted_at.is_null())
            .select(DavCollection::as_select())
            .first(conn)
            .await
            .optional()
            .map_err(Into::into);
    }

    // Otherwise treat as slug
    collection::by_slug_and_principal(identifier, owner_principal_id)
        .filter(dav_collection::deleted_at.is_null())
        .select(DavCollection::as_select())
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

/// Build a ResourceId for authorization from resolved entities.
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
