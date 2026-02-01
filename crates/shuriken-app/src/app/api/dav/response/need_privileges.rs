//! RFC 3744 §7.1.1 `DAV:need-privileges` error responses.
//!
//! This module provides helper functions to generate RFC-compliant 403 Forbidden
//! responses that include detailed information about missing privileges.

use salvo::Response;
use salvo::http::StatusCode;
use shuriken_rfc::rfc::dav::core::{DavError, Href, PrivilegeRequired};
use shuriken_service::auth::Action;

/// ## Summary
/// Sends a 403 Forbidden response with `DAV:need-privileges` error XML.
///
/// This function generates an RFC 3744 §7.1.1 compliant error response that
/// informs the client which privileges they lack on which resources.
///
/// ## Side Effects
/// Sets the response status to 403 Forbidden and writes XML body.
pub fn send_need_privileges_error(res: &mut Response, action: Action, href: &str) {
    res.status_code(StatusCode::FORBIDDEN);
    #[expect(unused)]
    res.add_header("Content-Type", "application/xml; charset=utf-8", true);

    let privilege = action_to_privilege_name(action);

    let xml = DavError::need_privileges(&[PrivilegeRequired {
        href: Href::new(href.to_string()),
        privilege: privilege.to_string(),
    }]);

    res.write_body(xml).ok();
}

/// ## Summary
/// Maps authorization actions to RFC 3744 privilege names.
///
/// Converts internal `Action` enum values to DAV privilege names as defined
/// in RFC 3744 §3.1.
fn action_to_privilege_name(action: Action) -> &'static str {
    match action {
        // Free-busy is subset of read
        Action::ReadFreebusy | Action::Read => "read",
        Action::Edit => "write-content",
        Action::Delete => "unbind",
        Action::ShareRead => "read-acl",
        Action::ShareEdit => "write-acl",
        Action::Admin => "all",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_mapping() {
        assert_eq!(action_to_privilege_name(Action::Read), "read");
        assert_eq!(action_to_privilege_name(Action::Edit), "write-content");
        assert_eq!(action_to_privilege_name(Action::Delete), "unbind");
        assert_eq!(action_to_privilege_name(Action::Admin), "all");
    }
}
