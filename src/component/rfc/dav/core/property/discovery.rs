//! ## Summary
//! RFC-compliant computed live property generators for CalDAV/CardDAV discovery.
//!
//! Implements discovery properties required by RFC 4791 (CalDAV), RFC 6352 (CardDAV),
//! and RFC 3253 (Versioning, for supported-report-set). These properties allow clients
//! to discover server capabilities and supported operations.
//!
//! ## Properties Implemented
//! - `DAV:supported-report-set` (RFC 3253 §3.1.5) - Lists available REPORT methods
//! - `CALDAV:supported-calendar-component-set` (RFC 4791 §5.2.3) - Calendar component types
//! - `CARDDAV:supported-address-data` (RFC 6352 §6.2.2) - vCard version support
//! - `CALDAV:supported-collation-set` (RFC 4791 §7.5.1) - Text matching collations

use crate::component::db::enums::CollectionType;

/// ## Summary
/// Generates the `DAV:supported-report-set` property XML for a collection.
///
/// Returns an XML fragment listing all REPORT methods supported by the server
/// for the given collection type. This property is REQUIRED by CalDAV (RFC 4791)
/// and CardDAV (RFC 6352) for clients to discover available query operations.
///
/// ## Side Effects
/// None - pure function generating XML string.
///
/// ## Errors
/// None - always returns valid XML.
#[must_use]
pub fn supported_report_set(collection_type: CollectionType) -> String {
    match collection_type {
        CollectionType::Calendar => {
            // RFC 4791 §7: calendar-access servers MUST support these reports
            r#"<D:supported-report-set xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:supported-report>
    <D:report><C:calendar-query/></D:report>
  </D:supported-report>
  <D:supported-report>
    <D:report><C:calendar-multiget/></D:report>
  </D:supported-report>
  <D:supported-report>
    <D:report><D:sync-collection/></D:report>
  </D:supported-report>
</D:supported-report-set>"#
                .to_string()
        }
        CollectionType::Addressbook => {
            // RFC 6352 §3: addressbook servers MUST support these reports
            r#"<D:supported-report-set xmlns:D="DAV:" xmlns:CR="urn:ietf:params:xml:ns:carddav">
  <D:supported-report>
    <D:report><CR:addressbook-query/></D:report>
  </D:supported-report>
  <D:supported-report>
    <D:report><CR:addressbook-multiget/></D:report>
  </D:supported-report>
  <D:supported-report>
    <D:report><D:sync-collection/></D:report>
  </D:supported-report>
</D:supported-report-set>"#
                .to_string()
        }
        CollectionType::Collection => {
            // Plain collections only support sync-collection
            r#"<D:supported-report-set xmlns:D="DAV:">
  <D:supported-report>
    <D:report><D:sync-collection/></D:report>
  </D:supported-report>
</D:supported-report-set>"#
                .to_string()
        }
    }
}

/// ## Summary
/// Generates the `CALDAV:supported-calendar-component-set` property XML.
///
/// Returns an XML fragment listing all iCalendar component types (VEVENT, VTODO, etc.)
/// that the server can store and serve. This property is REQUIRED by RFC 4791 §5.2.3
/// for calendar collections.
///
/// ## Side Effects
/// None - pure function generating XML string.
///
/// ## Errors
/// None - always returns valid XML.
#[must_use]
pub fn supported_calendar_component_set() -> String {
    // RFC 4791 §5.2.3: Must advertise what component types are supported
    // We support the three core calendar component types
    r#"<C:supported-calendar-component-set xmlns:C="urn:ietf:params:xml:ns:caldav">
  <C:comp name="VEVENT"/>
  <C:comp name="VTODO"/>
  <C:comp name="VJOURNAL"/>
</C:supported-calendar-component-set>"#
        .to_string()
}

/// ## Summary
/// Generates the `CARDDAV:supported-address-data` property XML.
///
/// Returns an XML fragment advertising which vCard versions the server can accept
/// and return. This property is REQUIRED by RFC 6352 §6.2.2 for addressbook collections.
///
/// ## Side Effects
/// None - pure function generating XML string.
///
/// ## Errors
/// None - always returns valid XML.
#[must_use]
pub fn supported_address_data() -> String {
    // RFC 6352 §6.2.2: Advertise supported vCard versions
    // We support both vCard 3.0 and 4.0
    r#"<CR:supported-address-data xmlns:CR="urn:ietf:params:xml:ns:carddav">
  <CR:address-data-type content-type="text/vcard" version="3.0"/>
  <CR:address-data-type content-type="text/vcard" version="4.0"/>
</CR:supported-address-data>"#
        .to_string()
}

/// ## Summary
/// Generates the `CALDAV:supported-collation-set` property XML.
///
/// Returns an XML fragment listing text matching collations supported for
/// calendar property text-match filters. This property is defined in RFC 4791 §7.5.1
/// and is REQUIRED for CalDAV implementations.
///
/// ## Side Effects
/// None - pure function generating XML string.
///
/// ## Errors
/// None - always returns valid XML.
#[must_use]
pub fn supported_collation_set() -> String {
    // RFC 4791 §7.5.1: List supported text matching collations
    // RFC 4790: Collation registry for Internet protocols
    // We support:
    // - i;octet: Bitwise comparison (required baseline)
    // - i;ascii-casemap: ASCII case-insensitive (common, simple)
    // - i;unicode-casemap: Unicode case folding (RFC 4790 §9.2)
    r#"<C:supported-collation-set xmlns:C="urn:ietf:params:xml:ns:caldav">
  <C:supported-collation>i;octet</C:supported-collation>
  <C:supported-collation>i;ascii-casemap</C:supported-collation>
  <C:supported-collation>i;unicode-casemap</C:supported-collation>
</C:supported-collation-set>"#
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supported_report_set_calendar_contains_required_reports() {
        let xml = supported_report_set(CollectionType::Calendar);

        // RFC 4791 §7: MUST support these reports
        assert!(xml.contains("calendar-query"));
        assert!(xml.contains("calendar-multiget"));
        assert!(xml.contains("sync-collection"));

        // Should use correct namespaces
        assert!(xml.contains("xmlns:D=\"DAV:\""));
        assert!(xml.contains("xmlns:C=\"urn:ietf:params:xml:ns:caldav\""));

        // Should wrap in supported-report elements
        assert!(xml.contains("<D:supported-report>"));
        assert!(xml.contains("<D:report>"));
    }

    #[test]
    fn supported_report_set_addressbook_contains_required_reports() {
        let xml = supported_report_set(CollectionType::Addressbook);

        // RFC 6352 §3: MUST support these reports
        assert!(xml.contains("addressbook-query"));
        assert!(xml.contains("addressbook-multiget"));
        assert!(xml.contains("sync-collection"));

        // Should use correct namespaces
        assert!(xml.contains("xmlns:D=\"DAV:\""));
        assert!(xml.contains("xmlns:CR=\"urn:ietf:params:xml:ns:carddav\""));
    }

    #[test]
    fn supported_report_set_collection_contains_only_sync() {
        let xml = supported_report_set(CollectionType::Collection);

        // Plain collections only support sync-collection
        assert!(xml.contains("sync-collection"));

        // Should NOT contain calendar or addressbook specific reports
        assert!(!xml.contains("calendar-query"));
        assert!(!xml.contains("addressbook-query"));

        // Should use correct namespace
        assert!(xml.contains("xmlns:D=\"DAV:\""));
    }

    #[test]
    fn supported_calendar_component_set_contains_core_types() {
        let xml = supported_calendar_component_set();

        // RFC 4791 §5.2.3: MUST advertise supported component types
        assert!(xml.contains("VEVENT"));
        assert!(xml.contains("VTODO"));
        assert!(xml.contains("VJOURNAL"));

        // Should use correct namespace
        assert!(xml.contains("xmlns:C=\"urn:ietf:params:xml:ns:caldav\""));

        // Should use comp elements
        assert!(xml.contains("<C:comp name=\"VEVENT\"/>"));
    }

    #[test]
    fn supported_address_data_contains_vcard_versions() {
        let xml = supported_address_data();

        // RFC 6352 §6.2.2: Must advertise supported vCard versions
        assert!(xml.contains("version=\"3.0\""));
        assert!(xml.contains("version=\"4.0\""));
        assert!(xml.contains("content-type=\"text/vcard\""));

        // Should use correct namespace
        assert!(xml.contains("xmlns:CR=\"urn:ietf:params:xml:ns:carddav\""));

        // Should use address-data-type elements
        assert!(xml.contains("<CR:address-data-type"));
    }

    #[test]
    fn supported_collation_set_contains_required_collations() {
        let xml = supported_collation_set();

        // RFC 4791 §7.5.1: Must list supported collations
        assert!(xml.contains("i;octet"));
        assert!(xml.contains("i;ascii-casemap"));
        assert!(xml.contains("i;unicode-casemap"));

        // Should use correct namespace
        assert!(xml.contains("xmlns:C=\"urn:ietf:params:xml:ns:caldav\""));

        // Should use supported-collation elements
        assert!(xml.contains("<C:supported-collation>"));
    }

    #[test]
    fn all_property_generators_return_valid_xml_structure() {
        // Test that all generators return non-empty strings with basic XML structure
        let calendar_reports = supported_report_set(CollectionType::Calendar);
        let addressbook_reports = supported_report_set(CollectionType::Addressbook);
        let collection_reports = supported_report_set(CollectionType::Collection);
        let components = supported_calendar_component_set();
        let address_data = supported_address_data();
        let collations = supported_collation_set();

        // All should be non-empty
        assert!(!calendar_reports.is_empty());
        assert!(!addressbook_reports.is_empty());
        assert!(!collection_reports.is_empty());
        assert!(!components.is_empty());
        assert!(!address_data.is_empty());
        assert!(!collations.is_empty());

        // All should contain opening and closing tags (basic XML validity check)
        for xml in &[
            calendar_reports,
            addressbook_reports,
            collection_reports,
            components,
            address_data,
            collations,
        ] {
            assert!(xml.contains('<'));
            assert!(xml.contains('>'));
            assert!(xml.contains("xmlns"));
        }
    }
}
