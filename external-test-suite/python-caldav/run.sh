#!/bin/sh
# Runs the python-caldav functional test suite against the shuriken server and
# compares normalized per-test outcomes against the checked-in baseline.
#
# Env (from docker-compose.yml): DAV_URL, CALDAV_USERNAME, CALDAV_PASSWORD.
# PYTEST_TARGETS overrides which test files run (default: the functional suite).
# UPDATE_BASELINE=1 refreshes the baseline.
set -eu

SUITE=python-caldav
OUT=/results/$SUITE
mkdir -p "$OUT"

# Install our minimal "only shuriken" server config where the loader looks.
cp /suite/caldav_test_servers.yaml /caldav/tests/caldav_test_servers.yaml

TARGETS="${PYTEST_TARGETS:-tests/test_caldav.py}"
echo "[$SUITE] running pytest [$TARGETS] against $DAV_URL as $CALDAV_USERNAME"

# pytest exits non-zero on failures (expected here); the baseline diff is the
# gate. JUnit XML gives a stable, parseable per-test outcome record.
#
# `-W default::DeprecationWarning` overrides python-caldav's own
# `filterwarnings = error` for DeprecationWarnings only. Several of its tests
# (e.g. testPrincipals, testTodoDatesearch) call the library's *own* deprecated
# methods (`principals()`, `date_search()`), which warn and would otherwise be
# escalated to failures. Those are client-API-hygiene issues, not shuriken
# conformance problems — we still want the test bodies to run against the
# server. The warnings remain visible (default action), just not fatal.
set +e
( cd /caldav && pytest $TARGETS \
	-p no:cacheprovider \
	-W default::DeprecationWarning \
	--junit-xml="$OUT/report.xml" \
	-q > "$OUT/raw.log" 2>&1 )
TOOL_RC=$?
set -e
echo "[$SUITE] pytest exit code: $TOOL_RC (informational; not the gate)"
tail -n 15 "$OUT/raw.log" | sed 's/^/    /'

# Normalize: junit XML -> sorted `classname::name: OUTCOME` lines, masking
# volatile tokens. Outcome derives from the child element (failure/error/
# skipped) or "passed" when none is present.
python3 - "$OUT/report.xml" > "$OUT/normalized.txt" <<'PY'
import re, sys, xml.etree.ElementTree as ET

UUID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")

def outcome(tc):
    for tag in ("failure", "error", "skipped"):
        if tc.find(tag) is not None:
            return tag.upper()
    return "PASSED"

try:
    root = ET.parse(sys.argv[1]).getroot()
except Exception as e:
    print(f"!! could not parse junit xml: {e}")
    print("!! see raw.log — pytest likely failed during collection.")
    sys.exit(0)

lines = []
for tc in root.iter("testcase"):
    cls = tc.get("classname", "")
    # Defensive: keep only the shuriken-parameterized cases, never any embedded
    # comparison server (radicale/xandikos) that might slip into the run.
    if "shuriken" not in cls.lower():
        continue
    name = UUID.sub("<UUID>", tc.get("name", ""))
    lines.append(f"{cls}::{name}: {outcome(tc)}")

print("\n".join(sorted(lines)))
PY

echo "[$SUITE] normalized result (first 40 lines):"
head -n 40 "$OUT/normalized.txt" | sed 's/^/    /'

. /harness-lib/compare.sh
finish_compare "$SUITE" "$OUT/normalized.txt" "/suite/baseline.txt"
