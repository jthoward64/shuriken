//! WebDAV/CalDAV/CardDAV XML test fixtures.
//!
//! Examples taken from RFC 4918 (`WebDAV`), RFC 4791 (`CalDAV`), RFC 6352 (`CardDAV`),
//! and RFC 6578 (sync-collection).

/// RFC 4918 §9.1 - PROPFIND with allprop
pub const PROPFIND_ALLPROP: &[u8] = br#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:allprop/>
</D:propfind>"#;

/// RFC 4918 §9.1 - PROPFIND with propname
pub const PROPFIND_PROPNAME: &[u8] = br#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:propname/>
</D:propfind>"#;

/// RFC 4918 §9.1 - PROPFIND with specific properties
pub const PROPFIND_PROP: &[u8] = br#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:displayname/>
    <D:getcontenttype/>
    <D:getcontentlength/>
    <D:getetag/>
    <D:resourcetype/>
  </D:prop>
</D:propfind>"#;

/// `CalDAV` specific PROPFIND
pub const PROPFIND_CALDAV: &[u8] = br#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:displayname/>
    <D:resourcetype/>
    <C:calendar-description/>
    <C:calendar-timezone/>
    <C:supported-calendar-component-set/>
  </D:prop>
</D:propfind>"#;

/// `CardDAV` specific PROPFIND
pub const PROPFIND_CARDDAV: &[u8] = br#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:prop>
    <D:displayname/>
    <D:resourcetype/>
    <C:addressbook-description/>
    <C:supported-address-data/>
  </D:prop>
</D:propfind>"#;

/// RFC 4918 §9.2 - PROPPATCH with set and remove
pub const PROPPATCH_SET_REMOVE: &[u8] = br#"<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <D:displayname>New Display Name</D:displayname>
    </D:prop>
  </D:set>
  <D:remove>
    <D:prop>
      <D:getcontentlanguage/>
    </D:prop>
  </D:remove>
</D:propertyupdate>"#;

/// `CalDAV` PROPPATCH
pub const PROPPATCH_CALDAV: &[u8] = br#"<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set>
    <D:prop>
      <D:displayname>Work Calendar</D:displayname>
      <C:calendar-description>My work calendar</C:calendar-description>
    </D:prop>
  </D:set>
</D:propertyupdate>"#;

/// RFC 4791 §7.8 - calendar-query REPORT
pub const REPORT_CALENDAR_QUERY: &[u8] = br#"<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="20230101T000000Z" end="20231231T235959Z"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>"#;

/// RFC 4791 §7.9 - calendar-multiget REPORT
pub const REPORT_CALENDAR_MULTIGET: &[u8] = br#"<?xml version="1.0" encoding="utf-8"?>
<C:calendar-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <D:href>/calendars/user/calendar/event1.ics</D:href>
  <D:href>/calendars/user/calendar/event2.ics</D:href>
</C:calendar-multiget>"#;

/// RFC 6352 §8.6 - addressbook-query REPORT
pub const REPORT_ADDRESSBOOK_QUERY: &[u8] = br#"<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:prop>
    <D:getetag/>
    <C:address-data/>
  </D:prop>
  <C:filter>
    <C:prop-filter name="FN">
      <C:text-match collation="i;unicode-casemap" match-type="contains">John</C:text-match>
    </C:prop-filter>
  </C:filter>
</C:addressbook-query>"#;

/// RFC 6352 §8.7 - addressbook-multiget REPORT
pub const REPORT_ADDRESSBOOK_MULTIGET: &[u8] = br#"<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:prop>
    <D:getetag/>
    <C:address-data/>
  </D:prop>
  <D:href>/addressbooks/user/contacts/card1.vcf</D:href>
  <D:href>/addressbooks/user/contacts/card2.vcf</D:href>
</C:addressbook-multiget>"#;

/// RFC 6578 §3.2 - sync-collection REPORT
pub const REPORT_SYNC_COLLECTION: &[u8] = br#"<?xml version="1.0" encoding="utf-8"?>
<D:sync-collection xmlns:D="DAV:">
  <D:sync-token>http://example.com/sync/1234</D:sync-token>
  <D:sync-level>1</D:sync-level>
  <D:prop>
    <D:getetag/>
  </D:prop>
</D:sync-collection>"#;

/// Initial sync-collection (empty sync-token)
pub const REPORT_SYNC_COLLECTION_INITIAL: &[u8] = br#"<?xml version="1.0" encoding="utf-8"?>
<D:sync-collection xmlns:D="DAV:">
  <D:sync-token/>
  <D:sync-level>1</D:sync-level>
  <D:prop>
    <D:getetag/>
  </D:prop>
</D:sync-collection>"#;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::component::rfc::dav::core::{ReportType, SyncLevel};
    use crate::component::rfc::dav::parse::{parse_propfind, parse_proppatch, parse_report};

    #[test]
    fn parse_propfind_allprop() {
        let result = parse_propfind(PROPFIND_ALLPROP).expect("should parse");
        assert!(result.is_allprop());
        assert!(!result.is_propname());
    }

    #[test]
    fn parse_propfind_propname() {
        let result = parse_propfind(PROPFIND_PROPNAME).expect("should parse");
        assert!(result.is_propname());
        assert!(!result.is_allprop());
    }

    #[test]
    fn parse_propfind_prop() {
        let result = parse_propfind(PROPFIND_PROP).expect("should parse");
        assert!(!result.is_allprop());
        assert!(!result.is_propname());

        let props = result.requested_properties().expect("should have properties");
        assert!(!props.is_empty());

        // Check for displayname
        assert!(props.iter().any(|p| p.local_name() == "displayname"));
        // Check for getetag
        assert!(props.iter().any(|p| p.local_name() == "getetag"));
    }

    #[test]
    fn parse_propfind_caldav() {
        let result = parse_propfind(PROPFIND_CALDAV).expect("should parse");

        let props = result.requested_properties().expect("should have properties");
        assert!(!props.is_empty());

        // Check for CalDAV-specific properties
        assert!(props.iter().any(|p| p.local_name() == "calendar-description"));
    }

    #[test]
    fn parse_propfind_carddav() {
        let result = parse_propfind(PROPFIND_CARDDAV).expect("should parse");

        let props = result.requested_properties().expect("should have properties");
        assert!(!props.is_empty());

        // Check for CardDAV-specific properties
        assert!(props
            .iter()
            .any(|p| p.local_name() == "addressbook-description"));
    }

    #[test]
    fn parse_proppatch_set_remove() {
        let result = parse_proppatch(PROPPATCH_SET_REMOVE).expect("should parse");
        assert!(!result.sets().is_empty());
        assert!(!result.removes().is_empty());
    }

    #[test]
    fn parse_proppatch_caldav() {
        let result = parse_proppatch(PROPPATCH_CALDAV).expect("should parse");
        let sets = result.sets();
        assert!(!sets.is_empty());

        // Check for displayname in set
        assert!(sets.iter().any(|p| p.name.local_name() == "displayname"));
    }

    #[test]
    fn parse_report_calendar_query() {
        let result = parse_report(REPORT_CALENDAR_QUERY).expect("should parse");
        match result.report_type {
            ReportType::CalendarQuery(_) => {}
            _ => panic!("Expected CalendarQuery report type"),
        }
    }

    #[test]
    fn parse_report_calendar_multiget() {
        let result = parse_report(REPORT_CALENDAR_MULTIGET).expect("should parse");
        match result.report_type {
            ReportType::CalendarMultiget(ref multiget) => {
                assert_eq!(multiget.hrefs.len(), 2);
            }
            _ => panic!("Expected CalendarMultiget report type"),
        }
    }

    #[test]
    fn parse_report_addressbook_query() {
        let result = parse_report(REPORT_ADDRESSBOOK_QUERY).expect("should parse");
        match result.report_type {
            ReportType::AddressbookQuery(_) => {}
            _ => panic!("Expected AddressbookQuery report type"),
        }
    }

    #[test]
    fn parse_report_addressbook_multiget() {
        let result = parse_report(REPORT_ADDRESSBOOK_MULTIGET).expect("should parse");
        match result.report_type {
            ReportType::AddressbookMultiget(ref multiget) => {
                assert_eq!(multiget.hrefs.len(), 2);
            }
            _ => panic!("Expected AddressbookMultiget report type"),
        }
    }

    #[test]
    fn parse_report_sync_collection() {
        let result = parse_report(REPORT_SYNC_COLLECTION).expect("should parse");
        match result.report_type {
            ReportType::SyncCollection(ref sync) => {
                assert!(!sync.sync_token.is_empty());
                assert_eq!(sync.sync_level, SyncLevel::One);
            }
            _ => panic!("Expected SyncCollection report type"),
        }
    }

    #[test]
    fn parse_report_sync_collection_initial() {
        let result = parse_report(REPORT_SYNC_COLLECTION_INITIAL).expect("should parse");
        match result.report_type {
            ReportType::SyncCollection(ref sync) => {
                // Initial sync has empty sync-token
                assert!(sync.sync_token.is_empty());
            }
            _ => panic!("Expected SyncCollection report type"),
        }
    }
}
