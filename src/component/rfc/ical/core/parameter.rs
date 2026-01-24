//! iCalendar parameter types (RFC 5545 §3.2).

use std::fmt;

/// A single iCalendar property parameter.
///
/// Parameters modify or provide metadata for a property value.
/// For example: `DTSTART;TZID=America/New_York:20260123T120000`
///
/// The `TZID` is a parameter with name `TZID` and value `America/New_York`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Parameter {
    /// Parameter name (normalized to uppercase).
    pub name: String,
    /// Parameter values. Most parameters have one value, but some
    /// (like MEMBER) can have multiple comma-separated values.
    pub values: Vec<String>,
}

impl Parameter {
    /// Creates a new parameter with a single value.
    #[must_use]
    pub fn new(name: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            name: name.into().to_ascii_uppercase(),
            values: vec![value.into()],
        }
    }

    /// Creates a new parameter with multiple values.
    #[must_use]
    pub fn with_values(name: impl Into<String>, values: Vec<String>) -> Self {
        Self {
            name: name.into().to_ascii_uppercase(),
            values,
        }
    }

    /// Returns the first (and usually only) value.
    #[must_use]
    pub fn value(&self) -> Option<&str> {
        self.values.first().map(String::as_str)
    }

    /// Returns whether the parameter has the specified value (case-insensitive).
    #[must_use]
    pub fn has_value(&self, value: &str) -> bool {
        self.values
            .iter()
            .any(|v| v.eq_ignore_ascii_case(value))
    }

    /// Creates a TZID parameter.
    #[must_use]
    pub fn tzid(tzid: impl Into<String>) -> Self {
        Self::new("TZID", tzid)
    }

    /// Creates a VALUE parameter.
    #[must_use]
    pub fn value_type(value_type: impl Into<String>) -> Self {
        Self::new("VALUE", value_type)
    }

    /// Creates a LANGUAGE parameter.
    #[must_use]
    pub fn language(lang: impl Into<String>) -> Self {
        Self::new("LANGUAGE", lang)
    }

    /// Creates a CN (common name) parameter.
    #[must_use]
    pub fn cn(name: impl Into<String>) -> Self {
        Self::new("CN", name)
    }

    /// Creates a CUTYPE (calendar user type) parameter.
    #[must_use]
    pub fn cutype(cutype: impl Into<String>) -> Self {
        Self::new("CUTYPE", cutype)
    }

    /// Creates a PARTSTAT (participation status) parameter.
    #[must_use]
    pub fn partstat(status: impl Into<String>) -> Self {
        Self::new("PARTSTAT", status)
    }

    /// Creates a ROLE parameter.
    #[must_use]
    pub fn role(role: impl Into<String>) -> Self {
        Self::new("ROLE", role)
    }

    /// Creates an RSVP parameter.
    #[must_use]
    pub fn rsvp(rsvp: bool) -> Self {
        Self::new("RSVP", if rsvp { "TRUE" } else { "FALSE" })
    }

    /// Creates an ALTREP parameter.
    #[must_use]
    pub fn altrep(uri: impl Into<String>) -> Self {
        Self::new("ALTREP", uri)
    }

    /// Creates a RELATED parameter (for triggers).
    #[must_use]
    pub fn related(related: TriggerRelated) -> Self {
        Self::new("RELATED", related.as_str())
    }
}

impl fmt::Display for Parameter {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.name)?;
        if !self.values.is_empty() {
            write!(f, "=")?;
            for (i, value) in self.values.iter().enumerate() {
                if i > 0 {
                    write!(f, ",")?;
                }
                // Quote if needed
                if needs_quoting(value) {
                    write!(f, "\"{value}\"")?;
                } else {
                    write!(f, "{value}")?;
                }
            }
        }
        Ok(())
    }
}

/// Checks if a parameter value needs quoting.
fn needs_quoting(s: &str) -> bool {
    s.chars().any(|c| matches!(c, ':' | ';' | ',' | '"'))
}

/// RELATED parameter values for TRIGGER (RFC 5545 §3.2.14).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TriggerRelated {
    /// Relative to component start (default).
    #[default]
    Start,
    /// Relative to component end.
    End,
}

impl TriggerRelated {
    /// Returns the string representation.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Start => "START",
            Self::End => "END",
        }
    }
}

impl fmt::Display for TriggerRelated {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Common parameter names as constants.
#[expect(dead_code)]
pub mod names {
    /// Alternate text representation.
    pub const ALTREP: &str = "ALTREP";
    /// Common name.
    pub const CN: &str = "CN";
    /// Calendar user type.
    pub const CUTYPE: &str = "CUTYPE";
    /// Delegators.
    pub const DELEGATED_FROM: &str = "DELEGATED-FROM";
    /// Delegatees.
    pub const DELEGATED_TO: &str = "DELEGATED-TO";
    /// Directory entry.
    pub const DIR: &str = "DIR";
    /// Inline encoding.
    pub const ENCODING: &str = "ENCODING";
    /// Format type.
    pub const FMTTYPE: &str = "FMTTYPE";
    /// Free/busy time type.
    pub const FBTYPE: &str = "FBTYPE";
    /// Language.
    pub const LANGUAGE: &str = "LANGUAGE";
    /// Group or list membership.
    pub const MEMBER: &str = "MEMBER";
    /// Participation status.
    pub const PARTSTAT: &str = "PARTSTAT";
    /// Recurrence identifier range.
    pub const RANGE: &str = "RANGE";
    /// Alarm trigger relationship.
    pub const RELATED: &str = "RELATED";
    /// Relationship type.
    pub const RELTYPE: &str = "RELTYPE";
    /// Participation role.
    pub const ROLE: &str = "ROLE";
    /// RSVP expectation.
    pub const RSVP: &str = "RSVP";
    /// Sent by.
    pub const SENT_BY: &str = "SENT-BY";
    /// Time zone identifier.
    pub const TZID: &str = "TZID";
    /// Value data type.
    pub const VALUE: &str = "VALUE";
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parameter_display_simple() {
        let param = Parameter::new("TZID", "America/New_York");
        assert_eq!(param.to_string(), "TZID=America/New_York");
    }

    #[test]
    fn parameter_display_quoted() {
        let param = Parameter::new("CN", "Doe; Jane");
        assert_eq!(param.to_string(), "CN=\"Doe; Jane\"");
    }

    #[test]
    fn parameter_display_multiple_values() {
        let param = Parameter::with_values(
            "MEMBER",
            vec![
                "mailto:a@example.com".to_string(),
                "mailto:b@example.com".to_string(),
            ],
        );
        assert_eq!(
            param.to_string(),
            "MEMBER=mailto:a@example.com,mailto:b@example.com"
        );
    }

    #[test]
    fn parameter_name_normalized() {
        let param = Parameter::new("tzid", "Europe/London");
        assert_eq!(param.name, "TZID");
    }
}
