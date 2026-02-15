//! Generic normalized value types for case-insensitive identifiers.

use std::fmt;

/// Trait for types that can be parsed from string identifiers.
///
/// Implementations should handle case normalization and return
/// a typed representation of the identifier.
pub trait ParseSized {
    /// Parses a string into the typed representation.
    ///
    /// Should handle case-insensitive matching and return the appropriate
    /// variant. Returns `None` if parsing fails (though most implementations
    /// use an `Unknown` variant instead).
    fn parse(s: &str) -> Option<Self>
    where
        Self: Sized;
}

/// A normalized value that preserves the original string while providing
/// a typed parsed representation.
///
/// This is useful for protocol identifiers (property names, parameter names, etc.)
/// where we want to:
/// - Preserve the original casing for round-trip fidelity
/// - Compare values based on normalized/parsed representation
/// - Access a typed enum for pattern matching
///
/// ## Type Parameters
/// - `T`: The parsed type implementing `ParseSized`
#[derive(Debug, Clone)]
pub struct NormalizedValue<T: ParseSized> {
    /// Original string as it appeared in the input.
    pub original: String,
    /// Parsed/normalized representation.
    pub parsed: Option<T>,
}

impl<T: ParseSized> NormalizedValue<T> {
    /// Creates a new normalized value by parsing the input string.
    #[must_use]
    pub fn new(s: impl Into<String>) -> Self {
        let original = s.into();
        let parsed = T::parse(&original);
        Self { original, parsed }
    }

    /// Creates a normalized value with a known parsed value.
    #[must_use]
    pub fn with_parsed(original: String, parsed: T) -> Self {
        Self {
            original,
            parsed: Some(parsed),
        }
    }

    /// Returns the original string.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.original
    }

    /// Returns the parsed value if available.
    #[must_use]
    pub fn parsed(&self) -> Option<&T> {
        self.parsed.as_ref()
    }
}

impl<T: ParseSized + PartialEq> PartialEq for NormalizedValue<T> {
    fn eq(&self, other: &Self) -> bool {
        self.parsed == other.parsed
    }
}

impl<T: ParseSized + Eq> Eq for NormalizedValue<T> {}

impl<T: ParseSized + fmt::Display> fmt::Display for NormalizedValue<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.original)
    }
}

/// Macro to define name enums with `ParseSized` implementation.
///
/// ## Usage
///
/// ```ignore
/// define_names! {
///     /// Documentation for the enum
///     pub ICalPropertyName,
///     Dtstart => "DTSTART",
///     Dtend => "DTEND",
///     Summary => "SUMMARY",
/// }
/// ```
///
/// This generates:
/// - An enum with the specified variants
/// - A `ParseSized` implementation with case-insensitive matching
/// - An `as_str()` method to get the canonical string representation
#[macro_export]
macro_rules! define_names {
    (
        $(#[$meta:meta])*
        $vis:vis $enum_name:ident,
        $($variant:ident => $string:expr),* $(,)?
    ) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
        $vis enum $enum_name {
            $($variant,)*
        }

        impl $crate::rfc::ical::core::ParseSized for $enum_name {
            fn parse(s: &str) -> Option<Self> {
                Some(match s {
                    $(s if s.eq_ignore_ascii_case($string) => Self::$variant,)*
                    _ => return None,
                })
            }
        }

        impl $enum_name {
            /// Returns the canonical string representation of this name.
            #[must_use]
            pub const fn as_str(&self) -> &'static str {
                match self {
                    $(Self::$variant => $string,)*
                }
            }
        }

        impl ::std::fmt::Display for $enum_name {
            fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
                write!(f, "{}", self.as_str())
            }
        }
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    // Test enum
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum TestName {
        Foo,
        Bar,
        Unknown,
    }

    impl ParseSized for TestName {
        fn parse(s: &str) -> Option<Self> {
            Some(match s.to_ascii_uppercase().as_str() {
                "FOO" => Self::Foo,
                "BAR" => Self::Bar,
                _ => Self::Unknown,
            })
        }
    }

    #[test]
    fn normalized_value_preserves_original() {
        let val = NormalizedValue::<TestName>::new("FoO");
        assert_eq!(val.as_str(), "FoO");
        assert_eq!(val.parsed(), Some(&TestName::Foo));
    }

    #[test]
    fn normalized_value_equality_uses_parsed() {
        let val1 = NormalizedValue::<TestName>::new("foo");
        let val2 = NormalizedValue::<TestName>::new("FOO");
        let val3 = NormalizedValue::<TestName>::new("bar");

        assert_eq!(val1, val2); // Different casing, same parsed value
        assert_ne!(val1, val3); // Different parsed values
    }
}
