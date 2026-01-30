//! Tests for RFC 3744 §7.1.1 `DAV:need-privileges` error element.
//!
//! These tests verify that 403 Forbidden responses can include detailed
//! information about which privileges were required on which resources.

use crate::rfc::dav::core::{DavError, Href, PrivilegeRequired};

#[test]
fn need_privileges_single_read() {
    let xml = DavError::need_privileges(&[PrivilegeRequired {
        href: Href::new("/calendars/alice/work/"),
        privilege: "read".to_string(),
    }]);

    // Verify XML structure
    assert!(xml.contains(r#"<?xml version="1.0" encoding="utf-8"?>"#));
    assert!(xml.contains(r#"<D:error xmlns:D="DAV:">"#));
    assert!(xml.contains(r#"<D:need-privileges>"#));

    // Verify resource element
    assert!(xml.contains(r#"<D:resource>"#));
    assert!(xml.contains(r#"<D:href>/calendars/alice/work/</D:href>"#));

    // Verify privilege element
    assert!(xml.contains(r#"<D:privilege>"#));
    assert!(xml.contains(r#"<D:read/>"#));

    // Verify closing tags
    assert!(xml.contains(r#"</D:need-privileges>"#));
    assert!(xml.contains(r#"</D:error>"#));
}

#[test]
fn need_privileges_multiple_resources() {
    // Test case: user needs read on collection and write-content on specific resource
    let xml = DavError::need_privileges(&[
        PrivilegeRequired {
            href: Href::new("/calendars/alice/work/"),
            privilege: "read".to_string(),
        },
        PrivilegeRequired {
            href: Href::new("/calendars/alice/work/event.ics"),
            privilege: "write-content".to_string(),
        },
    ]);

    // Both resources should be present
    assert!(xml.contains(r#"<D:href>/calendars/alice/work/</D:href>"#));
    assert!(xml.contains(r#"<D:href>/calendars/alice/work/event.ics</D:href>"#));

    // Both privileges should be present
    assert!(xml.contains(r#"<D:read/>"#));
    assert!(xml.contains(r#"<D:write-content/>"#));

    // Should have 2 resource elements
    let resource_count = xml.matches("<D:resource>").count();
    assert_eq!(resource_count, 2);
}

#[test]
fn need_privileges_write_privilege() {
    let xml = DavError::need_privileges(&[PrivilegeRequired {
        href: Href::new("/calendars/bob/personal/event.ics"),
        privilege: "write".to_string(),
    }]);

    assert!(xml.contains(r#"<D:href>/calendars/bob/personal/event.ics</D:href>"#));
    assert!(xml.contains(r#"<D:write/>"#));
}

#[test]
fn need_privileges_write_properties() {
    let xml = DavError::need_privileges(&[PrivilegeRequired {
        href: Href::new("/calendars/carol/shared/"),
        privilege: "write-properties".to_string(),
    }]);

    assert!(xml.contains(r#"<D:write-properties/>"#));
}

#[test]
fn need_privileges_read_acl() {
    let xml = DavError::need_privileges(&[PrivilegeRequired {
        href: Href::new("/principals/users/alice/"),
        privilege: "read-acl".to_string(),
    }]);

    assert!(xml.contains(r#"<D:read-acl/>"#));
}

#[test]
fn need_privileges_all_privilege() {
    let xml = DavError::need_privileges(&[PrivilegeRequired {
        href: Href::new("/calendars/admin/system/"),
        privilege: "all".to_string(),
    }]);

    assert!(xml.contains(r#"<D:all/>"#));
}

#[test]
fn need_privileges_with_special_chars() {
    // Test XML escaping in hrefs
    let xml = DavError::need_privileges(&[PrivilegeRequired {
        href: Href::new("/calendars/user/name with spaces & <special> chars/"),
        privilege: "read".to_string(),
    }]);

    // Should be properly XML-escaped
    assert!(xml.contains("&amp;"));
    assert!(xml.contains("&lt;"));
    assert!(xml.contains("&gt;"));

    // Should not contain unescaped special characters
    assert!(!xml.contains("<D:href>/calendars/user/name with spaces & <special> chars/</D:href>"));
}

#[test]
fn need_privileges_empty_list() {
    // Edge case: empty privilege list (shouldn't happen in practice, but should be valid XML)
    let xml = DavError::need_privileges(&[]);

    assert!(xml.contains(r#"<D:need-privileges>"#));
    assert!(xml.contains(r#"</D:need-privileges>"#));

    // Should not have any resource elements
    assert!(!xml.contains("<D:resource>"));
}

#[test]
fn need_privileges_addressbook() {
    // CardDAV use case
    let xml = DavError::need_privileges(&[PrivilegeRequired {
        href: Href::new("/addressbooks/alice/contacts/"),
        privilege: "read".to_string(),
    }]);

    assert!(xml.contains(r#"<D:href>/addressbooks/alice/contacts/</D:href>"#));
    assert!(xml.contains(r#"<D:read/>"#));
}

#[test]
fn need_privileges_complex_scenario() {
    // Realistic scenario: MOVE operation requires multiple privileges
    let xml = DavError::need_privileges(&[
        PrivilegeRequired {
            href: Href::new("/calendars/alice/work/event.ics"),
            privilege: "unbind".to_string(),
        },
        PrivilegeRequired {
            href: Href::new("/calendars/alice/personal/"),
            privilege: "bind".to_string(),
        },
    ]);

    // Should include both operations
    assert!(xml.contains(r#"<D:unbind/>"#));
    assert!(xml.contains(r#"<D:bind/>"#));

    // Should have source and destination
    assert!(xml.contains(r#"<D:href>/calendars/alice/work/event.ics</D:href>"#));
    assert!(xml.contains(r#"<D:href>/calendars/alice/personal/</D:href>"#));
}

#[test]
fn need_privileges_xml_well_formed() {
    // Verify the XML is well-formed by checking tag balance
    let xml = DavError::need_privileges(&[
        PrivilegeRequired {
            href: Href::new("/test/1"),
            privilege: "read".to_string(),
        },
        PrivilegeRequired {
            href: Href::new("/test/2"),
            privilege: "write".to_string(),
        },
    ]);

    // Count opening and closing tags
    assert_eq!(xml.matches("<D:error").count(), 1);
    assert_eq!(xml.matches("</D:error>").count(), 1);
    assert_eq!(xml.matches("<D:need-privileges>").count(), 1);
    assert_eq!(xml.matches("</D:need-privileges>").count(), 1);
    assert_eq!(xml.matches("<D:resource>").count(), 2);
    assert_eq!(xml.matches("</D:resource>").count(), 2);
    assert_eq!(xml.matches("<D:href>").count(), 2);
    assert_eq!(xml.matches("</D:href>").count(), 2);
    assert_eq!(xml.matches("<D:privilege>").count(), 2);
    assert_eq!(xml.matches("</D:privilege>").count(), 2);
}

#[test]
fn privilege_required_clone() {
    let original = PrivilegeRequired {
        href: Href::new("/test/path"),
        privilege: "read".to_string(),
    };

    let cloned = original.clone();

    assert_eq!(original.href, cloned.href);
    assert_eq!(original.privilege, cloned.privilege);
}

#[test]
fn privilege_required_debug() {
    let priv_req = PrivilegeRequired {
        href: Href::new("/test/path"),
        privilege: "write".to_string(),
    };

    let debug_str = format!("{:?}", priv_req);

    assert!(debug_str.contains("PrivilegeRequired"));
    assert!(debug_str.contains("/test/path"));
    assert!(debug_str.contains("write"));
}
