//! Test execution context and variable substitution.
//!
//! Manages variables and state during test execution.

use std::collections::HashMap;

/// Test execution context holding variables and state
#[derive(Debug, Clone)]
pub struct TestContext {
    /// Variable storage
    variables: HashMap<String, String>,
}

impl TestContext {
    /// Create a new test context with default variables
    #[must_use]
    pub fn new() -> Self {
        let mut ctx = Self {
            variables: HashMap::new(),
        };
        ctx.init_default_variables();
        ctx
    }

    /// Initialize default CalDAV test variables.
    ///
    /// These mirror the substitutions defined in a typical
    /// `serverinfo.xml` for the Apple ccs-caldavtester. Many of
    /// the higher-level paths are built by composing lower-level
    /// variables, just as the Python runner does.
    fn init_default_variables(&mut self) {
        // ── Server ───────────────────────────────────────────────────────
        self.set("$host:", "localhost");
        self.set("$hostssl:", "localhost");
        self.set("$port:", "8080");
        self.set("$portssl:", "8443");

        // ── Root paths ───────────────────────────────────────────────────
        self.set("$root:", "/");
        self.set("$pathprefix:", "/dav");
        self.set("$principalcollection:", "/dav/principals/");
        self.set("$calendars:", "/dav/calendars/");
        self.set("$addressbooks:", "/dav/addressbooks/");

        // ── Namespace shorthands (used inside propfindItems args) ────────
        self.set("$CALDAV:", "urn:ietf:params:xml:ns:caldav");
        self.set("$CARDDAV:", "urn:ietf:params:xml:ns:carddav");
        self.set("$CS:", "http://calendarserver.org/ns/");

        // ── Verification helpers ─────────────────────────────────────────
        self.set(
            "$verify-property-prefix:",
            "/{DAV:}multistatus/{DAV:}response/{DAV:}propstat/{DAV:}prop",
        );
        self.set(
            "$verify-response-prefix:",
            "/{DAV:}multistatus/{DAV:}response",
        );
        self.set(
            "$multistatus-href-prefix:",
            "/{DAV:}multistatus/{DAV:}response/{DAV:}href",
        );

        // ── User 1 (default auth) ────────────────────────────────────────
        self.set("$userid1:", "user01");
        self.set("$pswd1:", "password");
        self.set("$email1:", "user01@example.com");
        self.set("$cuaddr1:", "mailto:user01@example.com");
        self.set("$userguid1:", "10000000-0000-0000-0000-000000000001");
        self.set("$principal1:", "/dav/principals/user01/");
        self.set("$principaluri1:", "/dav/principals/user01/");
        self.set("$calendarhome1:", "/dav/calendars/user01");
        self.set("$calendarpath1:", "/dav/calendars/user01/calendar");
        self.set("$taskspath1:", "/dav/calendars/user01/tasks");
        self.set("$inboxpath1:", "/dav/calendars/user01/inbox");
        self.set("$outboxpath1:", "/dav/calendars/user01/outbox");
        self.set("$notificationpath1:", "/dav/calendars/user01/notification");
        self.set("$dropboxpath1:", "/dav/calendars/user01/dropbox");
        self.set("$addressbookhome1:", "/dav/addressbooks/user01");
        self.set("$addressbookpath1:", "/dav/addressbooks/user01/addressbook");

        // ── User 2 ──────────────────────────────────────────────────────
        self.set("$userid2:", "user02");
        self.set("$pswd2:", "password");
        self.set("$email2:", "user02@example.com");
        self.set("$cuaddr2:", "mailto:user02@example.com");
        self.set("$userguid2:", "10000000-0000-0000-0000-000000000002");
        self.set("$principal2:", "/dav/principals/user02/");
        self.set("$principaluri2:", "/dav/principals/user02/");
        self.set("$calendarhome2:", "/dav/calendars/user02");
        self.set("$calendarpath2:", "/dav/calendars/user02/calendar");
        self.set("$taskspath2:", "/dav/calendars/user02/tasks");
        self.set("$inboxpath2:", "/dav/calendars/user02/inbox");
        self.set("$outboxpath2:", "/dav/calendars/user02/outbox");
        self.set("$notificationpath2:", "/dav/calendars/user02/notification");
        self.set("$addressbookhome2:", "/dav/addressbooks/user02");
        self.set("$addressbookpath2:", "/dav/addressbooks/user02/addressbook");

        // ── User 3 ──────────────────────────────────────────────────────
        self.set("$userid3:", "user03");
        self.set("$pswd3:", "password");
        self.set("$email3:", "user03@example.com");
        self.set("$cuaddr3:", "mailto:user03@example.com");
        self.set("$userguid3:", "10000000-0000-0000-0000-000000000003");
        self.set("$principal3:", "/dav/principals/user03/");
        self.set("$principaluri3:", "/dav/principals/user03/");
        self.set("$calendarhome3:", "/dav/calendars/user03");
        self.set("$calendarpath3:", "/dav/calendars/user03/calendar");
        self.set("$inboxpath3:", "/dav/calendars/user03/inbox");
        self.set("$notificationpath3:", "/dav/calendars/user03/notification");
        self.set("$addressbookhome3:", "/dav/addressbooks/user03");
        self.set("$addressbookpath3:", "/dav/addressbooks/user03/addressbook");

        // ── Users 4-10 (minimal, for tests that reference them) ──────────
        for i in 4..=10 {
            let uid = format!("user{i:02}");
            let guid = format!("10000000-0000-0000-0000-0000000000{i:02}");
            self.set(&format!("$userid{i}:"), &uid);
            self.set(&format!("$pswd{i}:"), "password");
            self.set(&format!("$email{i}:"), &format!("{uid}@example.com"));
            self.set(
                &format!("$cuaddr{i}:"),
                &format!("mailto:{uid}@example.com"),
            );
            self.set(&format!("$userguid{i}:"), &guid);
            self.set(
                &format!("$calendarhome{i}:"),
                &format!("/dav/calendars/{uid}"),
            );
            self.set(
                &format!("$calendarpath{i}:"),
                &format!("/dav/calendars/{uid}/calendar"),
            );
            self.set(
                &format!("$addressbookhome{i}:"),
                &format!("/dav/addressbooks/{uid}"),
            );
            self.set(
                &format!("$addressbookpath{i}:"),
                &format!("/dav/addressbooks/{uid}/addressbook"),
            );
        }

        // ── Admin ────────────────────────────────────────────────────────
        self.set("$useradmin:", "admin");
        self.set("$pswdadmin:", "admin");

        // ── Misc defaults used in various test files ─────────────────────
        self.set("$calendar:", "calendar");
        self.set("$addressbook:", "addressbook");
        self.set("$calendar_sync_extra_items:", "");
        self.set("$calendar_sync_extra_count:", "0");
        self.set("$timezoneservice:", "/dav/timezones");
        self.set("$location:", "");
        self.set("$inviteuid:", "");
        self.set("$sharedcalendar:", "shared");
        self.set("$sharedcalendar2:", "shared2");
        self.set("$schedule-tag-organizer:", "");

        // ── Prefix for UID-based CalDAV paths ────────────────────────────
        self.set("$calendars_uids:", "/dav/calendars/");
        self.set("$calendars_users:", "/dav/calendars/");
        self.set("$addressbooks_uids:", "/dav/addressbooks/");
        self.set("$addressbooks_users:", "/dav/addressbooks/");
        self.set("$calendars_resources:", "/dav/calendars/");
        self.set("$calendars_locations:", "/dav/calendars/");

        // ── Resource calendar paths (rcalendarpath, rinboxpath) ──────────
        self.set("$rcalendarpath1:", "/dav/calendars/resource01/calendar");
        self.set("$rinboxpath1:", "/dav/calendars/resource01/inbox");
    }

    /// Set a variable value
    pub fn set(&mut self, name: &str, value: &str) {
        self.variables.insert(name.to_string(), value.to_string());
    }

    /// Get a variable value.
    #[must_use]
    pub fn get(&self, name: &str) -> Option<&str> {
        self.variables.get(name).map(String::as_str)
    }

    /// Substitute variables in a string.
    ///
    /// Replaces `$variable:` patterns with their values. Unresolved
    /// variables are left as-is (many are set dynamically via
    /// grab-headers and cannot be resolved ahead of time).
    #[must_use]
    pub fn substitute(&self, input: &str) -> String {
        let mut result = input.to_string();

        // Repeatedly apply substitutions until no more changes occur
        // (handles chained references like $calendarpath1: → $calendarhome1:/calendar)
        loop {
            let prev = result.clone();
            for (var_name, var_value) in &self.variables {
                result = result.replace(var_name.as_str(), var_value);
            }
            if result == prev {
                break;
            }
        }

        result
    }

    /// Substitute variables in an optional string.
    #[must_use]
    pub fn substitute_opt(&self, input: Option<&str>) -> Option<String> {
        input.map(|s| self.substitute(s))
    }
}

impl Default for TestContext {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_variable_substitution() {
        let mut ctx = TestContext::new();
        ctx.set("$myvar:", "myvalue");

        let result = ctx.substitute("test $myvar: here");
        assert_eq!(result, "test myvalue here");
    }

    #[test]
    fn test_missing_variable_left_as_is() {
        let ctx = TestContext::new();
        let result = ctx.substitute("test $missing: here");
        assert_eq!(result, "test $missing: here");
    }

    #[test]
    fn test_default_variables() {
        let ctx = TestContext::new();
        assert_eq!(ctx.get("$host:"), Some("localhost"));
        assert_eq!(ctx.get("$userid1:"), Some("user01"));
        assert_eq!(ctx.get("$CALDAV:"), Some("urn:ietf:params:xml:ns:caldav"));
        assert_eq!(ctx.get("$nonexistent:"), None);
    }

    #[test]
    fn test_chained_substitution() {
        let mut ctx = TestContext::new();
        ctx.set("$base:", "/root");
        ctx.set("$full:", "$base:/child");

        let result = ctx.substitute("path=$full:");
        assert_eq!(result, "path=/root/child");
    }
}
