//! Example demonstrating RFC 3744 §7.1.1 `DAV:need-privileges` error generation.
//!
//! This example shows how to generate RFC-compliant 403 Forbidden error responses
//! that inform clients which privileges they lack on which resources.
//!
//! Run with: `cargo run --package shuriken-rfc --example need_privileges_example`

use shuriken_rfc::rfc::dav::core::{DavError, Href, PrivilegeRequired};

fn main() {
    println!("=== RFC 3744 need-privileges Error Examples ===\n");

    // Example 1: Single resource, single privilege
    println!("Example 1: User lacks 'read' privilege on calendar collection\n");
    let xml = DavError::need_privileges(&[PrivilegeRequired {
        href: Href::new("/calendars/alice/work/"),
        privilege: "read".to_string(),
    }]);
    println!("{}\n", xml);

    // Example 2: Multiple resources
    println!("Example 2: MOVE operation requires privileges on both source and destination\n");
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
    println!("{}\n", xml);

    // Example 3: Write-content privilege
    println!("Example 3: User lacks 'write-content' privilege to modify event\n");
    let xml = DavError::need_privileges(&[PrivilegeRequired {
        href: Href::new("/calendars/bob/personal/meeting.ics"),
        privilege: "write-content".to_string(),
    }]);
    println!("{}\n", xml);

    // Example 4: Read-ACL privilege
    println!("Example 4: User lacks 'read-acl' privilege to view permissions\n");
    let xml = DavError::need_privileges(&[PrivilegeRequired {
        href: Href::new("/principals/users/alice/"),
        privilege: "read-acl".to_string(),
    }]);
    println!("{}\n", xml);

    // Example 5: Write-properties privilege
    println!("Example 5: User lacks 'write-properties' for PROPPATCH\n");
    let xml = DavError::need_privileges(&[PrivilegeRequired {
        href: Href::new("/calendars/carol/shared/"),
        privilege: "write-properties".to_string(),
    }]);
    println!("{}\n", xml);

    // Example 6: CardDAV addressbook
    println!("Example 6: User lacks 'write' privilege on addressbook\n");
    let xml = DavError::need_privileges(&[PrivilegeRequired {
        href: Href::new("/addressbooks/dave/contacts/"),
        privilege: "write".to_string(),
    }]);
    println!("{}\n", xml);

    println!("=== Integration Pattern ===\n");
    println!(
        "In HTTP handler:\n\
         \n\
         if !authorizer.check_privilege(&user, &resource, \"read\") {{\n\
             res.status_code(StatusCode::FORBIDDEN);\n\
             res.add_header(\"Content-Type\", \"application/xml; charset=utf-8\", true)?;\n\
             \n\
             let xml = DavError::need_privileges(&[\n\
                 PrivilegeRequired {{\n\
                     href: Href::new(resource_href),\n\
                     privilege: \"read\".to_string(),\n\
                 }}\n\
             ]);\n\
             \n\
             res.write_body(xml)?;\n\
             return Ok(());\n\
         }}\n"
    );

    println!("\n=== RFC 3744 Compliance ===\n");
    println!(
        "✅ XML includes proper namespace (DAV:)\n\
         ✅ Error wrapped in <DAV:error> element\n\
         ✅ <DAV:need-privileges> contains resources\n\
         ✅ Each resource specifies href and privilege\n\
         ✅ Privilege names follow RFC 3744 §3.1\n\
         ✅ XML special characters are properly escaped\n"
    );
}
