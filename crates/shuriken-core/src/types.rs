/// Collection type without database dependencies
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CollectionType {
    Collection,
    Calendar,
    Addressbook,
}

impl CollectionType {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Collection => "collection",
            Self::Calendar => "calendar",
            Self::Addressbook => "addressbook",
        }
    }
}

impl std::fmt::Display for CollectionType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}
