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
        let principal_segment = match &segments[1] {
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
                segments.push(match part.parse::<uuid::Uuid>() {
                    Ok(id) => PathSegment::owner_from_id(id),
                    Err(_) => PathSegment::owner_from_slug(part.to_string()),
                });
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
                return None;
            }

            segments.push(match part.parse::<uuid::Uuid>() {
                Ok(id) => PathSegment::collection_from_id(id),
                Err(_) => PathSegment::collection_from_slug(part.to_string()),
            });
        }

        Some(Self { segments })
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

    // /// Convert the resource identifier to a path string for Casbin enforcement.
    // ///
    // /// ## Errors
    // /// Returns error if glob patterns are not allowed but glob wildcards are present.
    // ///
    // /// ## Examples
    // ///
    // /// ```ignore
    // /// let resource = ResourceId::parse("/calendars/alice/personal/work.ics").unwrap();
    // /// assert_eq!(resource.to_path(), "/calendars/alice/personal/work.ics");
    // /// ```
    // pub fn to_resource_path(&self, allow_glob: bool) -> ServiceResult<String> {
    //     let mut path = String::from("/");
    //     for (i, segment) in self.segments.iter().enumerate() {
    //         match segment {
    //             PathSegment::ResourceType(rt) => path.push_str(rt.as_path_segment()),
    //             PathSegment::Owner(owner) => path.push_str(owner),
    //             PathSegment::Collection(col) => path.push_str(col),
    //             PathSegment::Item(item) => path.push_str(item),
    //             PathSegment::Glob { recursive } => {
    //                 if !allow_glob {
    //                     // Should not serialize glob segments if not allowed
    //                     return Err(ServiceError::ParseError(
    //                         "Cannot serialize glob segment in resource path".to_string(),
    //                     ));
    //                 }
    //                 if *recursive {
    //                     path.push_str("**");
    //                 } else {
    //                     path.push('*');
    //                 }
    //             }
    //         }
    //         if segment.is_terminal() {
    //             if i + 1 < self.segments.len() {
    //                 // Terminal segment must be last
    //                 tracing::warn!(
    //                     "Warning: Terminal segment {:?} is not last in resource {:?}",
    //                     segment,
    //                     self
    //                 );
    //             }
    //             break;
    //         }
    //         path.push('/');
    //     }
    //     Ok(path)
    // }

    // /// ## Errors
    // /// Returns error if path cannot be constructed.
    // pub fn to_full_path(&self) -> ServiceResult<String> {
    //     let path = self.to_resource_path(false)?;
    //     Ok(format!("{DAV_ROUTE_PREFIX}{path}"))
    // }

    // /// ## Errors
    // /// Returns error if full path cannot be constructed.
    // pub fn to_url(&self, serve_origin: &str) -> ServiceResult<String> {
    //     let path = self.to_full_path()?;
    //     Ok(format!("{}{}", serve_origin.trim_end_matches('/'), path))
    // }

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

impl From<Vec<PathSegment>> for ResourceLocation {
    fn from(segments: Vec<PathSegment>) -> Self {
        Self::from_segments(segments)
    }
}

impl ResourceLocationStringBuilder {
    /// Include path in the output.
    pub fn include_extension(mut self, include: bool) -> Self {
        self.include_extension = include;
        self
    }

    /// Set output type.
    pub fn output_type(mut self, output_type: ResourceLocationStringBuilderOutputType) -> Self {
        self.output_type = output_type;
        self
    }

    /// Set whether glob segments are allowed.
    pub fn allow_glob(mut self, allow: bool) -> Self {
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
