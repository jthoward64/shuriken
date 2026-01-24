//! DAV href type.

use std::fmt;

/// A `WebDAV` href (URL reference).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Href(pub String);

impl Href {
    /// Creates a new href.
    #[must_use]
    pub fn new(path: impl Into<String>) -> Self {
        Self(path.into())
    }

    /// Returns the href as a string slice.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Returns whether this href ends with a slash.
    #[must_use]
    pub fn is_collection(&self) -> bool {
        self.0.ends_with('/')
    }

    /// Returns the parent path.
    #[must_use]
    pub fn parent(&self) -> Option<Self> {
        let path = self.0.trim_end_matches('/');
        path.rfind('/').map(|i| Self(format!("{}/", &path[..i])))
    }

    /// Returns the last path segment (resource name).
    #[must_use]
    pub fn name(&self) -> Option<&str> {
        let path = self.0.trim_end_matches('/');
        path.rsplit('/').next()
    }

    /// Joins a child path.
    #[must_use]
    pub fn join(&self, child: &str) -> Self {
        let base = if self.0.ends_with('/') {
            &self.0
        } else {
            // Add trailing slash
            return Self(format!("{}/{}", self.0, child.trim_start_matches('/')));
        };
        Self(format!("{}{}", base, child.trim_start_matches('/')))
    }

    /// Ensures the href ends with a slash (for collections).
    #[must_use]
    pub fn with_trailing_slash(self) -> Self {
        if self.0.ends_with('/') {
            self
        } else {
            Self(format!("{}/", self.0))
        }
    }

    /// Ensures the href does not end with a slash (for resources).
    #[must_use]
    pub fn without_trailing_slash(self) -> Self {
        if self.0.ends_with('/') && self.0.len() > 1 {
            Self(self.0.trim_end_matches('/').to_string())
        } else {
            self
        }
    }

    /// URL-decodes the href.
    #[must_use]
    pub fn decode(&self) -> String {
        percent_decode(&self.0)
    }
}

impl fmt::Display for Href {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<String> for Href {
    fn from(s: String) -> Self {
        Self(s)
    }
}

impl From<&str> for Href {
    fn from(s: &str) -> Self {
        Self(s.to_string())
    }
}

impl AsRef<str> for Href {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

/// Simple percent-decoding for URLs.
fn percent_decode(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '%' {
            let hex: String = chars.by_ref().take(2).collect();
            if hex.len() == 2 && let Ok(byte) = u8::from_str_radix(&hex, 16) {
                result.push(byte as char);
                continue;
            }
            result.push('%');
            result.push_str(&hex);
        } else if c == '+' {
            result.push(' ');
        } else {
            result.push(c);
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn href_new() {
        let href = Href::new("/calendars/user/");
        assert_eq!(href.as_str(), "/calendars/user/");
    }

    #[test]
    fn href_is_collection() {
        assert!(Href::new("/calendars/").is_collection());
        assert!(!Href::new("/calendars/event.ics").is_collection());
    }

    #[test]
    fn href_parent() {
        let href = Href::new("/calendars/user/cal/");
        let parent = href.parent().unwrap();
        assert_eq!(parent.as_str(), "/calendars/user/");
    }

    #[test]
    fn href_name() {
        assert_eq!(Href::new("/calendars/user/").name(), Some("user"));
        assert_eq!(Href::new("/calendars/event.ics").name(), Some("event.ics"));
    }

    #[test]
    fn href_join() {
        let base = Href::new("/calendars/");
        let joined = base.join("user/cal/");
        assert_eq!(joined.as_str(), "/calendars/user/cal/");
    }

    #[test]
    fn href_trailing_slash() {
        let href = Href::new("/calendars").with_trailing_slash();
        assert_eq!(href.as_str(), "/calendars/");

        let href = Href::new("/calendars/").without_trailing_slash();
        assert_eq!(href.as_str(), "/calendars");
    }

    #[test]
    fn percent_decode_basic() {
        assert_eq!(percent_decode("/path%20with%20spaces"), "/path with spaces");
        assert_eq!(percent_decode("hello%2Fworld"), "hello/world");
    }
}
