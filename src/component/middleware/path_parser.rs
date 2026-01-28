//! Path parsing and entity resolution for DAV resources.
//!
//! ## Summary
//! Parses DAV paths into `ResourceLocation` structures and loads corresponding
//! database entities. Returns both the original slug-based location and a
//! canonical UUID-based location for authorization and routing.
//!
//! For a path like `/calendars/alice/my-calendar/event-1.ics`:
//! - Parses to `ResourceLocation` with slug segments
//! - Loads `Principal`, `DavCollection`, `DavInstance` from database
//! - Builds canonical `ResourceLocation` with UUID segments
//! - Returns both locations plus loaded entities

use diesel::prelude::*;
use diesel_async::RunQueryDsl;

use crate::component::auth::{PathSegment, ResourceLocation};
use crate::component::db::connection::DbConnection;
use crate::component::db::query::dav::instance;
use crate::component::db::schema::{dav_collection, dav_instance, principal};
use crate::component::error::PathResolutionError;
use crate::component::model::dav::collection::DavCollection;
use crate::component::model::dav::instance::DavInstance;
use crate::component::model::principal::Principal;

/// Identifier for DAV entities that can be either a slug or UUID.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DavIdentifier {
    /// Slug-based identifier (e.g., "my-calendar")
    Slug(String),
    /// UUID-based identifier
    Uuid(uuid::Uuid),
}

impl DavIdentifier {
    /// Check if this identifier matches a collection.
    #[must_use]
    pub fn matches_collection(&self, collection: &DavCollection) -> bool {
        match self {
            Self::Slug(slug) => &collection.slug == slug,
            Self::Uuid(id) => &collection.id == id,
        }
    }

    /// Check if this identifier matches an instance.
    #[must_use]
    pub fn matches_instance(&self, instance: &DavInstance) -> bool {
        match self {
            Self::Slug(slug) => &instance.slug == slug,
            Self::Uuid(id) => &instance.id == id,
        }
    }
}

impl From<String> for DavIdentifier {
    fn from(s: String) -> Self {
        if let Ok(uuid) = uuid::Uuid::parse_str(&s) {
            Self::Uuid(uuid)
        } else {
            Self::Slug(s)
        }
    }
}

impl From<&str> for DavIdentifier {
    fn from(s: &str) -> Self {
        if let Ok(uuid) = uuid::Uuid::parse_str(s) {
            Self::Uuid(uuid)
        } else {
            Self::Slug(s.to_string())
        }
    }
}

impl From<uuid::Uuid> for DavIdentifier {
    fn from(id: uuid::Uuid) -> Self {
        Self::Uuid(id)
    }
}

/// Chain of collections representing a hierarchy path.
///
/// ## Summary
/// Wraps a vector of collections in hierarchical order (root to leaf).
/// Provides methods to access collections by slug or UUID.
#[derive(Debug, Clone)]
pub struct CollectionChain {
    collections: Vec<DavCollection>,
}

impl CollectionChain {
    /// Create a new collection chain from a vector.
    #[must_use]
    pub fn new(collections: Vec<DavCollection>) -> Self {
        Self { collections }
    }

    /// Get the underlying vector of collections.
    #[must_use]
    pub fn collections(&self) -> &[DavCollection] {
        &self.collections
    }

    /// Get the terminal (last) collection in the chain.
    #[must_use]
    pub fn terminal(&self) -> Option<&DavCollection> {
        self.collections.last()
    }

    /// Get a collection by identifier (slug or UUID).
    #[must_use]
    pub fn get_by_identifier(&self, identifier: &DavIdentifier) -> Option<&DavCollection> {
        self.collections
            .iter()
            .find(|c| identifier.matches_collection(c))
    }

    /// Check if the chain is empty.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.collections.is_empty()
    }

    /// Get the length of the chain.
    #[must_use]
    pub fn len(&self) -> usize {
        self.collections.len()
    }
}

/// Result of parsing and resolving a DAV path.
///
/// ## Summary
/// Contains the original slug-based location, canonical UUID-based location
/// (if all entities were successfully resolved), and the loaded entities.
#[derive(Debug, Clone)]
pub struct PathResolutionResult {
    /// Original path parsed into ResourceLocation (may contain slugs)
    pub original_location: ResourceLocation,

    /// Canonical ResourceLocation with UUIDs (only present if all entities resolved)
    pub canonical_location: Option<ResourceLocation>,

    /// Resolved principal (owner)
    pub principal: Option<Principal>,

    /// Resolved collection chain (if path includes collection segments)
    pub collection_chain: Option<CollectionChain>,

    /// Resolved instance (if path includes instance segment)
    pub instance: Option<DavInstance>,

    /// Original item filename with extension (e.g., "event-1.ics")
    pub item_filename: Option<String>,
}

/// Parse a DAV path and resolve all entities from the database.
///
/// ## Summary
/// Takes a path string, parses it into segments, loads entities from the database,
/// and returns both the original and canonical ResourceLocation along with entities.
///
/// This function returns partial results when entities are not found, allowing
/// handlers to process PUT requests for non-existent resources.
///
/// ## Errors
/// Returns `PathResolutionError::InvalidPathFormat` if the path cannot be parsed.
/// Returns `PathResolutionError::DatabaseError` for database query failures.
/// Does NOT error for missing entities - returns partial data instead.
#[tracing::instrument(skip(conn), fields(path))]
pub async fn parse_and_resolve_path(
    path: &str,
    conn: &mut DbConnection<'_>,
) -> Result<PathResolutionResult, PathResolutionError> {
    // Parse path to ResourceLocation
    let original_location = ResourceLocation::parse(path)
        .ok_or_else(|| PathResolutionError::InvalidPathFormat(path.to_string()))?;

    // Extract segments for entity lookup
    let mut resource_type_opt = None;
    let mut owner_identifier: Option<String> = None;
    let mut collection_segments: Vec<String> = Vec::new();
    let mut item_identifier: Option<String> = None;
    let mut item_filename: Option<String> = None;

    for seg in original_location.segments() {
        match seg {
            PathSegment::ResourceType(rt) => resource_type_opt = Some(*rt),
            PathSegment::Owner(s) => owner_identifier = Some(s.clone()),
            PathSegment::Collection(s) => collection_segments.push(s.clone()),
            PathSegment::Item(s) => {
                item_filename = Some(s.clone());
                // Strip file extensions for slug lookup
                let cleaned = s
                    .trim_end_matches(".ics")
                    .trim_end_matches(".vcf")
                    .to_string();
                item_identifier = Some(cleaned);
            }
            PathSegment::Glob { .. } => {
                // Glob segments don't require entity resolution
            }
        }
    }

    // Resolve principal (only fail on DB error, not NotFound)
    let principal = if let Some(ref identifier) = owner_identifier {
        match resolve_principal(conn, identifier).await {
            Ok(p) => Some(p),
            Err(PathResolutionError::PrincipalNotFound(_)) => None,
            Err(e) => return Err(e),
        }
    } else {
        None
    };

    // Resolve collection hierarchy (returns partial chain on NotFound)
    let collection_chain =
        if let (Some(princ), false) = (&principal, collection_segments.is_empty()) {
            let chain = resolve_collection_hierarchy(conn, princ, &collection_segments).await?;
            if chain.is_empty() { None } else { Some(chain) }
        } else {
            None
        };

    // Resolve instance (only fail on DB error, not NotFound)
    let instance = if let (Some(chain), Some(item_id)) = (&collection_chain, &item_identifier) {
        if let Some(terminal_coll) = chain.terminal() {
            match resolve_instance(conn, terminal_coll.id, item_id).await {
                Ok(inst) => Some(inst),
                Err(PathResolutionError::InstanceNotFound { .. }) => None,
                Err(e) => return Err(e),
            }
        } else {
            None
        }
    } else {
        None
    };

    // Build canonical location if all required entities resolved
    let canonical_location = build_canonical_location(
        resource_type_opt,
        &principal,
        collection_chain.as_ref(),
        &instance,
        item_filename.as_deref(),
    );

    Ok(PathResolutionResult {
        original_location,
        canonical_location,
        principal,
        collection_chain,
        instance,
        item_filename,
    })
}

/// Build canonical ResourceLocation from resolved entities using UUIDs.
///
/// ## Summary
/// Constructs a UUID-based ResourceLocation that matches the structure of the
/// original location. Only returns `Some` if all required entities are present.
///
/// This function is public to enable unit testing without database dependencies.
#[must_use]
pub fn build_canonical_location(
    resource_type: Option<crate::component::auth::ResourceType>,
    principal: &Option<Principal>,
    collection_chain: Option<&CollectionChain>,
    instance: &Option<DavInstance>,
    item_filename: Option<&str>,
) -> Option<ResourceLocation> {
    let rt = resource_type?;
    let princ = principal.as_ref()?;

    let mut segments = vec![
        PathSegment::ResourceType(rt),
        PathSegment::Owner(princ.id.to_string()),
    ];

    if let Some(chain) = collection_chain {
        if let Some(coll) = chain.terminal() {
            segments.push(PathSegment::Collection(coll.id.to_string()));

            // Add Item segment if instance exists
            if let Some(inst) = instance {
                // Preserve original filename if provided, otherwise use UUID
                let item_segment = if let Some(filename) = item_filename {
                    // Extract extension from filename
                    if filename.ends_with(".ics") || filename.ends_with(".vcf") {
                        format!("{}{}", inst.id, &filename[filename.rfind('.').unwrap()..])
                    } else {
                        inst.id.to_string()
                    }
                } else {
                    inst.id.to_string()
                };
                segments.push(PathSegment::Item(item_segment));
            }
        }
    }

    Some(ResourceLocation::from_segments(segments))
}

/// Resolve a principal by slug or UUID.
///
/// ## Errors
/// Returns `PrincipalNotFound` if no matching principal exists.
async fn resolve_principal(
    conn: &mut DbConnection<'_>,
    identifier: &str,
) -> Result<Principal, PathResolutionError> {
    // Try parsing as UUID first
    if let Ok(uuid) = uuid::Uuid::parse_str(identifier) {
        return principal::table
            .filter(principal::id.eq(uuid))
            .filter(principal::deleted_at.is_null())
            .select(Principal::as_select())
            .first(conn)
            .await
            .optional()?
            .ok_or_else(|| PathResolutionError::PrincipalNotFound(identifier.to_string()));
    }

    // Otherwise treat as slug
    principal::table
        .filter(principal::slug.eq(identifier))
        .filter(principal::deleted_at.is_null())
        .select(Principal::as_select())
        .first(conn)
        .await
        .optional()?
        .ok_or_else(|| PathResolutionError::PrincipalNotFound(identifier.to_string()))
}

/// Resolve a collection hierarchy by traversing slug segments.
///
/// ## Summary
/// Walks through collection segments, verifying parent-child relationships
/// and ensuring proper nesting. Returns a chain of all successfully resolved
/// collections, stopping at the first missing collection without erroring.
///
/// This enables partial resolution for PUT operations creating new resources.
///
/// ## Errors
/// Only returns errors for actual database failures, not for missing collections.
async fn resolve_collection_hierarchy(
    conn: &mut DbConnection<'_>,
    principal: &Principal,
    collection_segments: &[String],
) -> Result<CollectionChain, PathResolutionError> {
    let mut current_parent: Option<uuid::Uuid> = None;
    let mut resolved_chain: Vec<DavCollection> = Vec::new();

    for slug in collection_segments {
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

        if let Some(c) = found {
            current_parent = Some(c.id);
            resolved_chain.push(c);
        } else {
            // Collection not found - stop here and return partial chain
            break;
        }
    }

    Ok(CollectionChain::new(resolved_chain))
}

/// Resolve an instance by slug or UUID within a collection.
///
/// ## Errors
/// Returns `InstanceNotFound` if no matching instance exists in the collection.
async fn resolve_instance(
    conn: &mut DbConnection<'_>,
    collection_id: uuid::Uuid,
    identifier: &str,
) -> Result<DavInstance, PathResolutionError> {
    // Try parsing as UUID first
    if let Ok(uuid) = uuid::Uuid::parse_str(identifier) {
        return dav_instance::table
            .filter(dav_instance::id.eq(uuid))
            .filter(dav_instance::collection_id.eq(collection_id))
            .filter(dav_instance::deleted_at.is_null())
            .select(DavInstance::as_select())
            .first(conn)
            .await
            .optional()?
            .ok_or_else(|| PathResolutionError::InstanceNotFound {
                collection_id,
                slug: identifier.to_string(),
            });
    }

    // Otherwise treat as slug
    instance::by_slug_and_collection(collection_id, identifier)
        .select(DavInstance::as_select())
        .first(conn)
        .await
        .optional()?
        .ok_or_else(|| PathResolutionError::InstanceNotFound {
            collection_id,
            slug: identifier.to_string(),
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_principal(slug: &str) -> Principal {
        Principal {
            id: uuid::Uuid::new_v4(),
            principal_type: "user".to_string(),
            display_name: Some("Test User".to_string()),
            updated_at: chrono::Utc::now(),
            deleted_at: None,
            slug: slug.to_string(),
        }
    }

    fn create_test_collection(
        owner_id: uuid::Uuid,
        slug: &str,
        parent: Option<uuid::Uuid>,
    ) -> DavCollection {
        DavCollection {
            id: uuid::Uuid::new_v4(),
            owner_principal_id: owner_id,
            collection_type: "calendar".to_string(),
            display_name: Some("Test Collection".to_string()),
            description: None,
            timezone_tzid: None,
            synctoken: 1,
            updated_at: chrono::Utc::now(),
            deleted_at: None,
            supported_components: None,
            slug: slug.to_string(),
            parent_collection_id: parent,
        }
    }

    fn create_test_instance(collection_id: uuid::Uuid, slug: &str) -> DavInstance {
        DavInstance {
            id: uuid::Uuid::new_v4(),
            collection_id,
            entity_id: uuid::Uuid::new_v4(),
            content_type: "text/calendar".to_string(),
            slug: slug.to_string(),
            etag: "test-etag".to_string(),
            sync_revision: 1,
            last_modified: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            deleted_at: None,
            schedule_tag: None,
        }
    }

    #[test]
    fn test_build_canonical_location_with_all_entities_ics_extension() {
        use crate::component::auth::ResourceType;

        let principal = create_test_principal("alice");
        let collection = create_test_collection(principal.id, "work", None);
        let chain = CollectionChain::new(vec![collection.clone()]);
        let instance = create_test_instance(collection.id, "event-1");

        let canonical = build_canonical_location(
            Some(ResourceType::Calendar),
            &Some(principal.clone()),
            Some(&chain),
            &Some(instance.clone()),
            Some("event-1.ics"),
        );

        assert!(canonical.is_some());
        let loc = canonical.unwrap();
        let segments = loc.segments();
        assert_eq!(segments.len(), 4);
        assert!(matches!(
            segments[0],
            PathSegment::ResourceType(ResourceType::Calendar)
        ));
        assert!(matches!(&segments[1], PathSegment::Owner(s) if s == &principal.id.to_string()));
        assert!(
            matches!(&segments[2], PathSegment::Collection(s) if s == &collection.id.to_string())
        );
        // Item segment should have UUID with .ics extension
        if let PathSegment::Item(s) = &segments[3] {
            assert!(s.ends_with(".ics"));
            assert!(s.starts_with(&instance.id.to_string()));
        } else {
            panic!("Expected Item segment");
        }
    }

    #[test]
    fn test_build_canonical_location_with_vcf_extension() {
        use crate::component::auth::ResourceType;

        let principal = create_test_principal("bob");
        let collection = create_test_collection(principal.id, "contacts", None);
        let chain = CollectionChain::new(vec![collection.clone()]);
        let instance = create_test_instance(collection.id, "john-doe");

        let canonical = build_canonical_location(
            Some(ResourceType::Addressbook),
            &Some(principal.clone()),
            Some(&chain),
            &Some(instance.clone()),
            Some("john-doe.vcf"),
        );

        assert!(canonical.is_some());
        let loc = canonical.unwrap();
        let segments = loc.segments();
        assert_eq!(segments.len(), 4);
        assert!(matches!(
            segments[0],
            PathSegment::ResourceType(ResourceType::Addressbook)
        ));

        // Item segment should have UUID with .vcf extension
        if let PathSegment::Item(s) = &segments[3] {
            assert!(s.ends_with(".vcf"));
            assert!(s.starts_with(&instance.id.to_string()));
        } else {
            panic!("Expected Item segment");
        }
    }

    #[test]
    fn test_build_canonical_location_without_extension() {
        use crate::component::auth::ResourceType;

        let principal = create_test_principal("alice");
        let collection = create_test_collection(principal.id, "work", None);
        let chain = CollectionChain::new(vec![collection.clone()]);
        let instance = create_test_instance(collection.id, "event-1");

        let canonical = build_canonical_location(
            Some(ResourceType::Calendar),
            &Some(principal),
            Some(&chain),
            &Some(instance.clone()),
            Some("event-1"),
        );

        assert!(canonical.is_some());
        let loc = canonical.unwrap();
        let segments = loc.segments();
        assert_eq!(segments.len(), 4);

        // Item segment should be just the UUID without extension
        if let PathSegment::Item(s) = &segments[3] {
            assert_eq!(s, &instance.id.to_string());
        } else {
            panic!("Expected Item segment");
        }
    }

    #[test]
    fn test_build_canonical_location_no_filename() {
        use crate::component::auth::ResourceType;

        let principal = create_test_principal("alice");
        let collection = create_test_collection(principal.id, "work", None);
        let chain = CollectionChain::new(vec![collection.clone()]);
        let instance = create_test_instance(collection.id, "event-1");

        let canonical = build_canonical_location(
            Some(ResourceType::Calendar),
            &Some(principal),
            Some(&chain),
            &Some(instance.clone()),
            None,
        );

        assert!(canonical.is_some());
        let loc = canonical.unwrap();
        let segments = loc.segments();
        assert_eq!(segments.len(), 4);

        // Item segment should be just the UUID
        if let PathSegment::Item(s) = &segments[3] {
            assert_eq!(s, &instance.id.to_string());
        } else {
            panic!("Expected Item segment");
        }
    }

    #[test]
    fn test_build_canonical_location_collection_only() {
        use crate::component::auth::ResourceType;

        let principal = create_test_principal("alice");
        let collection = create_test_collection(principal.id, "work", None);
        let chain = CollectionChain::new(vec![collection.clone()]);

        let canonical = build_canonical_location(
            Some(ResourceType::Calendar),
            &Some(principal.clone()),
            Some(&chain),
            &None,
            None,
        );

        assert!(canonical.is_some());
        let loc = canonical.unwrap();
        let segments = loc.segments();
        assert_eq!(segments.len(), 3);
        assert!(matches!(
            segments[0],
            PathSegment::ResourceType(ResourceType::Calendar)
        ));
        assert!(matches!(&segments[1], PathSegment::Owner(s) if s == &principal.id.to_string()));
        assert!(
            matches!(&segments[2], PathSegment::Collection(s) if s == &collection.id.to_string())
        );
    }

    #[test]
    fn test_build_canonical_location_principal_only() {
        use crate::component::auth::ResourceType;

        let principal = create_test_principal("alice");

        let canonical = build_canonical_location(
            Some(ResourceType::Calendar),
            &Some(principal.clone()),
            None,
            &None,
            None,
        );

        assert!(canonical.is_some());
        let loc = canonical.unwrap();
        let segments = loc.segments();
        assert_eq!(segments.len(), 2);
        assert!(matches!(
            segments[0],
            PathSegment::ResourceType(ResourceType::Calendar)
        ));
        assert!(matches!(&segments[1], PathSegment::Owner(s) if s == &principal.id.to_string()));
    }
    #[test]
    fn test_build_canonical_location_empty_chain() {
        use crate::component::auth::ResourceType;

        let principal = create_test_principal("alice");
        let chain = CollectionChain::new(vec![]);

        let canonical = build_canonical_location(
            Some(ResourceType::Calendar),
            &Some(principal),
            Some(&chain),
            &None,
            None,
        );

        // Should behave as if no collection is present
        assert!(canonical.is_some());
        let loc = canonical.unwrap();
        let segments = loc.segments();
        assert_eq!(segments.len(), 2);
    }

    #[test]
    fn test_build_canonical_location_multi_level_chain() {
        use crate::component::auth::ResourceType;

        let principal = create_test_principal("alice");
        let root = create_test_collection(principal.id, "root", None);
        let child = create_test_collection(principal.id, "child", Some(root.id));
        let leaf = create_test_collection(principal.id, "leaf", Some(child.id));
        let chain = CollectionChain::new(vec![root.clone(), child.clone(), leaf.clone()]);
        let instance = create_test_instance(leaf.id, "event-1");

        let canonical = build_canonical_location(
            Some(ResourceType::Calendar),
            &Some(principal),
            Some(&chain),
            &Some(instance),
            Some("event-1.ics"),
        );

        assert!(canonical.is_some());
        let loc = canonical.unwrap();
        let segments = loc.segments();
        assert_eq!(segments.len(), 4);
        // The collection segment should be the leaf
        assert!(matches!(&segments[2], PathSegment::Collection(s) if s == &leaf.id.to_string()));
    }

    #[test]
    fn test_build_canonical_location_missing_principal() {
        use crate::component::auth::ResourceType;

        let canonical =
            build_canonical_location(Some(ResourceType::Calendar), &None, None, &None, None);

        assert!(canonical.is_none());
    }

    #[test]
    fn test_build_canonical_location_missing_resource_type() {
        let principal = create_test_principal("alice");
        let collection = create_test_collection(principal.id, "work", None);
        let chain = CollectionChain::new(vec![collection.clone()]);

        let canonical = build_canonical_location(None, &Some(principal), Some(&chain), &None, None);

        assert!(canonical.is_none());
    }

    #[test]
    fn test_build_canonical_location_instance_without_collection() {
        use crate::component::auth::ResourceType;

        let principal = create_test_principal("alice");
        let instance = create_test_instance(uuid::Uuid::new_v4(), "event-1");

        // Instance without collection should not create a canonical location
        let canonical = build_canonical_location(
            Some(ResourceType::Calendar),
            &Some(principal),
            None,
            &Some(instance),
            None,
        );

        // Should still work but without the instance segment
        assert!(canonical.is_some());
        let loc = canonical.unwrap();
        let segments = loc.segments();
        assert_eq!(segments.len(), 2); // Only resource type and owner
    }
}
