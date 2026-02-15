//! vCard property name types (RFC 6350).

use crate::define_names;
use crate::rfc::ical::core::NormalizedValue;

define_names! {
    /// vCard property names (RFC 6350).
    ///
    /// Normalized enum representation of property names with case-insensitive
    /// matching. Unknown property names are represented as `None` in the
    /// `NormalizedValue::parsed` field.
    pub VCardPropertyName,

    // Identification properties (RFC 6350 §6.1)
    Fn => "FN",
    N => "N",
    Nickname => "NICKNAME",
    Photo => "PHOTO",
    Bday => "BDAY",
    Anniversary => "ANNIVERSARY",
    Gender => "GENDER",

    // Delivery addressing (RFC 6350 §6.2)
    Adr => "ADR",

    // Communications (RFC 6350 §6.3)
    Tel => "TEL",
    Email => "EMAIL",
    Impp => "IMPP",
    Lang => "LANG",

    // Geographical (RFC 6350 §6.4)
    Tz => "TZ",
    Geo => "GEO",

    // Organizational (RFC 6350 §6.5)
    Title => "TITLE",
    Role => "ROLE",
    Logo => "LOGO",
    Org => "ORG",
    Member => "MEMBER",
    Related => "RELATED",

    // Explanatory (RFC 6350 §6.6)
    Categories => "CATEGORIES",
    Note => "NOTE",
    Prodid => "PRODID",
    Rev => "REV",
    Sound => "SOUND",
    Uid => "UID",
    Clientpidmap => "CLIENTPIDMAP",
    Url => "URL",
    Version => "VERSION",

    // Security (RFC 6350 §6.7)
    Key => "KEY",

    // Calendar (RFC 6350 §6.8)
    Fburl => "FBURL",
    Caladruri => "CALADRURI",
    Caluri => "CALURI",

    // Extended (RFC 6350 §6.9)
    Xml => "XML",

    // General
    Begin => "BEGIN",
    End => "END",
    Source => "SOURCE",
    Kind => "KIND",
}

/// Type alias for vCard property names with case-preserving original value.
pub type VCardPropertyNameValue = NormalizedValue<VCardPropertyName>;

impl VCardPropertyNameValue {
    /// Returns the known property name variant, if recognized.
    #[must_use]
    pub fn known(&self) -> Option<VCardPropertyName> {
        self.parsed
    }

    /// Returns whether this is a known standard property name.
    #[must_use]
    pub fn is_known(&self) -> bool {
        self.parsed.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn property_name_case_insensitive() {
        let name1 = VCardPropertyNameValue::new("FN");
        let name2 = VCardPropertyNameValue::new("fn");
        let name3 = VCardPropertyNameValue::new("Fn");

        assert_eq!(name1, name2);
        assert_eq!(name2, name3);
        assert_eq!(name1.as_str(), "FN");
        assert_eq!(name2.as_str(), "fn");
    }

    #[test]
    fn property_name_unknown() {
        let name = VCardPropertyNameValue::new("X-CUSTOM-PROP");
        assert!(!name.is_known());
        assert_eq!(name.known(), None);
        assert_eq!(name.as_str(), "X-CUSTOM-PROP");
    }

    #[test]
    fn property_name_known() {
        let name = VCardPropertyNameValue::new("EMAIL");
        assert!(name.is_known());
        assert_eq!(name.known(), Some(VCardPropertyName::Email));
    }
}
