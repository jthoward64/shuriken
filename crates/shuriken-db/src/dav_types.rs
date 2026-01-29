///! DAV-specific domain types used across crates.
use crate::model::{dav::collection::DavCollection, dav::instance::DavInstance, user::User};

/// Represents an authenticated user or public access in the depot.
#[derive(Debug, Clone)]
pub enum DepotUser {
    /// Authenticated user
    User(User),
    /// Unauthenticated/public access
    Public,
}

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
