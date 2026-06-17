# External Test Suites for shuriken-ts

A catalogue of external/third-party conformance and interoperability test suites we
could run against shuriken-ts, with their capabilities, runtime requirements, and how
they map onto our current feature surface.

This is a **reference document**, not an implementation plan. It exists to compare the
options before we decide what to wire up and in what order.

## Why external suites at all

Our in-repo tests (`*.unit.test.ts`, `*.integration.test.ts`, the `script-runner`
harness in [src/testing/](../../src/testing/)) exercise our own understanding of the
protocols. External suites are valuable precisely because they encode *someone else's*
reading of the RFCs and *real client* behaviour — they catch the spec corners and
client quirks we didn't think to test. They run over HTTP against a live server, so
they validate the full edge (routing, XML, auth, response construction), not just the
service layer.

All of them require a running server + Postgres. The natural test config is single-user
mode (`AUTO_LOGIN=...`) or basic auth (`ADMIN_EMAIL`/`ADMIN_PASSWORD`), DB provisioned
via `bun run db:reset && bun run migrations:run`. See [src/index.ts](../../src/index.ts)
and [docker-compose.yaml](../../docker-compose.yaml).

---

## Summary

| Suite | Protocol scope | Runtime | Effort to run | Output | Best for |
|---|---|---|---|---|---|
| **caldav-server-tester** | CalDAV (RFC 4791/6578/5397) | Python ≥3.10 | **Low** (`pip install`) | JSON / YAML / hints | Quick "what works / what's quirky / what's wrong" probe |
| **CalDAVTester / testcaldav** | CalDAV + CardDAV + WebDAV ACL, scheduling | **Python 2 only** (all forks) | **High** (py2-in-Docker or extract XMLs) | log / trace / jsondump | Most comprehensive protocol conformance |
| **python-caldav test suite** | CalDAV + CardDAV via the client lib | Python 3 (pytest/tox) | Medium | pytest report + compat hints | Real-client behaviour, regression of client interop |
| **WebDAV litmus** | WebDAV core (RFC 4918) | C (compile or pkg) | Low–Medium | TAP-ish console | Base WebDAV semantics (props, copy/move, locks, http) |
| **vdirsyncer + parser/validator libs** | iCal/vCard round-trip, sync interop | Python / JS / C | Low–Medium | per-tool | Data-format correctness & sync-client interop |
| **Other servers' test corpora** | varies | n/a (research) | Research | n/a | Borrow test ideas & fixtures |

Applicability rule of thumb against our current coverage: we advertise
`DAV: 1, 3, access-control, extended-mkcol, calendar-access, addressbook,
calendar-auto-schedule, calendar-no-timezone` and implement PROPFIND/PROPPATCH/REPORT/
MKCOL/MKCALENDAR/MKADDRESSBOOK/ACL/COPY/MOVE/GET/PUT/DELETE/POST. We do **not** implement
LOCK/UNLOCK, BIND, version-control, DASL/SEARCH, or expand-property. Anything a suite
checks in those areas is expected to fail and should be baselined, not chased.

---

## 1. caldav-server-tester (PyPI)

- **Source:** <https://pypi.org/project/caldav-server-tester/> · repo
  <https://github.com/python-caldav/caldav-server-tester>
- **Runtime:** Python ≥3.10. License AGPL-3.0-or-later.
- **Install:** `pip install caldav-server-tester` (or `make install`, which auto-detects
  `uv`/`pipx`/`pip`).
- **Invoke:**
  ```
  caldav-server-tester --caldav-url http://localhost:3000/dav \
                       --caldav-username caldav@example.com \
                       --caldav-password testpass123 \
                       --format json
  ```

**What it does.** Probes a CalDAV server and reports, per feature, whether the server
*supports it*, *handles it quirkily*, or *gets it wrong*. It is the companion/diagnostic
tool to the python-caldav client library and emits results that feed that library's
`compatibility_hints.py` feature-flag system.

**Capabilities / checks.**
- Calendar create/delete (`MKCALENDAR`)
- Event, task (VTODO), and journal (VJOURNAL) persistence
- RFC 4791 search: time-range, text, alarm, recurrence filters
- Text-search behaviour: case sensitivity, substring matching, collations
- RFC 6578 `sync-collection`
- Free-busy query
- RFC 5397 principal discovery (`current-user-principal`, home-sets)
- Cross-calendar duplicate-UID handling
- Timezone event support

**Output formats:** `--format json | yaml | hints`; `--diff` compares against a previous
run (good for regression gating).

**Fit for us.** **Highest value-for-effort.** Modern Python 3, no XML config, single
command. Covers our core CalDAV surface directly. Note: it checks **journal (VJOURNAL)**
persistence and **recurrence/alarm search**, areas where we're partial (we filter
VEVENT/VTODO in reports, journal filtering unsupported) — expect some "quirky/wrong"
results there. CardDAV is **not** covered by this tool.

---

## 2. CalDAVTester / ccs-caldavtester (`testcaldav`)

- **Original (archived):** <https://github.com/apple/ccs-caldavtester> — Apple
  CalendarServer's framework by Cyrus Daboo, Andre LaBranche et al. Now archived;
  maintainers invite forks.
- **Forks (all still Python 2):** CalConnect <https://github.com/CalConnect/caldavtester>,
  Bedework <https://github.com/Bedework/caldavtester>, evert
  <https://github.com/evert/caldavtester>. These are mirrors/light-maintenance forks of
  Apple's Python 2 codebase, **not** Python 3 ports.
- **Debian package (removed):** there was a `caldav-tester` package shipping the
  `testcaldav` binary, but it was **removed from Debian unstable** — reason *"RoM; depends
  on Python 2"* (<https://tracker.debian.org/news/1361085/removed-7020190225-4-from-unstable/>).
  The manpage (<https://manpages.debian.org/testing/caldav-tester/testcaldav.1.en.html>)
  still documents the CLI but the package is gone. **Do not rely on it.**
- **Companion tools:** CalConnect/caldavtester-tools — aggregate results by script,
  display recorded results, a WebGUI.
- **Runtime:** **Python 2 only.** There is no known working Python 3 port. This is the
  core obstacle to using it (see "Fit for us" below).

**What it does.** The most comprehensive CalDAV/CardDAV protocol tester. It executes
scripted HTTP requests against a server and verifies responses, optionally measuring
timing for performance runs. Tests are defined as XML descriptors (`caldavtest.dtd`)
plus ancillary HTTP request-body files.

**Structure.**
- `scripts/server/serverinfo.xml` — server host, ports (SSL/non-SSL), auth type, client
  certs, feature flags, and variable substitutions (accounts, hrefs).
- `scripts/tests/**.xml` — `<test-suite>` → `<test>` → `<request>` (method, URI,
  headers, body) → `<verify>` (callbacks: `statusCode`, `dataMatch`, `multistatusItems`,
  etc.).

**Key CLI options (`testcaldav.py` / `testcaldav`).**
- `-s` server info file (default `serverinfo.xml`)
- `-x` test-script dir (default `scripts/tests`)
- `--basedir` override paths
- `--ssl` use HTTPS
- `--all` run everything; `--random` randomize; `--stop` halt on first failure
- `--print-details-onfail` dump HTTP on failure
- `--observer` output: `log` / `trace` / `loadfiles` / `jsondump`

**Capabilities / coverage.** Broadest of all: WebDAV core, ACL (RFC 3744), CalDAV
calendar-query/multiget/free-busy, CardDAV addressbook-query/multiget, sync, and
**scheduling (RFC 6638 auto-schedule, iMIP)** — the area our recent LMTP/iMIP work
targets. Many individual suites; can be run selectively.

**Fit for us.** **Highest coverage, highest setup cost — and Python 2 is the blocker.**
There is no packaged or Python 3 path; the Debian package is gone. Two real options:
1. **Run the Python 2 framework in a container.** Build a `python:2.7`-based image from a
   CalConnect/Apple fork checkout, author our own `serverinfo.xml`, and run a selected
   subset of `scripts/tests` against the server (also containerized). Pins us to an EOL
   Python 2 image, but it's the only way to use the framework's own runner + verifiers.
2. **Extract just the descriptor XMLs and run them in our own runner** (the original idea
   from your first message). The `<test-suite>`/`<test>`/`<request>`/`<verify>` format is
   simple and declarative; we'd implement the `<verify>` callbacks we care about
   (`statusCode`, `dataMatch`, `multistatusItems`, …) in TypeScript and reuse our existing
   [script-runner](../../src/testing/) harness. More upfront work, but no Python 2, full
   control, and the result lives natively in our `bun test` world. **Likely the better
   long-term bet given our no-Python, Bun-native stance** — option 1 is the faster way to
   get a one-off conformance read.

Either way: scheduling suites are the most interesting given the new iMIP/LMTP code, but
also the most likely to need careful `serverinfo.xml` feature gating. Skip
locking/versioning suites (unimplemented).

---

## 3. python-caldav test suite

- **Source:** <https://github.com/python-caldav/caldav> · docs
  <https://caldav.readthedocs.io/>
- **Runtime:** Python 3, pytest/tox. `pytest-httpserver` and `trustme` for the unit
  layer; the *server-compatibility* tests point the real client at a live server.
- **Relationship to #1:** caldav-server-tester is the standalone descendant of this
  library's server-probing logic; the library carries `compatibility_hints.py` flags that
  both consume.

**What it does.** Drives a real, widely-used Python CalDAV/CardDAV **client** against the
server: discovery, calendar/addressbook CRUD, event/todo/journal operations, search,
sync, free-busy. Because it's an actual client library used by many apps, passing it is
strong evidence of real-world interoperability. Configure target server/credentials in
the test config (historically `tests/conf*.py` / env) and run the server-compat subset.

**Fit for us.** Medium effort, high interop signal. Overlaps #1 but exercises the client
code paths and CardDAV too. Good "does a real client library work end-to-end against us"
gate. Confirm the exact current config mechanism against the repo before wiring up.

---

## 4. WebDAV litmus

- **Source:** <http://www.webdav.org/neon/litmus/> · maintained fork
  <https://github.com/notroj/litmus> · Docker
  <https://github.com/nungster/docker-litmus> · sabre/dav's writeup
  <https://sabre.io/dav/litmus/>.
- **Runtime:** C (built on neon). Install via distro package or compile; Docker image
  available.
- **Invoke:**
  ```
  litmus http://localhost:3000/dav/principals/users/<id>/ [user pass]
  # or, from a built tree:
  make URL=http://localhost:3000/dav/.../ CREDS="user pass" check
  ```
  litmus must be able to create a collection named `litmus` at the target URL.

**Capabilities (default suites: `basic copymove props locks http`).**
- `basic` — OPTIONS/`DAV:` header, PUT, GET byte-compare, MKCOL, DELETE (coll/non-coll)
- `copymove` — COPY/MOVE across overwrite t/f × dest exists/not × coll/non-coll
- `props` — set/delete/replace dead props, persistence across COPY, namespace handling
- `locks` — lock/unlock, shared/exclusive, lockdiscovery, modify-as-(non)owner
- `http` — assorted HTTP semantics

**Fit for us.** Validates **base WebDAV** semantics our DAV layer sits on. Caveat: litmus
treats the server as a plain WebDAV fileserver, so the `props`/`copymove` notions of
arbitrary resources don't perfectly match a calendar/addressbook hierarchy — point it at
a generic collection. The **`locks` suite will fail wholesale** (we don't implement
LOCK/UNLOCK; `lockdiscovery`/`supportedlock` are empty stubs). Run `basic copymove props
http` and baseline `locks` as expected-fail. Low effort, good base-layer regression net.

---

## 5. iCal / vCard parsers, validators & sync clients

The goal here is **data-format correctness and client interop**, not protocol — feed our
GET/PUT output to independent parsers/validators and have real sync clients round-trip
data through us.

**Sync client (interop, end-to-end):**
- **vdirsyncer** <https://github.com/pimutils/vdirsyncer> — CLI that syncs a CalDAV/
  CardDAV server against local `.ics`/`.vcf`. Used heavily against Radicale, Nextcloud,
  Fastmail, iCloud. Pointing it at us exercises discovery (incl. `.well-known`),
  ETags/sync, and round-trip fidelity. Note its known strictness, e.g. it rejects calendar
  objects carrying a `METHOD` property (RFC 4791 §4.1) — useful to confirm we don't leak
  scheduling `METHOD` into stored objects (issue #502 in their tracker).

**iCalendar (RFC 5545) validators/parsers:**
- **libical** (C, reference impl) — `icalvalidator`-style parsing.
- **icalendar** (Python) and **ical.js** (Mozilla/JS, used by Thunderbird) — parse our
  emitted calendar-data and assert no errors.
- CalConnect / icalendar.org online validators for spot checks.

**vCard (RFC 6350) validators/parsers:**
- **vobject** (Python) and **ical.js**/**vCard** JS libs — parse our `address-data`.
- CalConnect maintains a CardDAV libraries index:
  <https://devguide.calconnect.org/CardDAV/libraries/>.

**Fit for us.** Low-ceremony, high-signal for the codecs in
[src/data/icalendar/](../../src/data/icalendar/) and [src/data/vcard/](../../src/data/vcard/).
Approach: export known fixtures (we already have real-world `.ics`/`.vcf` under
[src/testing/__fixtures__/dav-gists/](../../src/testing/__fixtures__/dav-gists/)),
round-trip through PUT→GET, and validate the output with ≥1 independent parser per format.
vdirsyncer adds the realistic sync-client dimension.

---

## 6. What other OSS CalDAV/CardDAV servers test (research)

Borrow their fixtures, suite selections, and known-quirk lists rather than reinventing.

- **sabre/dav** (PHP; basis of Baïkal, Nextcloud, ownCloud) — documents running **litmus**
  and maintains its own large PHPUnit suite. Good source of WebDAV/CalDAV edge fixtures.
  <https://sabre.io/dav/litmus/>
- **Xandikos** (Python, Git-backed) — historically light on coverage; *active effort to
  get caldavtester running against it* — worth watching for their `serverinfo.xml` and
  the subset of caldavtester scripts they enable.
  <https://github.com/jelmer/xandikos>
- **Radicale** (Python) — pytest-based suite; community runs vdirsyncer and real clients
  (Thunderbird, DAVx5, iOS) against it. <https://github.com/Kozea/Radicale>
- **Bedework** — maintains its own caldavtester fork and tooling.
  <https://github.com/Bedework/caldavtester>
- **CalConnect caldavtester-tools** — result aggregation/visualization we could reuse if
  we adopt caldavtester. <https://github.com/CalConnect/caldavtester-tools>

**Takeaways to mine:** which caldavtester script subsets each server treats as
in-scope; their `serverinfo.xml` feature flags; their expected-failure/known-quirk lists;
and the real client matrix (Thunderbird, Evolution, DAVx5, Apple Calendar/Contacts, iOS)
they validate against manually.

---

## Recommended sequencing (for a future implementation plan)

1. **caldav-server-tester** — fastest to stand up; immediate CalDAV signal. (#1)
2. **litmus** `basic copymove props http` — base WebDAV regression net; baseline `locks`. (#4)
3. **Independent parser round-trip + vdirsyncer** — codec/interop confidence. (#5)
4. **CalDAVTester** — the comprehensive pass, incl. scheduling/iMIP suites; biggest payoff
   but most setup, and gated on the Python 2 problem (py2-in-Docker for a one-off read, or
   extract-the-XMLs-into-our-own-runner for a Bun-native long-term home). (#2)
5. **python-caldav suite** — real-client interop gate; overlaps #1 but adds CardDAV. (#3)

For all of them: capture results as a baseline and gate on *regressions*, treating
known-unimplemented areas (locks, versioning, DASL, expand-property) as expected-fail
rather than chasing them.

## Sources

- caldav-server-tester — <https://pypi.org/project/caldav-server-tester/>, <https://github.com/python-caldav/caldav-server-tester>
- testcaldav (Debian) — <https://manpages.debian.org/testing/caldav-tester/testcaldav.1.en.html>
- ccs-caldavtester — <https://github.com/apple/ccs-caldavtester>, <https://www.calendarserver.org/CalDAVTester.html>
- caldavtester forks — <https://github.com/CalConnect/caldavtester>, <https://github.com/Bedework/caldavtester>, <https://github.com/evert/caldavtester>, <https://github.com/CalConnect/caldavtester-tools>
- python-caldav — <https://github.com/python-caldav/caldav>, <https://caldav.readthedocs.io/>
- litmus — <http://www.webdav.org/neon/litmus/>, <https://github.com/notroj/litmus>, <https://github.com/nungster/docker-litmus>, <https://sabre.io/dav/litmus/>
- vdirsyncer — <https://github.com/pimutils/vdirsyncer>, issue #502 (METHOD property)
- CalConnect CardDAV libraries — <https://devguide.calconnect.org/CardDAV/libraries/>
- Xandikos — <https://github.com/jelmer/xandikos>; Radicale — <https://github.com/Kozea/Radicale>
