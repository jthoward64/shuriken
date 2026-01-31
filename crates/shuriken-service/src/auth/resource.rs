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

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum ResourceIdentifier {
    Slug(String),
    Id(uuid::Uuid),
}

impl std::fmt::Display for ResourceIdentifier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ResourceIdentifier::Slug(s) => write!(f, "{}", s),
            ResourceIdentifier::Id(id) => write!(f, "{}", id),
        }
    }
}

/// A segment in a resource path.
///
/// Paths are composed of segments that identify the resource type, owner,
/// collection, items, or glob patterns.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum PathSegment {
    /// Resource type (calendars or addressbooks).
    ResourceType(ResourceType),
    /// Owner/principal name (e.g., "alice", "principal:abc-123").
    Owner(ResourceIdentifier),
    /// Collection name (e.g., "personal", "work").
    Collection(ResourceIdentifier),
    /// Item filename (e.g., "event.ics", "contact.vcf").
    Item(ResourceIdentifier),
    /// Glob pattern - `*` (single level) or `**` (recursive).
    Glob { recursive: bool },
}

impl PathSegment {
    /// Returns `true` if this segment should end a path (item or glob).
    #[must_use]
    pub const fn is_terminal(&self) -> bool {
        matches!(self, Self::Item(_) | Self::Glob { .. })
    }

    #[must_use]
    pub const fn owner_from_slug(s: String) -> Self {
        Self::Owner(ResourceIdentifier::Slug(s))
    }

    #[must_use]
    pub const fn collection_from_slug(s: String) -> Self {
        Self::Collection(ResourceIdentifier::Slug(s))
    }

    #[must_use]
    pub const fn item_from_slug(s: String) -> Self {
        Self::Item(ResourceIdentifier::Slug(s))
    }

    #[must_use]
    pub const fn item_from_id(id: uuid::Uuid) -> Self {
        Self::Item(ResourceIdentifier::Id(id))
    }

    #[must_use]
    pub const fn collection_from_id(id: uuid::Uuid) -> Self {
        Self::Collection(ResourceIdentifier::Id(id))
    }

    #[must_use]
    pub const fn owner_from_id(id: uuid::Uuid) -> Self {
        Self::Owner(ResourceIdentifier::Id(id))
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

pub enum ResourceLocationStringBuilderOutputType {
    Unset,
    Path,
    FullPath,
    Url(String),
}

pub struct ResourceLocationStringBuilder {
    resource_location: ResourceLocation,
    include_extension: bool,
    output_type: ResourceLocationStringBuilderOutputType,
    allow_glob: bool,
}

impl ResourceLocation {
    /// Create a new resource identifier from path segments.
    #[must_use]
    pub fn from_segments(segments: Vec<PathSegment>) -> ServiceResult<Self> {
        if segments.len() < 2 {
            return Err(ServiceError::ParseError(
                "Resource path must have at least resource type and owner".to_string(),
            ));
        }
        let resource_type = match &segments[0] {
            PathSegment::ResourceType(rt) => rt,
            _ => {
                return Err(ServiceError::ParseError(
                    "First segment of resource path must be resource type".to_string(),
                ));
            }
        };
        match &segments[1] {
            PathSegment::Owner(owner) => owner,
            _ => {
                return Err(ServiceError::ParseError(format!(
                    "Second segment of resource path must be owner/principal for resource type {:?}",
                    resource_type
                )));
            }
        };
        // Make sure all remaining segments are either collections, or are the last segment and are an item or glob
        for (i, segment) in segments.iter().enumerate().skip(2) {
            if i == segments.len() - 1 {
                // Last segment can be item or glob
                match segment {
                    PathSegment::Collection(_)
                    | PathSegment::Item(_)
                    | PathSegment::Glob { .. } => {}
                    _ => {
                        return Err(ServiceError::ParseError(
                            "Last segment of resource path must be collection, item, or glob"
                                .to_string(),
                        ));
                    }
                }
            } else {
                // Intermediate segments must be collections
                match segment {
                    PathSegment::Collection(_) => {}
                    _ => {
                        return Err(ServiceError::ParseError(
                            "Intermediate segments of resource path must be collections"
                                .to_string(),
                        ));
                    }
                }
            }
        }
        Ok(Self { segments })
    }

    /// Parse a path string into a resource identifier.
    ///
    /// ## Examples
    ///
    /// ```ignore
    /// let resource = ResourceLocation::parse("/calendars/alice/personal/work.ics");
    /// let resource = ResourceLocation::parse("/calendars/alice/**");
    /// let resource = ResourceLocation::parse("/addressbooks/bob/contacts/*");
    /// let resource = ResourceLocation::parse("/calendars/team/shared/");
    /// ```
    ///
    /// Should only be used for parsing raw strings from the outside world.
    /// For internal usage, prefer constructing `ResourceLocation` via `from_segments`.
    ///
    /// ## Returns
    ///
    /// `None` if the path is invalid or doesn't start with a recognized resource type.
    #[must_use]
    pub fn parse(path: &str, allow_glob: bool) -> ServiceResult<Self> {
        let path = path.strip_prefix('/').unwrap_or(path);
        if path.is_empty() {
            return Err(ServiceError::ParseError(
                "Resource path cannot be empty".to_string(),
            ));
        }

        let parts: Vec<&str> = path.split('/').collect();
        if parts.is_empty() {
            return Err(ServiceError::ParseError(
                "Resource path cannot be empty".to_string(),
            ));
        }

        let mut segments = Vec::new();

        // First segment must be resource type
        let resource_type = ResourceType::from_path_segment(parts[0]).ok_or_else(|| {
            ServiceError::ParseError(format!("Invalid resource type segment: {}", parts[0]))
        })?;
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
                segments.push(match part.parse::<uuid::Uuid>() {
                    Ok(id) => PathSegment::owner_from_id(id),
                    Err(_) => PathSegment::owner_from_slug(part.to_string()),
                });
                continue;
            }

            if *part == "**" || *part == "*" {
                if !allow_glob {
                    return Err(ServiceError::ParseError(
                        "Glob segments are not allowed in this context".to_string(),
                    ));
                }
                // Glob must terminate the path
                if i + 1 != parts.len() {
                    return Err(ServiceError::ParseError(
                        "Glob must terminate the path".to_string(),
                    ));
                }
                segments.push(PathSegment::Glob {
                    recursive: *part == "**",
                });
                break;
            }

            // TODO: Add validation in the route handlers that parse slugs to make sure they are not valid uuids

            if i == parts.len() - 1 {
                // Last segment - could be item or collection
                if part.ends_with('/') {
                    // Collection (trailing slash)
                    let col_name = part.trim_end_matches('/').to_string();
                    segments.push(match col_name.parse::<uuid::Uuid>() {
                        Ok(id) => PathSegment::collection_from_id(id),
                        Err(_) => PathSegment::collection_from_slug(col_name),
                    });
                } else {
                    // Item
                    segments.push(match part.parse::<uuid::Uuid>() {
                        Ok(id) => PathSegment::item_from_id(id),
                        Err(_) => PathSegment::item_from_slug(part.to_string()),
                    });
                }
                continue;
            }

            // Collection segment; reject likely item-looking segments that are not terminal
            if part.contains('.') {
                return Err(ServiceError::ParseError(
                    "Item segments must terminate the path".to_string(),
                ));
            }

            segments.push(match part.parse::<uuid::Uuid>() {
                Ok(id) => PathSegment::collection_from_id(id),
                Err(_) => PathSegment::collection_from_slug(part.to_string()),
            });
        }

        Ok(Self { segments })
    }

    #[must_use]
    pub fn serialize(&self) -> ResourceLocationStringBuilder {
        ResourceLocationStringBuilder {
            resource_location: self.clone(),
            include_extension: false,
            output_type: ResourceLocationStringBuilderOutputType::Unset,
            allow_glob: false,
        }
    }

    /// Serialize to a path (e.g., "/calendars/alice/personal").
    #[must_use]
    pub fn serialize_to_path(
        &self,
        include_extension: bool,
        allow_glob: bool,
    ) -> ServiceResult<String> {
        self.serialize()
            .include_extension(include_extension)
            .allow_glob(allow_glob)
            .output_type(ResourceLocationStringBuilderOutputType::Path)
            .build()
    }

    /// Serialize to a full path with DAV prefix (e.g., "/dav/calendars/alice/personal").
    #[must_use]
    pub fn serialize_to_full_path(
        &self,
        include_extension: bool,
        allow_glob: bool,
    ) -> ServiceResult<String> {
        self.serialize()
            .include_extension(include_extension)
            .allow_glob(allow_glob)
            .output_type(ResourceLocationStringBuilderOutputType::FullPath)
            .build()
    }

    /// Serialize to a URL (e.g., "https://example.com/dav/calendars/alice/personal").
    #[must_use]
    pub fn serialize_to_url(
        &self,
        serve_origin: &str,
        include_extension: bool,
        allow_glob: bool,
    ) -> ServiceResult<String> {
        self.serialize()
            .include_extension(include_extension)
            .allow_glob(allow_glob)
            .output_type(ResourceLocationStringBuilderOutputType::Url(
                serve_origin.to_string(),
            ))
            .build()
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
    pub fn owner(&self) -> Option<ResourceIdentifier> {
        self.segments.iter().find_map(|seg| {
            if let PathSegment::Owner(owner) = seg {
                Some(owner.clone())
            } else {
                None
            }
        })
    }
}

impl TryFrom<Vec<PathSegment>> for ResourceLocation {
    fn try_from(segments: Vec<PathSegment>) -> ServiceResult<Self> {
        Self::from_segments(segments)
    }

    type Error = ServiceError;
}

impl ResourceLocationStringBuilder {
    /// Include extension in the output.
    pub fn include_extension(&mut self, include: bool) -> &mut Self {
        self.include_extension = include;
        self
    }

    /// Set output type.
    pub fn output_type(
        &mut self,
        output_type: ResourceLocationStringBuilderOutputType,
    ) -> &mut Self {
        self.output_type = output_type;
        self
    }

    /// Set whether glob segments are allowed.
    pub fn allow_glob(&mut self, allow: bool) -> &mut Self {
        self.allow_glob = allow;
        self
    }

    /// Build the string representation.
    pub fn build(&self) -> ServiceResult<String> {
        let mut path = String::new();
        for (i, segment) in self.resource_location.segments.iter().enumerate() {
            match segment {
                PathSegment::ResourceType(rt) => path.push_str(rt.as_path_segment()),
                PathSegment::Owner(owner) => match owner {
                    ResourceIdentifier::Slug(s) => path.push_str(s),
                    ResourceIdentifier::Id(id) => path.push_str(&id.to_string()),
                },
                PathSegment::Collection(col) => match col {
                    ResourceIdentifier::Slug(s) => path.push_str(s),
                    ResourceIdentifier::Id(id) => path.push_str(&id.to_string()),
                },
                PathSegment::Item(item) => match item {
                    ResourceIdentifier::Slug(s) => path.push_str(s),
                    ResourceIdentifier::Id(id) => path.push_str(&id.to_string()),
                },
                PathSegment::Glob { recursive } => {
                    if !self.allow_glob {
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
                if i + 1 < self.resource_location.segments.len() {
                    // Terminal segment must be last
                    tracing::warn!(
                        "Warning: Terminal segment {:?} is not last in resource {:?}",
                        segment,
                        self.resource_location
                    );
                }
                break;
            }
            path.push('/');
        }
        if self.include_extension {
            if let Some(PathSegment::Item(_)) = self.resource_location.segments.last() {
                if let Some(rt) = self.resource_location.resource_type() {
                    let ext = rt.item_extension();
                    if !ext.is_empty() && !path.ends_with(ext) {
                        path.push('.');
                        path.push_str(ext);
                    }
                }
            }
        }

        match self.output_type {
            ResourceLocationStringBuilderOutputType::Path => Ok(format!("/{path}")),
            ResourceLocationStringBuilderOutputType::FullPath => {
                Ok(format!("{DAV_ROUTE_PREFIX}/{path}"))
            }
            ResourceLocationStringBuilderOutputType::Url(ref serve_origin) => Ok(format!(
                "{}{DAV_ROUTE_PREFIX}/{path}",
                serve_origin.trim_end_matches('/')
            )),
            ResourceLocationStringBuilderOutputType::Unset => Err(ServiceError::ParseError(
                "Output type not set for ResourceLocationStringBuilder".to_string(),
            )),
        }
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

    /// Helper to build a principal resource path segment.
    fn principal(suffix: &str) -> String {
        format!("/{PRINCIPAL_ROUTE_COMPONENT}/{suffix}")
    }

    /// Helper to build a full DAV path from a resource path.
    fn full_path(resource_path: &str) -> String {
        format!("{DAV_ROUTE_PREFIX}{resource_path}")
    }

    // ========================================================================
    // ResourceType Tests
    // ========================================================================

    #[test]
    fn resource_type_path_segments() {
        assert_eq!(
            ResourceType::Calendar.as_path_segment(),
            CALDAV_ROUTE_COMPONENT
        );
        assert_eq!(
            ResourceType::Addressbook.as_path_segment(),
            CARDDAV_ROUTE_COMPONENT
        );
        assert_eq!(
            ResourceType::Principal.as_path_segment(),
            PRINCIPAL_ROUTE_COMPONENT
        );
    }

    #[test]
    fn resource_type_from_path_segment() {
        assert_eq!(
            ResourceType::from_path_segment(CALDAV_ROUTE_COMPONENT),
            Some(ResourceType::Calendar)
        );
        assert_eq!(
            ResourceType::from_path_segment(CARDDAV_ROUTE_COMPONENT),
            Some(ResourceType::Addressbook)
        );
        assert_eq!(
            ResourceType::from_path_segment(PRINCIPAL_ROUTE_COMPONENT),
            Some(ResourceType::Principal)
        );
        assert_eq!(ResourceType::from_path_segment("invalid"), None);
    }

    #[test]
    fn resource_type_extensions() {
        assert_eq!(ResourceType::Calendar.item_extension(), "ics");
        assert_eq!(ResourceType::Addressbook.item_extension(), "vcf");
        assert_eq!(ResourceType::Principal.item_extension(), "");
    }

    // ========================================================================
    // ResourceIdentifier Tests
    // ========================================================================

    #[test]
    fn resource_identifier_display_slug() {
        let slug = ResourceIdentifier::Slug("alice".to_string());
        assert_eq!(slug.to_string(), "alice");

        let id = uuid::Uuid::new_v4();
        let id_identifier = ResourceIdentifier::Id(id);
        assert_eq!(id_identifier.to_string(), id.to_string());
    }

    #[test]
    fn resource_identifier_display_id() {
        let id = uuid::Uuid::new_v4();
        let id_identifier = ResourceIdentifier::Id(id);
        assert_eq!(id_identifier.to_string(), id.to_string());
    }

    // ========================================================================
    // PathSegment Tests
    // ========================================================================

    #[test]
    fn path_segment_is_terminal() {
        assert!(!PathSegment::ResourceType(ResourceType::Calendar).is_terminal());
        assert!(!PathSegment::owner_from_slug("alice".to_string()).is_terminal());
        assert!(!PathSegment::collection_from_slug("personal".to_string()).is_terminal());
        assert!(PathSegment::item_from_slug("work.ics".to_string()).is_terminal());
        assert!(PathSegment::Glob { recursive: true }.is_terminal());
        assert!(PathSegment::Glob { recursive: false }.is_terminal());
    }

    #[test]
    fn path_segment_constructors() {
        // Slug constructors
        let owner = PathSegment::owner_from_slug("alice".to_string());
        assert!(matches!(
            owner,
            PathSegment::Owner(ResourceIdentifier::Slug(_))
        ));

        let collection = PathSegment::collection_from_slug("personal".to_string());
        assert!(matches!(
            collection,
            PathSegment::Collection(ResourceIdentifier::Slug(_))
        ));

        let item = PathSegment::item_from_slug("work.ics".to_string());
        assert!(matches!(
            item,
            PathSegment::Item(ResourceIdentifier::Slug(_))
        ));

        // ID constructors
        let id = uuid::Uuid::new_v4();
        let owner_id = PathSegment::owner_from_id(id);
        assert!(matches!(
            owner_id,
            PathSegment::Owner(ResourceIdentifier::Id(_))
        ));

        let collection_id = PathSegment::collection_from_id(id);
        assert!(matches!(
            collection_id,
            PathSegment::Collection(ResourceIdentifier::Id(_))
        ));

        let item_id = PathSegment::item_from_id(id);
        assert!(matches!(
            item_id,
            PathSegment::Item(ResourceIdentifier::Id(_))
        ));
    }

    // ========================================================================
    // ResourceLocation Parsing Tests
    // ========================================================================

    #[test]
    fn parse_calendar_item_path() {
        let path = cal("alice/personal/work.ics");
        let resource = ResourceLocation::parse(&path, false).unwrap();

        assert_eq!(resource.segments().len(), 4);
        assert_eq!(resource.resource_type(), Some(ResourceType::Calendar));

        // Check owner
        let owner = resource.owner().unwrap();
        assert!(matches!(owner, ResourceIdentifier::Slug(s) if s == "alice"));

        // Check segments
        assert!(matches!(
            &resource.segments()[0],
            PathSegment::ResourceType(ResourceType::Calendar)
        ));
        assert!(matches!(
            &resource.segments()[1],
            PathSegment::Owner(ResourceIdentifier::Slug(s)) if s == "alice"
        ));
        assert!(matches!(
            &resource.segments()[2],
            PathSegment::Collection(ResourceIdentifier::Slug(s)) if s == "personal"
        ));
        assert!(matches!(
            &resource.segments()[3],
            PathSegment::Item(ResourceIdentifier::Slug(s)) if s == "work.ics"
        ));
    }

    #[test]
    fn parse_addressbook_item_path() {
        let path = card("charlie/work/contact.vcf");
        let resource = ResourceLocation::parse(&path, false).unwrap();

        assert_eq!(resource.segments().len(), 4);
        assert_eq!(resource.resource_type(), Some(ResourceType::Addressbook));

        let owner = resource.owner().unwrap();
        assert!(matches!(owner, ResourceIdentifier::Slug(s) if s == "charlie"));
    }

    #[test]
    fn parse_principal_path() {
        let path = principal("alice");
        let resource = ResourceLocation::parse(&path, false).unwrap();

        assert_eq!(resource.segments().len(), 2);
        assert_eq!(resource.resource_type(), Some(ResourceType::Principal));
    }

    #[test]
    fn parse_collection_path_with_trailing_slash() {
        let path = cal("team/shared/");
        let resource = ResourceLocation::parse(&path, false).unwrap();

        assert_eq!(resource.segments().len(), 3);
        assert!(matches!(
            &resource.segments()[2],
            PathSegment::Collection(ResourceIdentifier::Slug(s)) if s == "shared"
        ));
    }

    #[test]
    fn parse_collection_path_without_trailing_slash() {
        // Without trailing slash, last segment is treated as item
        let path = cal("team/shared");
        let resource = ResourceLocation::parse(&path, false).unwrap();

        assert_eq!(resource.segments().len(), 3);
        assert!(matches!(
            &resource.segments()[2],
            PathSegment::Item(ResourceIdentifier::Slug(s)) if s == "shared"
        ));
    }

    #[test]
    fn parse_nested_collection_path() {
        let path = cal("alice/work/projects/event.ics");
        let resource = ResourceLocation::parse(&path, false).unwrap();

        assert_eq!(resource.segments().len(), 5);
        assert!(matches!(
            &resource.segments()[2],
            PathSegment::Collection(ResourceIdentifier::Slug(s)) if s == "work"
        ));
        assert!(matches!(
            &resource.segments()[3],
            PathSegment::Collection(ResourceIdentifier::Slug(s)) if s == "projects"
        ));
        assert!(matches!(
            &resource.segments()[4],
            PathSegment::Item(ResourceIdentifier::Slug(s)) if s == "event.ics"
        ));
    }

    #[test]
    fn parse_recursive_glob() {
        let path = cal("alice/**");
        let resource = ResourceLocation::parse(&path, true).unwrap();

        assert_eq!(resource.segments().len(), 3);
        assert_eq!(
            resource.segments()[2],
            PathSegment::Glob { recursive: true }
        );
    }

    #[test]
    fn parse_single_level_glob() {
        let path = card("bob/contacts/*");
        let resource = ResourceLocation::parse(&path, true).unwrap();

        assert_eq!(resource.segments().len(), 4);
        assert_eq!(
            resource.segments()[3],
            PathSegment::Glob { recursive: false }
        );
    }

    #[test]
    fn parse_uuid_owner() {
        let id = uuid::Uuid::new_v4();
        let path = format!("/{CALDAV_ROUTE_COMPONENT}/{id}/personal/work.ics");
        let resource = ResourceLocation::parse(&path, false).unwrap();

        assert!(matches!(
            &resource.segments()[1],
            PathSegment::Owner(ResourceIdentifier::Id(parsed_id)) if *parsed_id == id
        ));
    }

    #[test]
    fn parse_uuid_collection() {
        let id = uuid::Uuid::new_v4();
        let path = format!("/{CALDAV_ROUTE_COMPONENT}/alice/{id}/work.ics");
        let resource = ResourceLocation::parse(&path, false).unwrap();

        assert!(matches!(
            &resource.segments()[2],
            PathSegment::Collection(ResourceIdentifier::Id(parsed_id)) if *parsed_id == id
        ));
    }

    #[test]
    fn parse_uuid_item() {
        let id = uuid::Uuid::new_v4();
        let path = format!("/{CALDAV_ROUTE_COMPONENT}/alice/personal/{id}");
        let resource = ResourceLocation::parse(&path, false).unwrap();

        assert!(matches!(
            &resource.segments()[3],
            PathSegment::Item(ResourceIdentifier::Id(parsed_id)) if *parsed_id == id
        ));
    }

    #[test]
    fn parse_path_without_leading_slash() {
        let path = format!("{CALDAV_ROUTE_COMPONENT}/alice/personal/work.ics");
        let resource = ResourceLocation::parse(&path, false).unwrap();

        assert_eq!(resource.segments().len(), 4);
        assert_eq!(resource.resource_type(), Some(ResourceType::Calendar));
    }

    #[test]
    fn parse_empty_path_returns_none() {
        assert!(ResourceLocation::parse("", false).is_err());
    }

    #[test]
    fn parse_root_path_returns_none() {
        assert!(ResourceLocation::parse("/", false).is_err());
    }

    #[test]
    fn parse_invalid_resource_type_returns_none() {
        assert!(ResourceLocation::parse("/invalid", false).is_err());
        assert!(ResourceLocation::parse("/invalid/alice/personal", false).is_err());
    }

    #[test]
    fn parse_glob_must_be_terminal() {
        // Recursive glob with trailing segments
        let path1 = cal("alice/**/extra");
        assert!(ResourceLocation::parse(&path1, true).is_err());

        // Single-level glob with trailing segments
        let path2 = cal("alice/*/extra");
        assert!(ResourceLocation::parse(&path2, true).is_err());

        let path3 = card("alice/personal/**/contact.vcf");
        assert!(ResourceLocation::parse(&path3, true).is_err());
    }

    #[test]
    fn parse_item_must_be_terminal() {
        // Nested collections with item-like names (contain dots) in non-terminal position
        let path2 = cal("alice/project.v2/work.ics");
        assert!(ResourceLocation::parse(&path2, false).is_err());
    }

    #[test]
    fn parse_skips_empty_segments() {
        let path = format!("/{CALDAV_ROUTE_COMPONENT}/alice//personal///work.ics");
        let resource = ResourceLocation::parse(&path, false).unwrap();

        // Empty segments should be skipped
        assert_eq!(resource.segments().len(), 4);
    }

    // ========================================================================
    // ResourceLocation Construction Tests
    // ========================================================================

    #[test]
    fn from_segments_calendar_item() {
        let resource = ResourceLocation::from_segments(vec![
            PathSegment::ResourceType(ResourceType::Calendar),
            PathSegment::owner_from_slug("alice".to_string()),
            PathSegment::collection_from_slug("personal".to_string()),
            PathSegment::item_from_slug("work.ics".to_string()),
        ])
        .unwrap();

        assert_eq!(resource.segments().len(), 4);
        assert_eq!(resource.resource_type(), Some(ResourceType::Calendar));
    }

    #[test]
    fn from_segments_addressbook_collection() {
        let resource = ResourceLocation::from_segments(vec![
            PathSegment::ResourceType(ResourceType::Addressbook),
            PathSegment::owner_from_slug("bob".to_string()),
            PathSegment::collection_from_slug("contacts".to_string()),
        ])
        .unwrap();

        assert_eq!(resource.segments().len(), 3);
        assert_eq!(resource.resource_type(), Some(ResourceType::Addressbook));
    }

    #[test]
    fn from_segments_glob_recursive() {
        let resource = ResourceLocation::from_segments(vec![
            PathSegment::ResourceType(ResourceType::Calendar),
            PathSegment::owner_from_slug("alice".to_string()),
            PathSegment::collection_from_slug("personal".to_string()),
            PathSegment::Glob { recursive: true },
        ])
        .unwrap();

        assert_eq!(resource.segments().len(), 4);
        assert_eq!(
            resource.segments()[3],
            PathSegment::Glob { recursive: true }
        );
    }

    #[test]
    fn from_segments_glob_single_level() {
        let resource = ResourceLocation::from_segments(vec![
            PathSegment::ResourceType(ResourceType::Calendar),
            PathSegment::owner_from_slug("alice".to_string()),
            PathSegment::Glob { recursive: false },
        ])
        .unwrap();

        assert_eq!(resource.segments().len(), 3);
        assert_eq!(
            resource.segments()[2],
            PathSegment::Glob { recursive: false }
        );
    }

    #[test]
    fn from_segments_with_uuid_identifiers() {
        let owner_id = uuid::Uuid::new_v4();
        let collection_id = uuid::Uuid::new_v4();
        let item_id = uuid::Uuid::new_v4();

        let resource = ResourceLocation::from_segments(vec![
            PathSegment::ResourceType(ResourceType::Calendar),
            PathSegment::owner_from_id(owner_id),
            PathSegment::collection_from_id(collection_id),
            PathSegment::item_from_id(item_id),
        ])
        .unwrap();

        assert_eq!(resource.segments().len(), 4);
    }

    #[test]
    fn from_vec_conversion() {
        let segments = vec![
            PathSegment::ResourceType(ResourceType::Calendar),
            PathSegment::owner_from_slug("alice".to_string()),
        ];

        let resource: Result<ResourceLocation, _> = segments.try_into();
        assert!(resource.is_ok());
        assert_eq!(resource.unwrap().segments().len(), 2);
    }

    // ========================================================================
    // Serialization Tests - Path Output
    // ========================================================================

    #[test]
    fn serialize_to_path_calendar_item() {
        let resource = ResourceLocation::from_segments(vec![
            PathSegment::ResourceType(ResourceType::Calendar),
            PathSegment::owner_from_slug("alice".to_string()),
            PathSegment::collection_from_slug("personal".to_string()),
            PathSegment::item_from_slug("work.ics".to_string()),
        ])
        .unwrap();

        let path = resource
            .serialize()
            .output_type(ResourceLocationStringBuilderOutputType::Path)
            .build()
            .unwrap();

        assert_eq!(path, cal("alice/personal/work.ics"));
    }

    #[test]
    fn serialize_to_path_addressbook_collection() {
        let resource = ResourceLocation::from_segments(vec![
            PathSegment::ResourceType(ResourceType::Addressbook),
            PathSegment::owner_from_slug("bob".to_string()),
            PathSegment::collection_from_slug("contacts".to_string()),
        ])
        .unwrap();

        let path = resource
            .serialize()
            .output_type(ResourceLocationStringBuilderOutputType::Path)
            .build()
            .unwrap();

        assert_eq!(path, card("bob/contacts"));
    }

    #[test]
    fn serialize_to_path_with_extension() {
        let resource = ResourceLocation::from_segments(vec![
            PathSegment::ResourceType(ResourceType::Calendar),
            PathSegment::owner_from_slug("alice".to_string()),
            PathSegment::collection_from_slug("personal".to_string()),
            PathSegment::item_from_slug("work".to_string()),
        ])
        .unwrap();

        let path = resource
            .serialize()
            .include_extension(true)
            .output_type(ResourceLocationStringBuilderOutputType::Path)
            .build()
            .unwrap();

        assert_eq!(path, cal("alice/personal/work.ics"));
    }

    #[test]
    fn serialize_to_path_extension_not_duplicated() {
        let resource = ResourceLocation::from_segments(vec![
            PathSegment::ResourceType(ResourceType::Addressbook),
            PathSegment::owner_from_slug("alice".to_string()),
            PathSegment::collection_from_slug("contacts".to_string()),
            PathSegment::item_from_slug("person.vcf".to_string()),
        ])
        .unwrap();

        let path = resource
            .serialize()
            .include_extension(true)
            .output_type(ResourceLocationStringBuilderOutputType::Path)
            .build()
            .unwrap();

        // Should not add .vcf again if already present
        assert_eq!(path, card("alice/contacts/person.vcf"));
    }

    #[test]
    fn serialize_to_path_extension_on_collection_ignored() {
        let resource = ResourceLocation::from_segments(vec![
            PathSegment::ResourceType(ResourceType::Calendar),
            PathSegment::owner_from_slug("alice".to_string()),
            PathSegment::collection_from_slug("personal".to_string()),
        ])
        .unwrap();

        let path = resource
            .serialize()
            .include_extension(true)
            .output_type(ResourceLocationStringBuilderOutputType::Path)
            .build()
            .unwrap();

        // Extension should only be added to items, not collections
        assert_eq!(path, cal("alice/personal"));
    }

    #[test]
    fn serialize_to_path_with_uuid_identifiers() {
        let owner_id = uuid::Uuid::new_v4();
        let collection_id = uuid::Uuid::new_v4();
        let item_id = uuid::Uuid::new_v4();

        let resource = ResourceLocation::from_segments(vec![
            PathSegment::ResourceType(ResourceType::Calendar),
            PathSegment::owner_from_id(owner_id),
            PathSegment::collection_from_id(collection_id),
            PathSegment::item_from_id(item_id),
        ])
        .unwrap();

        let path = resource
            .serialize()
            .output_type(ResourceLocationStringBuilderOutputType::Path)
            .build()
            .unwrap();

        let expected = format!("/{CALDAV_ROUTE_COMPONENT}/{owner_id}/{collection_id}/{item_id}");
        assert_eq!(path, expected);
    }

    #[test]
    fn serialize_to_path_glob_allowed() {
        let resource = ResourceLocation::from_segments(vec![
            PathSegment::ResourceType(ResourceType::Calendar),
            PathSegment::owner_from_slug("alice".to_string()),
            PathSegment::Glob { recursive: true },
        ])
        .unwrap();

        let path = resource
            .serialize()
            .allow_glob(true)
            .output_type(ResourceLocationStringBuilderOutputType::Path)
            .build()
            .unwrap();

        assert_eq!(path, cal("alice/**"));
    }

    #[test]
    fn serialize_to_path_glob_single_level() {
        let resource = ResourceLocation::from_segments(vec![
            PathSegment::ResourceType(ResourceType::Addressbook),
            PathSegment::owner_from_slug("bob".to_string()),
            PathSegment::collection_from_slug("contacts".to_string()),
            PathSegment::Glob { recursive: false },
        ])
        .unwrap();

        let path = resource
            .serialize()
            .allow_glob(true)
            .output_type(ResourceLocationStringBuilderOutputType::Path)
            .build()
            .unwrap();

        assert_eq!(path, card("bob/contacts/*"));
    }

    #[test]
    fn serialize_to_path_glob_not_allowed_returns_error() {
        let resource = ResourceLocation::from_segments(vec![
            PathSegment::ResourceType(ResourceType::Calendar),
            PathSegment::owner_from_slug("alice".to_string()),
            PathSegment::Glob { recursive: true },
        ])
        .unwrap();

        let result = resource
            .serialize()
            .allow_glob(false)
            .output_type(ResourceLocationStringBuilderOutputType::Path)
            .build();

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ServiceError::ParseError(_)));
    }

    #[test]
    fn serialize_to_path_nested_collections() {
        let resource = ResourceLocation::from_segments(vec![
            PathSegment::ResourceType(ResourceType::Calendar),
            PathSegment::owner_from_slug("alice".to_string()),
            PathSegment::collection_from_slug("work".to_string()),
            PathSegment::collection_from_slug("projects".to_string()),
            PathSegment::item_from_slug("event.ics".to_string()),
        ])
        .unwrap();

        let path = resource
            .serialize()
            .output_type(ResourceLocationStringBuilderOutputType::Path)
            .build()
            .unwrap();

        assert_eq!(path, cal("alice/work/projects/event.ics"));
    }

    // ========================================================================
    // Serialization Tests - FullPath Output
    // ========================================================================

    #[test]
    fn serialize_to_full_path() {
        let resource = ResourceLocation::from_segments(vec![
            PathSegment::ResourceType(ResourceType::Calendar),
            PathSegment::owner_from_slug("alice".to_string()),
            PathSegment::collection_from_slug("personal".to_string()),
            PathSegment::item_from_slug("work.ics".to_string()),
        ])
        .unwrap();

        let path = resource
            .serialize()
            .output_type(ResourceLocationStringBuilderOutputType::FullPath)
            .build()
            .unwrap();

        assert_eq!(path, full_path(&cal("alice/personal/work.ics")));
    }

    #[test]
    fn serialize_to_full_path_with_glob() {
        let resource = ResourceLocation::from_segments(vec![
            PathSegment::ResourceType(ResourceType::Calendar),
            PathSegment::owner_from_slug("alice".to_string()),
            PathSegment::Glob { recursive: true },
        ])
        .unwrap();

        let path = resource
            .serialize()
            .allow_glob(true)
            .output_type(ResourceLocationStringBuilderOutputType::FullPath)
            .build()
            .unwrap();

        assert_eq!(path, full_path(&cal("alice/**")));
    }

    // ========================================================================
    // Serialization Tests - URL Output
    // ========================================================================

    #[test]
    fn serialize_to_url() {
        let resource = ResourceLocation::from_segments(vec![
            PathSegment::ResourceType(ResourceType::Calendar),
            PathSegment::owner_from_slug("alice".to_string()),
            PathSegment::collection_from_slug("personal".to_string()),
            PathSegment::item_from_slug("work.ics".to_string()),
        ])
        .unwrap();

        let url = resource
            .serialize()
            .output_type(ResourceLocationStringBuilderOutputType::Url(
                "https://example.com".to_string(),
            ))
            .build()
            .unwrap();

        assert_eq!(
            url,
            format!(
                "https://example.com{}",
                full_path(&cal("alice/personal/work.ics"))
            )
        );
    }

    #[test]
    fn serialize_to_url_with_trailing_slash() {
        let resource = ResourceLocation::from_segments(vec![
            PathSegment::ResourceType(ResourceType::Calendar),
            PathSegment::owner_from_slug("alice".to_string()),
            PathSegment::collection_from_slug("personal".to_string()),
        ])
        .unwrap();

        let url = resource
            .serialize()
            .output_type(ResourceLocationStringBuilderOutputType::Url(
                "https://example.com/".to_string(),
            ))
            .build()
            .unwrap();

        // Should not have double slash
        assert_eq!(
            url,
            format!("https://example.com{}", full_path(&cal("alice/personal")))
        );
    }

    // ========================================================================
    // Serialization Tests - Error Cases
    // ========================================================================

    #[test]
    fn serialize_unset_output_type_returns_error() {
        let resource = ResourceLocation::from_segments(vec![
            PathSegment::ResourceType(ResourceType::Calendar),
            PathSegment::owner_from_slug("alice".to_string()),
        ])
        .unwrap();

        let result = resource.serialize().build();

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ServiceError::ParseError(_)));
    }

    // ========================================================================
    // Builder API Tests
    // ========================================================================

    #[test]
    fn serialize_item_with_extension_builder() {
        let resource = ResourceLocation::from_segments(vec![
            PathSegment::ResourceType(ResourceType::Calendar),
            PathSegment::owner_from_slug("alice".to_string()),
            PathSegment::collection_from_slug("personal".to_string()),
            PathSegment::item_from_slug("work".to_string()),
        ])
        .unwrap();

        let path = resource
            .serialize()
            .include_extension(true)
            .output_type(ResourceLocationStringBuilderOutputType::Path)
            .build()
            .unwrap();
        assert_eq!(path, cal("alice/personal/work.ics"));
    }

    #[test]
    fn serialize_collection_builder() {
        let resource = ResourceLocation::from_segments(vec![
            PathSegment::ResourceType(ResourceType::Addressbook),
            PathSegment::owner_from_slug("bob".to_string()),
            PathSegment::collection_from_slug("contacts".to_string()),
        ])
        .unwrap();

        let path = resource
            .serialize()
            .output_type(ResourceLocationStringBuilderOutputType::Path)
            .build()
            .unwrap();
        assert_eq!(path, card("bob/contacts"));
    }

    // ========================================================================
    // Roundtrip Tests
    // ========================================================================

    #[test]
    fn roundtrip_calendar_item() {
        let path = cal("alice/personal/work.ics");
        let resource = ResourceLocation::parse(&path, false).unwrap();
        let serialized = resource
            .serialize()
            .output_type(ResourceLocationStringBuilderOutputType::Path)
            .build()
            .unwrap();

        assert_eq!(serialized, path);
    }

    #[test]
    fn roundtrip_addressbook_collection() {
        let path = card("bob/contacts");
        let resource = ResourceLocation::parse(&path, false).unwrap();
        let serialized = resource
            .serialize()
            .output_type(ResourceLocationStringBuilderOutputType::Path)
            .build()
            .unwrap();

        assert_eq!(serialized, path);
    }

    #[test]
    fn roundtrip_recursive_glob() {
        let path = cal("alice/**");
        let resource = ResourceLocation::parse(&path, true).unwrap();
        let serialized = resource
            .serialize()
            .allow_glob(true)
            .output_type(ResourceLocationStringBuilderOutputType::Path)
            .build()
            .unwrap();

        assert_eq!(serialized, path);
    }

    #[test]
    fn roundtrip_single_level_glob() {
        let path = card("bob/contacts/*");
        let resource = ResourceLocation::parse(&path, true).unwrap();
        let serialized = resource
            .serialize()
            .allow_glob(true)
            .output_type(ResourceLocationStringBuilderOutputType::Path)
            .build()
            .unwrap();

        assert_eq!(serialized, path);
    }

    #[test]
    fn roundtrip_nested_collections() {
        let path = cal("alice/work/projects/meeting.ics");
        let resource = ResourceLocation::parse(&path, false).unwrap();
        let serialized = resource
            .serialize()
            .output_type(ResourceLocationStringBuilderOutputType::Path)
            .build()
            .unwrap();

        assert_eq!(serialized, path);
    }

    #[test]
    fn roundtrip_with_uuid() {
        let id = uuid::Uuid::new_v4();
        let path = format!("/{CALDAV_ROUTE_COMPONENT}/alice/{id}/work.ics");
        let resource = ResourceLocation::parse(&path, false).unwrap();
        let serialized = resource
            .serialize()
            .output_type(ResourceLocationStringBuilderOutputType::Path)
            .build()
            .unwrap();

        assert_eq!(serialized, path);
    }

    #[test]
    fn roundtrip_full_path() {
        let path = cal("alice/personal/work.ics");
        let resource = ResourceLocation::parse(&path, false).unwrap();
        let full = resource
            .serialize()
            .output_type(ResourceLocationStringBuilderOutputType::FullPath)
            .build()
            .unwrap();

        assert_eq!(full, full_path(&path));
    }

    // ========================================================================
    // Accessor Method Tests
    // ========================================================================

    #[test]
    fn segments_accessor() {
        let resource = ResourceLocation::from_segments(vec![
            PathSegment::ResourceType(ResourceType::Calendar),
            PathSegment::owner_from_slug("alice".to_string()),
        ])
        .unwrap();

        assert_eq!(resource.segments().len(), 2);
    }

    #[test]
    fn resource_type_accessor() {
        let resource = ResourceLocation::from_segments(vec![
            PathSegment::ResourceType(ResourceType::Calendar),
            PathSegment::owner_from_slug("alice".to_string()),
        ])
        .unwrap();

        assert_eq!(resource.resource_type(), Some(ResourceType::Calendar));
    }

    #[test]
    fn resource_type_none_when_empty() {
        // from_segments should fail with empty vec
        let result = ResourceLocation::from_segments(vec![]);
        assert!(result.is_err());
    }

    #[test]
    fn owner_accessor_slug() {
        let resource = ResourceLocation::from_segments(vec![
            PathSegment::ResourceType(ResourceType::Calendar),
            PathSegment::owner_from_slug("alice".to_string()),
        ])
        .unwrap();

        let owner = resource.owner().unwrap();
        assert!(matches!(owner, ResourceIdentifier::Slug(s) if s == "alice"));
    }

    #[test]
    fn owner_accessor_id() {
        let id = uuid::Uuid::new_v4();
        let resource = ResourceLocation::from_segments(vec![
            PathSegment::ResourceType(ResourceType::Calendar),
            PathSegment::owner_from_id(id),
        ])
        .unwrap();

        let owner = resource.owner().unwrap();
        assert!(matches!(owner, ResourceIdentifier::Id(parsed_id) if parsed_id == id));
    }

    #[test]
    fn owner_none_when_missing() {
        // from_segments should fail with only resource type
        let result = ResourceLocation::from_segments(vec![PathSegment::ResourceType(
            ResourceType::Calendar,
        )]);
        assert!(result.is_err());
    }
}
