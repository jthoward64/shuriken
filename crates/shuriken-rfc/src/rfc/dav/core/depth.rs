//! Depth header values.

use std::fmt;

/// `WebDAV` Depth header value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Depth {
    /// Depth: 0 - The resource itself only.
    Zero,
    /// Depth: 1 - The resource and its immediate children.
    One,
    /// Depth: infinity - The resource and all descendants.
    #[default]
    Infinity,
}

impl Depth {
    /// Parses from header value.
    #[must_use]
    pub fn from_header(value: &str) -> Option<Self> {
        match value.trim().to_lowercase().as_str() {
            "0" => Some(Self::Zero),
            "1" => Some(Self::One),
            "infinity" => Some(Self::Infinity),
            _ => None,
        }
    }

    /// Returns the header value string.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Zero => "0",
            Self::One => "1",
            Self::Infinity => "infinity",
        }
    }
}

impl fmt::Display for Depth {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for Depth {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::from_header(s).ok_or(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn depth_from_header() {
        assert_eq!(Depth::from_header("0"), Some(Depth::Zero));
        assert_eq!(Depth::from_header("1"), Some(Depth::One));
        assert_eq!(Depth::from_header("infinity"), Some(Depth::Infinity));
        assert_eq!(Depth::from_header("INFINITY"), Some(Depth::Infinity));
        assert_eq!(Depth::from_header("2"), None);
    }

    #[test]
    fn depth_as_str() {
        assert_eq!(Depth::Zero.as_str(), "0");
        assert_eq!(Depth::One.as_str(), "1");
        assert_eq!(Depth::Infinity.as_str(), "infinity");
    }
}
