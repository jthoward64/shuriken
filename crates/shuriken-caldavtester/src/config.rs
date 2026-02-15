//! Test suite configuration.
//!
//! Defines which test files are enabled and what features the server supports.
//! To enable or disable tests, simply change the boolean value next to each
//! test file entry below.

use std::collections::HashSet;
use std::path::PathBuf;

/// An individual test entry with its path and enabled flag.
#[derive(Debug, Clone)]
pub struct TestEntry {
    /// Path relative to the `test-suite/tests/` directory.
    pub path: &'static str,
    /// Whether to run this test.
    pub enabled: bool,
}

/// ## Summary
///
/// Returns the full manifest of CalDAV test files.
///
/// Every XML test file from the Apple ccs-caldavtester suite is listed here.
/// Flip the boolean to `true` to enable a test, `false` to skip it.
///
/// Tests are disabled by default because the server is still under active
/// development. Enable them incrementally as features are implemented.
#[must_use]
pub fn caldav_tests() -> Vec<TestEntry> {
    vec![
        // ── Core WebDAV / CalDAV ─────────────────────────────────────────
        TestEntry {
            path: "CalDAV/get.xml",
            enabled: true,
        },
        TestEntry {
            path: "CalDAV/put.xml",
            enabled: true,
        },
        TestEntry {
            path: "CalDAV/delete.xml",
            enabled: true,
        },
        TestEntry {
            path: "CalDAV/mkcalendar.xml",
            enabled: true,
        },
        TestEntry {
            path: "CalDAV/propfind.xml",
            enabled: true,
        },
        TestEntry {
            path: "CalDAV/proppatch.xml",
            enabled: true,
        },
        TestEntry {
            path: "CalDAV/options.xml",
            enabled: true,
        },
        TestEntry {
            path: "CalDAV/well-known.xml",
            enabled: true,
        },
        TestEntry {
            path: "CalDAV/current-user-principal.xml",
            enabled: true,
        },
        // ── Conditional / ETag ───────────────────────────────────────────
        TestEntry {
            path: "CalDAV/conditional.xml",
            enabled: true,
        },
        TestEntry {
            path: "CalDAV/ctag.xml",
            enabled: true,
        },
        // ── Reports ──────────────────────────────────────────────────────
        TestEntry {
            path: "CalDAV/reports.xml",
            enabled: true,
        },
        TestEntry {
            path: "CalDAV/depthreports.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/depthreportsacl.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/sync-report.xml",
            enabled: true,
        },
        TestEntry {
            path: "CalDAV/expandproperty.xml",
            enabled: false,
        },
        // ── Calendar data ────────────────────────────────────────────────
        TestEntry {
            path: "CalDAV/recurrenceput.xml",
            enabled: true,
        },
        TestEntry {
            path: "CalDAV/recurrence-splitting.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/floating.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/timezones.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/vtodos.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/nonascii.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/bad-ical.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/bad-json.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/json.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/rscale.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/errors.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/duplicate_uids.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/encodedURIs.xml",
            enabled: false,
        },
        // ── ACL ──────────────────────────────────────────────────────────
        TestEntry {
            path: "CalDAV/acl.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/aclreports.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitacls.xml",
            enabled: false,
        },
        // ── Copy / Move ──────────────────────────────────────────────────
        TestEntry {
            path: "CalDAV/copymove.xml",
            enabled: false,
        },
        // ── Scheduling (iMIP / implicit) ─────────────────────────────────
        TestEntry {
            path: "CalDAV/freebusy.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/freebusy-url.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/extended-freebusy.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/schedulepost.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/schedulepostacl.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/schedulepostmaskuid.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/scheduleprops.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/schedulenomore.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/scheduleimplicit-compatability.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitallday.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitattendeedelete.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitauto1.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitauto2.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitauto3.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitauto4.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitauto5.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitauto6.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitauto7.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitauto8.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitauto9.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitauto10.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitauto11.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitauto12.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitautogroup.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitautomodes.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitautomultiple.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitautopast.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitbadclients.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitbatchrefresh.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitcalendartransp.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitcancels.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitclienttranspfix.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitcompatibility.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitcopymove.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitdefaultcalendar.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitdeletecalendar.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitdropbox.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/impliciterrors.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitfreebusy.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitgroup.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitimip.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitlarge.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitoptions.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitpartstatchange.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitpartstattimestamp.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitprivateevents.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitproxy.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitpublicproperties.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitrecur1.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitrecur2.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitreschedule.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitscenario1.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitscenario2.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitscenario3.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitscheduleagent.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitschedulechanges.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitscheduletag.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitsecurity.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitsequence.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitsharing.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicittimezones.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicittodo.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicit-traveltime.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/implicitxdash.xml",
            enabled: false,
        },
        // ── Sharing ──────────────────────────────────────────────────────
        TestEntry {
            path: "CalDAV/sharing-cache.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/sharing-calendars.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/sharing-create.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/sharing-direct.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/sharing-dropbox.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/sharing-errors.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/sharing-feature.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/sharing-freebusy.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/sharing-groups-changes.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/sharing-groups.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/sharing-invites.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/sharing-moves.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/sharing-multiple.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/sharing-notification-sync.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/sharing-peruser-data.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/sharing-peruser-properties.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/sharing-proxies.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/sharing-quota.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/sharing-replies.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/sharing-sync.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/sharing-traveltime.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/sharing-unshare-groups.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/sharing-unshare.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/sharing-webcal.xml",
            enabled: false,
        },
        // ── Miscellaneous CalDAV ─────────────────────────────────────────
        TestEntry {
            path: "CalDAV/add-member.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/alarm-dismissal.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/attachments.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/availability.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/brief.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/bulk.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/caldavIOP.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/calendaruserproxy.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/collection-redirects.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/default-alarms.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/directory.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/dropbox.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/ical-client.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/limits.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/managed-attachments.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/managed-attachments-dropbox.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/managed-attachments-implicit.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/managed-attachments-quota.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/managed-attachments-recurrence.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/managed-attachments-sharing.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/partitioning-calendaruserproxy.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/partitioning-scheduleimplicit.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/partitioning-scheduleimplicitauto.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/partitioning-simple.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/polls.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/prefer.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/pretest.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/privatecomments.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/privateevents.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/proxyauthz.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/quota.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/resourceid.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/server-info.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/servertoserverincoming.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/servertoserveroutgoing.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/timezoneservice.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/timezonestdservice.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/trash.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/trash-implicitgroup.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/trash-sync-report.xml",
            enabled: false,
        },
        TestEntry {
            path: "CalDAV/webcal.xml",
            enabled: false,
        },
    ]
}

/// ## Summary
///
/// Returns the full manifest of CardDAV test files.
#[must_use]
pub fn carddav_tests() -> Vec<TestEntry> {
    vec![
        // ── Core CardDAV ─────────────────────────────────────────────────
        TestEntry {
            path: "CardDAV/get.xml",
            enabled: true,
        },
        TestEntry {
            path: "CardDAV/put.xml",
            enabled: true,
        },
        TestEntry {
            path: "CardDAV/mkcol.xml",
            enabled: true,
        },
        TestEntry {
            path: "CardDAV/propfind.xml",
            enabled: true,
        },
        TestEntry {
            path: "CardDAV/proppatch.xml",
            enabled: true,
        },
        TestEntry {
            path: "CardDAV/current-user-principal.xml",
            enabled: true,
        },
        TestEntry {
            path: "CardDAV/well-known.xml",
            enabled: true,
        },
        // ── Reports ──────────────────────────────────────────────────────
        TestEntry {
            path: "CardDAV/reports.xml",
            enabled: true,
        },
        TestEntry {
            path: "CardDAV/sync-report.xml",
            enabled: true,
        },
        // ── Other ────────────────────────────────────────────────────────
        TestEntry {
            path: "CardDAV/aclreports.xml",
            enabled: false,
        },
        TestEntry {
            path: "CardDAV/add-member.xml",
            enabled: false,
        },
        TestEntry {
            path: "CardDAV/bulk.xml",
            enabled: false,
        },
        TestEntry {
            path: "CardDAV/copymove.xml",
            enabled: false,
        },
        TestEntry {
            path: "CardDAV/default-addressbook.xml",
            enabled: false,
        },
        TestEntry {
            path: "CardDAV/directory-gateway.xml",
            enabled: false,
        },
        TestEntry {
            path: "CardDAV/directory.xml",
            enabled: false,
        },
        TestEntry {
            path: "CardDAV/errorcondition.xml",
            enabled: false,
        },
        TestEntry {
            path: "CardDAV/errors.xml",
            enabled: false,
        },
        TestEntry {
            path: "CardDAV/limits.xml",
            enabled: false,
        },
        TestEntry {
            path: "CardDAV/nonascii.xml",
            enabled: false,
        },
        TestEntry {
            path: "CardDAV/ab-client.xml",
            enabled: false,
        },
        TestEntry {
            path: "CardDAV/sharing-access.xml",
            enabled: false,
        },
        TestEntry {
            path: "CardDAV/sharing-addressbooks.xml",
            enabled: false,
        },
        TestEntry {
            path: "CardDAV/sharing-bulk.xml",
            enabled: false,
        },
        TestEntry {
            path: "CardDAV/sharing-feature.xml",
            enabled: false,
        },
        TestEntry {
            path: "CardDAV/sharing-groups.xml",
            enabled: false,
        },
        TestEntry {
            path: "CardDAV/sharing-peruser-properties.xml",
            enabled: false,
        },
        TestEntry {
            path: "CardDAV/sharing-put.xml",
            enabled: false,
        },
        TestEntry {
            path: "CardDAV/sharing-replies.xml",
            enabled: false,
        },
        TestEntry {
            path: "CardDAV/sharing-sync.xml",
            enabled: false,
        },
        TestEntry {
            path: "CardDAV/sharing-unshare.xml",
            enabled: false,
        },
    ]
}

/// ## Summary
///
/// Returns every enabled test entry (CalDAV + CardDAV).
#[must_use]
pub fn enabled_tests() -> Vec<&'static str> {
    let mut all: Vec<&'static str> = Vec::new();
    for e in caldav_tests() {
        if e.enabled {
            all.push(e.path);
        }
    }
    for e in carddav_tests() {
        if e.enabled {
            all.push(e.path);
        }
    }
    all
}

/// ## Summary
///
/// Returns every test entry regardless of whether it is enabled.
#[must_use]
pub fn all_tests() -> Vec<TestEntry> {
    let mut all = caldav_tests();
    all.extend(carddav_tests());
    all
}

/// ## Summary
///
/// Returns the default set of features the Shuriken server exposes.
///
/// Update this list as features are implemented. Tests that
/// `<require-feature>` something not in this set will be skipped.
#[must_use]
pub fn server_features() -> HashSet<String> {
    [
        // Standard protocols
        "caldav",
        "carddav",
        // Core WebDAV
        "props",
        // CalDAV basic
        "calendar-home",
        "calendar-default-alarms",
        "ctag",
        "sync-report",
        "current-user-principal",
        "well-known",
    ]
    .iter()
    .map(|s| (*s).to_string())
    .collect()
}

/// ## Summary
///
/// Resolves the absolute path to the `test-suite` directory.
///
/// Walks up from the current working directory looking for
/// `crates/shuriken-caldavtester/test-suite`. Falls back to a cargo
/// manifest-relative path.
#[must_use]
pub fn test_suite_dir() -> PathBuf {
    // Try CARGO_MANIFEST_DIR first (works in `cargo test`)
    if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        let p = PathBuf::from(manifest).join("test-suite");
        if p.is_dir() {
            return p;
        }
    }

    // Fallback: relative from workspace root
    let cwd = std::env::current_dir().unwrap_or_default();
    let candidate = cwd.join("crates/shuriken-caldavtester/test-suite");
    if candidate.is_dir() {
        return candidate;
    }

    // Last resort
    PathBuf::from("test-suite")
}
