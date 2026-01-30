//! Resource paths for authorization.
//!
//! The new authorization model uses path-based permissions with glob matching.
//! Resources are identified by their path components, which can be converted to
//! path strings for Casbin enforcement.

use crate::error::{ServiceError, ServiceResult};
use shuriken_core::constants::{
    CALDAV_ROUTE_COMPONENT, CARDDAV_ROUTE_COMPONENT, DAV_ROUTE_PREFIX, PRINCIPAL_ROUTE_COMPONENT,
};

/// Resource type for DAV collections.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ResourceType {
    /// Calendar collection (`/calendars/...`).
    Calendar,
    /// Addressbook collection (`/addressbooks/...`).
    Addressbook,
    /// Principal (user, group, etc.) resource.
    Principal,
}

impl ResourceType {
    /// Returns the path segment for this resource type.
    #[must_use]
    pub const fn as_path_segment(&self) -> &'static str {
        match self {
            Self::Calendar => CALDAV_ROUTE_COMPONENT,
            Self::Addressbook => CARDDAV_ROUTE_COMPONENT,
            Self::Principal => PRINCIPAL_ROUTE_COMPONENT,
        }
    }

    /// Parse a path segment into a resource type.
    #[must_use]
    pub fn from_path_segment(s: &str) -> Option<Self> {
        match s {
            CALDAV_ROUTE_COMPONENT => Some(Self::Calendar),
            CARDDAV_ROUTE_COMPONENT => Some(Self::Addressbook),
            PRINCIPAL_ROUTE_COMPONENT => Some(Self::Principal),
            _ => None,
        }
    }

    // Get the extension for items of this resource type.
    #[must_use]
    pub const fn item_extension(&self) -> &'static str {
        match self {
            Self::Calendar => "ics",
            Self::Addressbook => "vcf",
            Self::Principal => "",
        }
    }
}

// TODO: Structurally separate Glob from the normal segments so that it is impossible to accidentally have in non-auth uses

/// A segment in a resource path.
///
/// Paths are composed of segments that identify the resource type, owner,
/// collection, items, or glob patterns.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum PathSegment {
    /// Resource type (calendars or addressbooks).
    ResourceType(ResourceType),
    /// Owner/principal name (e.g., "alice", "principal:abc-123").
    Owner(String),
    /// Collection name (e.g., "personal", "work").
    Collection(String),
    /// Item filename (e.g., "event.ics", "contact.vcf").
    Item(String),
    /// Glob pattern - `*` (single level) or `**` (recursive).
    Glob { recursive: bool },
}

impl PathSegment {
    /// Returns `true` if this segment should end a path (item or glob).
    #[must_use]
    pub const fn is_terminal(&self) -> bool {
        matches!(self, Self::Item(_) | Self::Glob { .. })
    }
}

/// A resource identifier for authorization.
///
/// Represents a path as a sequence of segments that can be converted to/from
/// path strings for Casbin enforcement.
///
/// ## Examples
///
/// - `/calendars/alice/personal/work.ics` → `[ResourceType(Calendar), Owner("alice"), Collection("personal"), Item("work.ics")]`
/// - `/calendars/alice/**` → `[ResourceType(Calendar), Owner("alice"), Glob { recursive: true }]`
/// - `/addressbooks/bob/contacts/*` → `[ResourceType(Addressbook), Owner("bob"), Collection("contacts"), Glob { recursive: false }]`
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ResourceLocation {
    segments: Vec<PathSegment>,
}

impl ResourceLocation {
    /// Create a new resource identifier from path segments.
    #[must_use]
    pub fn from_segments(segments: Vec<PathSegment>) -> Self {
        Self { segments }
    }

    /// Create a resource location for a principal (owner only).
    #[must_use]
    pub fn from_segments_principal(resource_type: ResourceType, owner: String) -> Self {
        let segments = vec![
            PathSegment::ResourceType(resource_type),
            PathSegment::Owner(owner),
        ];
        Self { segments }
    }

    /// Create a resource location for a collection.
    #[must_use]
    pub fn from_segments_collection(
        resource_type: ResourceType,
        owner: String,
        collection: &str,
    ) -> Self {
        let mut segments = Vec::with_capacity(3);
        segments.push(PathSegment::ResourceType(resource_type));
        segments.push(PathSegment::Owner(owner));
        // Split collection path into multiple segments if needed
        for col in collection.split('/').filter(|s| !s.is_empty()) {
            segments.push(PathSegment::Collection(col.to_string()));
        }
        Self { segments }
    }

    /// Create a resource location for an item.
    #[must_use]
    pub fn from_segments_item(
        resource_type: ResourceType,
        owner: String,
        collection: &str,
        item: String,
    ) -> Self {
        let mut segments = Vec::with_capacity(4);
        segments.push(PathSegment::ResourceType(resource_type));
        segments.push(PathSegment::Owner(owner));
        // Split collection path into multiple segments if needed
        for col in collection.split('/').filter(|s| !s.is_empty()) {
            segments.push(PathSegment::Collection(col.to_string()));
        }
        segments.push(PathSegment::Item(item));
        Self { segments }
    }

    /// Create a resource location for a glob pattern on an owner (e.g., `/cal/alice/**`).
    #[must_use]
    pub fn from_segments_owner_glob(
        resource_type: ResourceType,
        owner: String,
        recursive: bool,
    ) -> Self {
        let segments = vec![
            PathSegment::ResourceType(resource_type),
            PathSegment::Owner(owner),
            PathSegment::Glob { recursive },
        ];
        Self { segments }
    }

    /// Create a resource location for a glob pattern on a collection (e.g., `/cal/alice/work/**`).
    #[must_use]
    pub fn from_segments_collection_glob(
        resource_type: ResourceType,
        owner: String,
        collection: &str,
        recursive: bool,
    ) -> Self {
        let mut segments = Vec::with_capacity(4);
        segments.push(PathSegment::ResourceType(resource_type));
        segments.push(PathSegment::Owner(owner));
        // Split collection path into multiple segments if needed
        for col in collection.split('/').filter(|s| !s.is_empty()) {
            segments.push(PathSegment::Collection(col.to_string()));
        }
        segments.push(PathSegment::Glob { recursive });
        Self { segments }
    }

    /// Parse a path string into a resource identifier.
    ///
    /// ## Examples
    ///
    /// ```ignore
    /// let resource = ResourceId::parse("/calendars/alice/personal/work.ics");
    /// let resource = ResourceId::parse("/calendars/alice/**");
    /// let resource = ResourceId::parse("/addressbooks/bob/contacts/*");
    /// let resource = ResourceId::parse("/calendars/team/shared/");
    /// ```
    ///
    /// ## Returns
    ///
    /// `None` if the path is invalid or doesn't start with a recognized resource type.
    #[must_use]
    pub fn parse(path: &str) -> Option<Self> {
        let path = path.strip_prefix('/').unwrap_or(path);
        if path.is_empty() {
            return None;
        }

        let parts: Vec<&str> = path.split('/').collect();
        if parts.is_empty() {
            return None;
        }

        let mut segments = Vec::new();

        // First segment must be resource type
        let resource_type = ResourceType::from_path_segment(parts[0])?;
        segments.push(PathSegment::ResourceType(resource_type));

        // Parse remaining segments
        for (i, part) in parts.iter().enumerate().skip(1) {
            if part.is_empty() {
                continue;
            }

            // Rules:
            // - Owner is always second segment
            // - Collection(s) follow owner
            // - Item or glob can be last segment
            if i == 1 {
                // Owner segment
                segments.push(PathSegment::Owner(part.to_string()));
                continue;
            }

            if *part == "**" {
                // Recursive glob must terminate the path
                if i + 1 != parts.len() {
                    return None;
                }
                segments.push(PathSegment::Glob { recursive: true });
                break;
            }

            if *part == "*" {
                // Single-level glob must terminate the path
                if i + 1 != parts.len() {
                    return None;
                }
                segments.push(PathSegment::Glob { recursive: false });
                break;
            }

            if i == parts.len() - 1 {
                // Last segment - could be item or collection
                if part.ends_with('/') {
                    // Collection (trailing slash)
                    let col_name = part.trim_end_matches('/').to_string();
                    segments.push(PathSegment::Collection(col_name));
                } else {
                    // Item
                    segments.push(PathSegment::Item(part.to_string()));
                }
                continue;
            }

            // Collection segment; reject likely item-looking segments that are not terminal
            if part.contains('.') {
                return None;
            }

            segments.push(PathSegment::Collection(part.to_string()));
        }

        Some(Self { segments })
    }

    /// Convert the resource identifier to a path string for Casbin enforcement.
    ///
    /// ## Errors
    /// Returns error if glob patterns are not allowed but glob wildcards are present.
    ///
    /// ## Examples
    ///
    /// ```ignore
    /// let resource = ResourceId::parse("/calendars/alice/personal/work.ics").unwrap();
    /// assert_eq!(resource.to_path(), "/calendars/alice/personal/work.ics");
    /// ```
    pub fn to_resource_path(&self, allow_glob: bool) -> ServiceResult<String> {
        let mut path = String::from("/");
        for (i, segment) in self.segments.iter().enumerate() {
            match segment {
                PathSegment::ResourceType(rt) => path.push_str(rt.as_path_segment()),
                PathSegment::Owner(owner) => path.push_str(owner),
                PathSegment::Collection(col) => path.push_str(col),
                PathSegment::Item(item) => path.push_str(item),
                PathSegment::Glob { recursive } => {
                    if !allow_glob {
                        // Should not serialize glob segments if not allowed
                        return Err(ServiceError::ParseError(
                            "Cannot serialize glob segment in resource path".to_string(),
                        ));
                    }
                    if *recursive {
                        path.push_str("**");
                    } else {
                        path.push('*');
                    }
                }
            }
            if segment.is_terminal() {
                if i + 1 < self.segments.len() {
                    // Terminal segment must be last
                    tracing::warn!(
                        "Warning: Terminal segment {:?} is not last in resource {:?}",
                        segment,
                        self
                    );
                }
                break;
            }
            path.push('/');
        }
        Ok(path)
    }

    /// ## Errors
    /// Returns error if path cannot be constructed.
    pub fn to_full_path(&self) -> ServiceResult<String> {
        let path = self.to_resource_path(false)?;
        Ok(format!("{DAV_ROUTE_PREFIX}{path}"))
    }

    /// ## Errors
    /// Returns error if full path cannot be constructed.
    pub fn to_url(&self, serve_origin: &str) -> ServiceResult<String> {
        let path = self.to_full_path()?;
        Ok(format!("{}{}", serve_origin.trim_end_matches('/'), path))
    }

    /// Returns the segments of this resource path.
    #[must_use]
    pub fn segments(&self) -> &[PathSegment] {
        &self.segments
    }

    /// Returns the resource type if present in the path.
    #[must_use]
    pub fn resource_type(&self) -> Option<ResourceType> {
        let seg = self.segments.first()?;
        if let PathSegment::ResourceType(rt) = seg {
            Some(*rt)
        } else {
            None
        }
    }

    /// Returns the owner if present in the path.
    #[must_use]
    pub fn owner(&self) -> Option<&str> {
        self.segments.iter().find_map(|seg| {
            if let PathSegment::Owner(owner) = seg {
                Some(owner.as_str())
            } else {
                None
            }
        })
    }
}

impl std::fmt::Display for ResourceLocation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}",
            self.to_resource_path(false)
                .unwrap_or_else(|_| "<invalid path>".to_string())
        )
    }
}

impl From<Vec<PathSegment>> for ResourceLocation {
    fn from(segments: Vec<PathSegment>) -> Self {
        Self::from_segments(segments)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use shuriken_core::constants::DAV_ROUTE_PREFIX;

    /// Helper to build a calendar resource path segment.
    fn cal(suffix: &str) -> String {
        format!("/{CALDAV_ROUTE_COMPONENT}/{suffix}")
    }

    /// Helper to build a card resource path segment.
    fn card(suffix: &str) -> String {
        format!("/{CARDDAV_ROUTE_COMPONENT}/{suffix}")
    }

    /// Helper to build a full DAV path from a resource path.
    fn full_path(resource_path: &str) -> String {
        format!("{DAV_ROUTE_PREFIX}{resource_path}")
    }

    #[test]
    fn parse_simple_path() {
        let path = cal("alice/personal/work.ics");
        let resource = ResourceLocation::parse(&path).unwrap();
        assert_eq!(resource.segments().len(), 4);
        assert_eq!(resource.resource_type(), Some(ResourceType::Calendar));
        assert_eq!(resource.owner(), Some("alice"));
        assert_eq!(resource.to_full_path().unwrap(), full_path(&path));
    }

    #[test]
    fn parse_recursive_glob() {
        let path = cal("alice/**");
        let resource = ResourceLocation::parse(&path).unwrap();
        assert_eq!(resource.segments().len(), 3);
        assert_eq!(
            resource.segments()[2],
            PathSegment::Glob { recursive: true }
        );
        // Use to_resource_path with allow_glob=true for glob segments
        let resource_path = resource.to_resource_path(true).unwrap();
        assert_eq!(
            format!("{DAV_ROUTE_PREFIX}{resource_path}"),
            full_path(&path)
        );
    }

    #[test]
    fn parse_single_glob() {
        let path = card("bob/contacts/*");
        let resource = ResourceLocation::parse(&path).unwrap();
        assert_eq!(resource.segments().len(), 4);
        assert_eq!(
            resource.segments()[3],
            PathSegment::Glob { recursive: false }
        );
        // Use to_resource_path with allow_glob=true for glob segments
        let resource_path = resource.to_resource_path(true).unwrap();
        assert_eq!(
            format!("{DAV_ROUTE_PREFIX}{resource_path}"),
            full_path(&path)
        );
    }

    #[test]
    fn parse_addressbook_path() {
        let path = card("charlie/work/contact.vcf");
        let resource = ResourceLocation::parse(&path).unwrap();
        assert_eq!(resource.resource_type(), Some(ResourceType::Addressbook));
        assert_eq!(resource.owner(), Some("charlie"));
        assert_eq!(resource.to_full_path().unwrap(), full_path(&path));
    }

    #[test]
    fn roundtrip_conversion() {
        let paths = [
            cal("alice/personal/work.ics"),
            cal("bob/**"),
            card("charlie/contacts/*"),
            cal("team/shared/meeting.ics"),
            cal("team/shared/"),
        ];

        for path in paths {
            let resource = ResourceLocation::parse(&path).unwrap();
            assert_eq!(
                resource.to_resource_path(true).unwrap(),
                path,
                "Roundtrip failed for {path}"
            );
        }
    }

    #[test]
    fn create_from_segments_glob() {
        let resource = ResourceLocation::from_segments(vec![
            PathSegment::ResourceType(ResourceType::Calendar),
            PathSegment::Owner("alice".to_string()),
            PathSegment::Collection("personal".to_string()),
            PathSegment::Glob { recursive: true },
        ]);
        let expected = cal("alice/personal/**");
        assert_eq!(resource.to_resource_path(true).unwrap(), expected);
    }

    #[test]
    fn create_from_segments_item() {
        let resource = ResourceLocation::from_segments(vec![
            PathSegment::ResourceType(ResourceType::Calendar),
            PathSegment::Owner("alice".to_string()),
            PathSegment::Collection("personal".to_string()),
            PathSegment::Item("work.ics".to_string()),
        ]);
        let expected = cal("alice/personal/work.ics");
        assert_eq!(resource.to_resource_path(false).unwrap(), expected);
    }

    #[test]
    fn create_from_segments_collection() {
        let resource = ResourceLocation::from_segments(vec![
            PathSegment::ResourceType(ResourceType::Addressbook),
            PathSegment::Owner("bob".to_string()),
            PathSegment::Collection("contacts".to_string()),
        ]);
        let expected = card("bob/contacts/");
        assert_eq!(resource.to_resource_path(false).unwrap(), expected);
    }

    #[test]
    fn invalid_path_returns_none() {
        assert!(ResourceLocation::parse("").is_none());
        assert!(ResourceLocation::parse("/").is_none());
        assert!(ResourceLocation::parse("/invalid").is_none());
    }

    #[test]
    fn glob_must_be_terminal() {
        let path1 = cal("alice/**/extra");
        let path2 = cal("alice/*/extra");
        assert!(ResourceLocation::parse(&path1).is_none());
        assert!(ResourceLocation::parse(&path2).is_none());
    }

    #[test]
    fn item_must_be_terminal() {
        let path = cal("alice/work.ics/extra");
        assert!(ResourceLocation::parse(&path).is_none());
    }
}
