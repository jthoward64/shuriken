//! Resource paths for authorization.
//!
//! The new authorization model uses path-based permissions with glob matching.
//! Resources are identified by their path components, which can be converted to
//! path strings for Casbin enforcement.

use crate::app::api::{CALDAV_ROUTE_COMPONENT, CARDDAV_ROUTE_COMPONENT, DAV_ROUTE_PREFIX};

/// Resource type for DAV collections.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ResourceType {
    /// Calendar collection (`/calendars/...`).
    Calendar,
    /// Addressbook collection (`/addressbooks/...`).
    Addressbook,
}

impl ResourceType {
    /// Returns the path segment for this resource type.
    #[must_use]
    pub const fn as_path_segment(&self) -> &'static str {
        match self {
            Self::Calendar => CALDAV_ROUTE_COMPONENT,
            Self::Addressbook => CARDDAV_ROUTE_COMPONENT,
        }
    }

    /// Parse a path segment into a resource type.
    #[must_use]
    pub fn from_path_segment(s: &str) -> Option<Self> {
        match s {
            CALDAV_ROUTE_COMPONENT => Some(Self::Calendar),
            CARDDAV_ROUTE_COMPONENT => Some(Self::Addressbook),
            _ => None,
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
    /// ## Examples
    ///
    /// ```ignore
    /// let resource = ResourceId::parse("/calendars/alice/personal/work.ics").unwrap();
    /// assert_eq!(resource.to_path(), "/calendars/alice/personal/work.ics");
    /// ```
    #[must_use]
    pub fn to_path(&self) -> String {
        let mut path = String::from("/");
        for (i, segment) in self.segments.iter().enumerate() {
            match segment {
                PathSegment::ResourceType(rt) => path.push_str(rt.as_path_segment()),
                PathSegment::Owner(owner) => path.push_str(owner),
                PathSegment::Collection(col) => path.push_str(col),
                PathSegment::Item(item) => path.push_str(item),
                PathSegment::Glob { recursive } => {
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
        path
    }

    #[must_use]
    pub fn to_url(&self, serve_origin: &str) -> String {
        let path = self.to_path();
        format!(
            "{}{}/{}",
            serve_origin.trim_end_matches('/'),
            DAV_ROUTE_PREFIX,
            path
        )
    }

    /// Returns the segments of this resource path.
    #[must_use]
    pub fn segments(&self) -> &[PathSegment] {
        &self.segments
    }

    /// Returns the path for Casbin enforcement.
    ///
    /// This is an alias for `to_path()`.
    #[must_use]
    pub fn path(&self) -> String {
        self.to_path()
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
        write!(f, "{}", self.to_path())
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

    #[test]
    fn parse_simple_path() {
        let resource = ResourceLocation::parse("/calendars/alice/personal/work.ics").unwrap();
        assert_eq!(resource.segments().len(), 4);
        assert_eq!(resource.resource_type(), Some(ResourceType::Calendar));
        assert_eq!(resource.owner(), Some("alice"));
        assert_eq!(resource.to_path(), "/calendars/alice/personal/work.ics");
    }

    #[test]
    fn parse_recursive_glob() {
        let resource = ResourceLocation::parse("/calendars/alice/**").unwrap();
        assert_eq!(resource.segments().len(), 3);
        assert_eq!(
            resource.segments()[2],
            PathSegment::Glob { recursive: true }
        );
        assert_eq!(resource.to_path(), "/calendars/alice/**");
    }

    #[test]
    fn parse_single_glob() {
        let resource = ResourceLocation::parse("/addressbooks/bob/contacts/*").unwrap();
        assert_eq!(resource.segments().len(), 4);
        assert_eq!(
            resource.segments()[3],
            PathSegment::Glob { recursive: false }
        );
        assert_eq!(resource.to_path(), "/addressbooks/bob/contacts/*");
    }

    #[test]
    fn parse_addressbook_path() {
        let resource = ResourceLocation::parse("/addressbooks/charlie/work/contact.vcf").unwrap();
        assert_eq!(resource.resource_type(), Some(ResourceType::Addressbook));
        assert_eq!(resource.owner(), Some("charlie"));
        assert_eq!(resource.to_path(), "/addressbooks/charlie/work/contact.vcf");
    }

    #[test]
    fn roundtrip_conversion() {
        let paths = [
            "/calendars/alice/personal/work.ics",
            "/calendars/bob/**",
            "/addressbooks/charlie/contacts/*",
            "/calendars/team/shared/meeting.ics",
            "/calendars/team/shared/",
        ];

        for path in paths {
            let resource = ResourceLocation::parse(path).unwrap();
            assert_eq!(resource.to_path(), path, "Roundtrip failed for {path}");
        }
    }

    #[test]
    fn create_from_segments_glob() {
        let segments = vec![
            PathSegment::ResourceType(ResourceType::Calendar),
            PathSegment::Owner("alice".to_string()),
            PathSegment::Collection("personal".to_string()),
            PathSegment::Glob { recursive: true },
        ];

        let resource = ResourceLocation::from_segments(segments);
        assert_eq!(resource.to_path(), "/calendars/alice/personal/**");
    }

    #[test]
    fn create_from_segments_item() {
        let segments = vec![
            PathSegment::ResourceType(ResourceType::Calendar),
            PathSegment::Owner("alice".to_string()),
            PathSegment::Collection("personal".to_string()),
            PathSegment::Item("work.ics".to_string()),
        ];

        let resource = ResourceLocation::from_segments(segments);
        assert_eq!(resource.to_path(), "/calendars/alice/personal/work.ics");
    }

    #[test]
    fn create_from_segments_collection() {
        let segments = vec![
            PathSegment::ResourceType(ResourceType::Addressbook),
            PathSegment::Owner("bob".to_string()),
            PathSegment::Collection("contacts".to_string()),
        ];

        let resource = ResourceLocation::from_segments(segments);
        assert_eq!(resource.to_path(), "/addressbooks/bob/contacts/");
    }

    #[test]
    fn invalid_path_returns_none() {
        assert!(ResourceLocation::parse("").is_none());
        assert!(ResourceLocation::parse("/").is_none());
        assert!(ResourceLocation::parse("/invalid").is_none());
    }

    #[test]
    fn glob_must_be_terminal() {
        assert!(ResourceLocation::parse("/calendars/alice/**/extra").is_none());
        assert!(ResourceLocation::parse("/calendars/alice/*/extra").is_none());
    }

    #[test]
    fn item_must_be_terminal() {
        assert!(ResourceLocation::parse("/calendars/alice/work.ics/extra").is_none());
    }
}
