# External Test Suites

Self-contained conformance harness that runs third-party CalDAV/WebDAV test
tools against shuriken. Everything runs in Docker — no host installs beyond
Docker + Compose. Companion catalogue of all candidate suites (including the
ones not yet wired up, e.g. CalDAVTester):
[../documentation/planning/external-test-suites.md](../documentation/planning/external-test-suites.md).

Currently wired up:

| Suite | What it checks | Source |
|---|---|---|
| `caldav-server-tester` | Modern CalDAV probe: calendars, events/todos/journals, RFC 4791 search, sync, free-busy, principal discovery | [python-caldav/caldav-server-tester](https://github.com/python-caldav/caldav-server-tester) |
| `litmus` | Base WebDAV (RFC 4918): OPTIONS/PUT/GET/MKCOL/DELETE, COPY/MOVE, dead props | [webdav.org/neon/litmus](http://www.webdav.org/neon/litmus/) |
| `python-caldav` | Real-client interop: the python-caldav library's functional suite | [python-caldav/caldav](https://github.com/python-caldav/caldav) |

## How it works

`docker-compose.yml` brings up Postgres + the shuriken server (built from the
repo's `docker/Dockerfile`) in **basic-auth** mode with a seeded admin:

```
email    test@example.com      calendar     /dav/principals/test/cal/primary/
password testpassword123        address book /dav/principals/test/card/primary/
slug     test
```

Each suite is a small container, started on demand via
`docker compose run --rm <suite>`, that runs its tool against the server over
the compose network (`http://server:3000/dav/`), normalizes the output into a
deterministic snapshot, and diffs it against a checked-in **baseline**.

### Baseline + expected-failures model

The baseline (`<suite>/baseline.txt`) records the *current accepted* output,
**including** failures for things shuriken doesn't implement (locks,
versioning, nested generic collections, …). A run passes when its normalized
output matches the baseline exactly. Any difference — a new pass, a new
failure, a renamed test — is flagged as a regression for you to review and
either fix or explicitly accept by refreshing the baseline. There is no
separate "known failures" list to maintain: the baseline *is* the expected
state.

Output normalization strips non-deterministic noise (timestamps, durations,
UUIDs, etags) so re-runs are stable.

## Usage

```bash
cd external-test-suite

# Run one suite (gates against its baseline):
./run.sh caldav-server-tester
./run.sh litmus
./run.sh python-caldav

# Run all three:
./run.sh all

# First time / after an intended behaviour change — capture the baseline:
./run.sh all --update-baseline

# Start from a clean database (drops the Postgres volume first):
./run.sh all --fresh

# Leave the server up afterwards for poking with curl/clients
# (host-mapped at http://localhost:3737/dav/ ):
./run.sh caldav-server-tester --keep-up
```

`run.sh` exits non-zero if any selected suite regressed, so it can gate a
commit or be dropped into CI later.

### First run

No baselines are committed yet — they describe real server behaviour and must
be captured from an actual run. The first `./run.sh <suite>` prints the
normalized output and exits with status 2 ("NO BASELINE"). Review it, then
accept it with `--update-baseline`. From then on the suite gates against it.

## Layout

```
external-test-suite/
  docker-compose.yml        postgres + server + suite containers
  run.sh                    orchestrator (build, wait-healthy, run, diff)
  lib/compare.sh            shared baseline snapshot/diff logic
  caldav-server-tester/     Dockerfile, run.sh, baseline.txt
  litmus/                   Dockerfile, run.sh, baseline.txt
  python-caldav/            Dockerfile, run.sh, caldav_test_servers.yaml, baseline.txt
  results/                  per-run raw + normalized output (gitignored)
```

## Notes & known limits

- **litmus** targets the `col` (generic collection) namespace. shuriken's URL
  space is only one collection level deep and has no WebDAV locking, so litmus's
  nested-collection and lock tests fail by design — captured in the baseline.
  The `locks` suite is excluded from the run entirely (set `LITMUS_TESTS` to
  re-include it).
- **caldav-server-tester** and **python-caldav** create and delete their own
  calendars/events. They generally clean up after themselves; if a run leaves
  cruft and the next run behaves oddly, re-run with `--fresh`.
- The server is pinned to **basic auth**; tools authenticate as the seeded
  admin above. To probe single-user mode instead, swap the server env in
  `docker-compose.yml` (`AUTO_LOGIN=test@example.com`, drop `BASIC_AUTH_*`).
- CalDAVTester is intentionally **not** here: it is Python 2 only (see the
  planning doc). Add it later as a py2-in-Docker suite or by porting its XML
  descriptors into our own runner.
