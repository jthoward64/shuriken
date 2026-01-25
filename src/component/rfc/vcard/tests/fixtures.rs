//! RFC 6350 vCard test fixtures.
//!
//! Examples taken from RFC 6350 and common use cases.

/// RFC 6350 §7 - Author's vCard example
pub const VCARD_AUTHOR: &str = "\
BEGIN:VCARD\r\n\
VERSION:4.0\r\n\
FN:Simon Perreault\r\n\
N:Perreault;Simon;;;ing. jr,M.Sc.\r\n\
BDAY:--0203\r\n\
GENDER:M\r\n\
LANG;PREF=1:fr\r\n\
LANG;PREF=2:en\r\n\
ORG;TYPE=work:Viagenie\r\n\
TEL;VALUE=uri;TYPE=work,voice;PREF=1:tel:+1-418-656-9254;ext=102\r\n\
EMAIL;TYPE=work:simon.perreault@viagenie.ca\r\n\
URL;TYPE=home:http://nomis80.org\r\n\
END:VCARD\r\n";

/// Basic vCard 4.0
pub const VCARD_BASIC: &str = "\
BEGIN:VCARD\r\n\
VERSION:4.0\r\n\
FN:John Doe\r\n\
N:Doe;John;;;\r\n\
EMAIL:john.doe@example.com\r\n\
TEL:+1-555-555-5555\r\n\
END:VCARD\r\n";

/// vCard with structured name
pub const VCARD_STRUCTURED_NAME: &str = "\
BEGIN:VCARD\r\n\
VERSION:4.0\r\n\
FN:Mr. John Q. Public Esq.\r\n\
N:Public;John;Quinlan;Mr.;Esq.\r\n\
END:VCARD\r\n";

/// vCard with organization
pub const VCARD_ORGANIZATION: &str = "\
BEGIN:VCARD\r\n\
VERSION:4.0\r\n\
FN:Jane Smith\r\n\
N:Smith;Jane;;;\r\n\
ORG:Acme Corporation;Engineering;Backend Team\r\n\
TITLE:Senior Software Engineer\r\n\
ROLE:Developer\r\n\
END:VCARD\r\n";

/// vCard with multiple addresses
pub const VCARD_ADDRESSES: &str = "\
BEGIN:VCARD\r\n\
VERSION:4.0\r\n\
FN:Robert Wilson\r\n\
N:Wilson;Robert;;;\r\n\
ADR;TYPE=work:;;123 Main St;Anytown;CA;12345;USA\r\n\
ADR;TYPE=home:;;456 Oak Ave;Hometown;NY;67890;USA\r\n\
END:VCARD\r\n";

/// vCard with categories
pub const VCARD_CATEGORIES: &str = "\
BEGIN:VCARD\r\n\
VERSION:4.0\r\n\
FN:Bob Categories\r\n\
N:Categories;Bob;;;\r\n\
CATEGORIES:WORK,FRIEND,COLLEAGUE\r\n\
END:VCARD\r\n";

/// vCard with note
pub const VCARD_NOTE: &str = "\
BEGIN:VCARD\r\n\
VERSION:4.0\r\n\
FN:Carol Note\r\n\
N:Note;Carol;;;\r\n\
NOTE:This is a sample note.\r\n\
END:VCARD\r\n";

/// vCard with anniversary and birthday
pub const VCARD_DATES: &str = "\
BEGIN:VCARD\r\n\
VERSION:4.0\r\n\
FN:David Dates\r\n\
N:Dates;David;;;\r\n\
BDAY:19850315\r\n\
ANNIVERSARY:20100621\r\n\
END:VCARD\r\n";

/// vCard with URL
pub const VCARD_URLS: &str = "\
BEGIN:VCARD\r\n\
VERSION:4.0\r\n\
FN:Eve URLs\r\n\
N:URLs;Eve;;;\r\n\
URL:https://example.com/eve\r\n\
URL;TYPE=work:https://company.com/eve\r\n\
END:VCARD\r\n";

/// vCard with UID
pub const VCARD_UID: &str = "\
BEGIN:VCARD\r\n\
VERSION:4.0\r\n\
UID:urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6\r\n\
FN:Frank UID\r\n\
N:UID;Frank;;;\r\n\
END:VCARD\r\n";

/// vCard with related
pub const VCARD_RELATED: &str = "\
BEGIN:VCARD\r\n\
VERSION:4.0\r\n\
FN:Grace Related\r\n\
N:Related;Grace;;;\r\n\
RELATED;TYPE=spouse:urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6\r\n\
END:VCARD\r\n";

/// vCard 3.0 format (for compatibility testing)
pub const VCARD_V3: &str = "\
BEGIN:VCARD\r\n\
VERSION:3.0\r\n\
FN:Henry V3\r\n\
N:V3;Henry;;;\r\n\
EMAIL;TYPE=INTERNET:henry@example.com\r\n\
TEL;TYPE=CELL:+1-555-123-4567\r\n\
END:VCARD\r\n";

/// vCard with gender
pub const VCARD_GENDER: &str = "\
BEGIN:VCARD\r\n\
VERSION:4.0\r\n\
FN:Irene Gender\r\n\
N:Gender;Irene;;;\r\n\
GENDER:F;female\r\n\
END:VCARD\r\n";

/// vCard with timezone
pub const VCARD_TIMEZONE: &str = "\
BEGIN:VCARD\r\n\
VERSION:4.0\r\n\
FN:Jack TZ\r\n\
N:TZ;Jack;;;\r\n\
TZ:America/New_York\r\n\
END:VCARD\r\n";

/// vCard with multiple emails with preferences
pub const VCARD_EMAIL_PREF: &str = "\
BEGIN:VCARD\r\n\
VERSION:4.0\r\n\
FN:Kate Email\r\n\
N:Email;Kate;;;\r\n\
EMAIL;TYPE=work;PREF=1:kate.work@example.com\r\n\
EMAIL;TYPE=home;PREF=2:kate.home@example.com\r\n\
END:VCARD\r\n";

/// vCard with IMPP (instant messaging)
pub const VCARD_IMPP: &str = "\
BEGIN:VCARD\r\n\
VERSION:4.0\r\n\
FN:Larry IM\r\n\
N:IM;Larry;;;\r\n\
IMPP;PREF=1:xmpp:larry@example.com\r\n\
IMPP:sip:larry@voip.example.com\r\n\
END:VCARD\r\n";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::component::rfc::vcard::core::VCardVersion;
    use crate::component::rfc::vcard::parse::parse_single;

    #[test]
    fn parse_vcard_author() {
        let vcard = parse_single(VCARD_AUTHOR).expect("should parse");
        assert_eq!(vcard.version, VCardVersion::V4);

        let fn_prop = vcard
            .properties
            .iter()
            .find(|p| p.name == "FN")
            .expect("should have FN");
        assert_eq!(fn_prop.raw_value, "Simon Perreault");
    }

    #[test]
    fn parse_vcard_basic() {
        let vcard = parse_single(VCARD_BASIC).expect("should parse");
        assert_eq!(vcard.version, VCardVersion::V4);

        let email = vcard
            .properties
            .iter()
            .find(|p| p.name == "EMAIL")
            .expect("should have EMAIL");
        assert_eq!(email.raw_value, "john.doe@example.com");
    }

    #[test]
    fn parse_vcard_structured_name() {
        let vcard = parse_single(VCARD_STRUCTURED_NAME).expect("should parse");

        let n = vcard
            .properties
            .iter()
            .find(|p| p.name == "N")
            .expect("should have N");
        assert!(n.raw_value.contains("Public"));
        assert!(n.raw_value.contains("John"));
    }

    #[test]
    fn parse_vcard_organization() {
        let vcard = parse_single(VCARD_ORGANIZATION).expect("should parse");

        let org = vcard
            .properties
            .iter()
            .find(|p| p.name == "ORG")
            .expect("should have ORG");
        assert!(org.raw_value.contains("Acme"));
    }

    #[test]
    fn parse_vcard_addresses() {
        let vcard = parse_single(VCARD_ADDRESSES).expect("should parse");

        let addrs: Vec<_> = vcard
            .properties
            .iter()
            .filter(|p| p.name == "ADR")
            .collect();
        assert_eq!(addrs.len(), 2);
    }

    #[test]
    fn parse_vcard_categories() {
        let vcard = parse_single(VCARD_CATEGORIES).expect("should parse");

        let categories = vcard
            .properties
            .iter()
            .find(|p| p.name == "CATEGORIES")
            .expect("should have CATEGORIES");
        assert!(categories.raw_value.contains("WORK"));
        assert!(categories.raw_value.contains("FRIEND"));
    }

    #[test]
    fn parse_vcard_uid() {
        let vcard = parse_single(VCARD_UID).expect("should parse");

        let uid = vcard
            .properties
            .iter()
            .find(|p| p.name == "UID")
            .expect("should have UID");
        assert!(uid.raw_value.contains("f81d4fae"));
    }

    #[test]
    fn parse_vcard_v3() {
        let vcard = parse_single(VCARD_V3).expect("should parse v3");
        assert_eq!(vcard.version, VCardVersion::V3);
    }

    #[test]
    fn parse_vcard_gender() {
        let vcard = parse_single(VCARD_GENDER).expect("should parse");

        let gender = vcard
            .properties
            .iter()
            .find(|p| p.name == "GENDER")
            .expect("should have GENDER");
        assert!(gender.raw_value.contains('F'));
    }

    #[test]
    fn parse_vcard_email_with_pref() {
        let vcard = parse_single(VCARD_EMAIL_PREF).expect("should parse");

        let emails: Vec<_> = vcard
            .properties
            .iter()
            .filter(|p| p.name == "EMAIL")
            .collect();
        assert_eq!(emails.len(), 2);

        // Check that PREF parameter exists
        let work_email = emails
            .iter()
            .find(|e| e.raw_value.contains("work"))
            .expect("should have work email");
        assert!(work_email.params.iter().any(|p| p.name == "PREF"));
    }
}
