//! Resource types and identifiers for authorization.
//!
//! Resources are the objects that principals can access. They include collections
//! (calendars, addressbooks) and items (events, vcards).

/// Resource types for Casbin enforcement.
///
/// Used to construct the `obj_type` in Casbin policies (`g2` edges).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ResourceType {
    /// A calendar collection.
    Calendar,
    /// A calendar event/object resource.
    CalendarEvent,
    /// An addressbook collection.
    Addressbook,
    /// A vCard resource.
    Vcard,
}

impl ResourceType {
    /// Returns the Casbin object type string.
    #[must_use]
    pub const fn as_casbin_type(&self) -> &'static str {
        match self {
            Self::Calendar => "calendar",
            Self::CalendarEvent => "calendar_event",
            Self::Addressbook => "addressbook",
            Self::Vcard => "vcard",
        }
    }

    /// Parse a Casbin object type string.
    #[must_use]
    pub fn from_casbin_type(s: &str) -> Option<Self> {
        match s {
            "calendar" => Some(Self::Calendar),
            "calendar_event" => Some(Self::CalendarEvent),
            "addressbook" => Some(Self::Addressbook),
            "vcard" => Some(Self::Vcard),
            _ => None,
        }
    }

    /// Returns the resource type prefix for Casbin object IDs.
    #[must_use]
    pub const fn id_prefix(&self) -> &'static str {
        match self {
            Self::Calendar => "cal",
            Self::CalendarEvent => "evt",
            Self::Addressbook => "ab",
            Self::Vcard => "card",
        }
    }

    /// Returns `true` if this is a collection type.
    #[must_use]
    pub const fn is_collection(&self) -> bool {
        matches!(self, Self::Calendar | Self::Addressbook)
    }

    /// Returns `true` if this is an item type.
    #[must_use]
    pub const fn is_item(&self) -> bool {
        matches!(self, Self::CalendarEvent | Self::Vcard)
    }

    /// Returns the parent collection type for item types.
    #[must_use]
    pub const fn parent_type(&self) -> Option<Self> {
        match self {
            Self::CalendarEvent => Some(Self::Calendar),
            Self::Vcard => Some(Self::Addressbook),
            Self::Calendar | Self::Addressbook => None,
        }
    }
}

impl std::fmt::Display for ResourceType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_casbin_type())
    }
}

/// A resource identifier for authorization.
///
/// Combines a resource type with a unique identifier to form the Casbin object.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ResourceId {
    resource_type: ResourceType,
    id: uuid::Uuid,
}

impl ResourceId {
    /// Create a new resource identifier.
    #[must_use]
    pub const fn new(resource_type: ResourceType, id: uuid::Uuid) -> Self {
        Self { resource_type, id }
    }

    /// Create a calendar resource ID.
    #[must_use]
    pub const fn calendar(id: uuid::Uuid) -> Self {
        Self::new(ResourceType::Calendar, id)
    }

    /// Create a calendar event resource ID.
    #[must_use]
    pub const fn calendar_event(id: uuid::Uuid) -> Self {
        Self::new(ResourceType::CalendarEvent, id)
    }

    /// Create an addressbook resource ID.
    #[must_use]
    pub const fn addressbook(id: uuid::Uuid) -> Self {
        Self::new(ResourceType::Addressbook, id)
    }

    /// Create a vCard resource ID.
    #[must_use]
    pub const fn vcard(id: uuid::Uuid) -> Self {
        Self::new(ResourceType::Vcard, id)
    }

    /// Returns the resource type.
    #[must_use]
    pub const fn resource_type(&self) -> ResourceType {
        self.resource_type
    }

    /// Returns the UUID.
    #[must_use]
    pub const fn id(&self) -> uuid::Uuid {
        self.id
    }

    /// Returns the Casbin object string (e.g., `cal:uuid`, `evt:uuid`).
    #[must_use]
    pub fn as_casbin_object(&self) -> String {
        format!("{}:{}", self.resource_type.id_prefix(), self.id)
    }

    /// Parse a Casbin object string back into a `ResourceId`.
    #[must_use]
    pub fn from_casbin_object(s: &str) -> Option<Self> {
        let (prefix, id_str) = s.split_once(':')?;
        let id = uuid::Uuid::parse_str(id_str).ok()?;

        let resource_type = match prefix {
            "cal" => ResourceType::Calendar,
            "evt" => ResourceType::CalendarEvent,
            "ab" => ResourceType::Addressbook,
            "card" => ResourceType::Vcard,
            _ => return None,
        };

        Some(Self { resource_type, id })
    }
}

impl std::fmt::Display for ResourceId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_casbin_object())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resource_type_roundtrip() {
        for rt in [
            ResourceType::Calendar,
            ResourceType::CalendarEvent,
            ResourceType::Addressbook,
            ResourceType::Vcard,
        ] {
            let casbin_type = rt.as_casbin_type();
            let parsed = ResourceType::from_casbin_type(casbin_type);
            assert_eq!(Some(rt), parsed, "Roundtrip failed for {rt:?}");
        }
    }

    #[test]
    fn resource_id_roundtrip() {
        let id = uuid::Uuid::now_v7();
        let resources = [
            ResourceId::calendar(id),
            ResourceId::calendar_event(id),
            ResourceId::addressbook(id),
            ResourceId::vcard(id),
        ];

        for resource in resources {
            let casbin_obj = resource.as_casbin_object();
            let parsed = ResourceId::from_casbin_object(&casbin_obj);
            assert_eq!(Some(resource), parsed, "Roundtrip failed for {casbin_obj}");
        }
    }

    #[test]
    fn parent_type_mapping() {
        assert_eq!(
            ResourceType::CalendarEvent.parent_type(),
            Some(ResourceType::Calendar)
        );
        assert_eq!(
            ResourceType::Vcard.parent_type(),
            Some(ResourceType::Addressbook)
        );
        assert_eq!(ResourceType::Calendar.parent_type(), None);
        assert_eq!(ResourceType::Addressbook.parent_type(), None);
    }
}
