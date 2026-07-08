#!/bin/sh
# Runs caldav-server-tester against the shuriken server and compares the
# normalized result against the checked-in baseline.
#
# Env (from docker-compose.yml): DAV_URL, ADMIN_API_URL, PRIMARY_USERNAME/PASSWORD,
# SECOND_USERNAME/PASSWORD/SLUG/DISPLAYNAME. UPDATE_BASELINE=1 refreshes the
# baseline instead of comparing.
#
# Two accounts are used: the tool talks to the server through a caldav config
# file with a `primary` and a `second` section, passed via repeated
# --config-section flags. This is the ONLY way the tool runs its multi-user
# RFC 6638 scheduling checks (the --caldav-url path skips them). The second
# account is created on demand via the admin UI API.
set -eu

SUITE=caldav-server-tester
OUT=/results/$SUITE
mkdir -p "$OUT"

# Point the caldav library at our generated config file. (Anything matching
# CALDAV_CONFIG* is ignored by its env-var connection override logic.)
export CALDAV_CONFIG_FILE=/tmp/calendar.conf

# Provision the second account (idempotent) and write the two-section config.
# read_config() parses JSON before YAML, so emitting JSON needs no pyyaml dep.
python3 - <<'PY'
import base64, json, os, sys, urllib.error, urllib.parse, urllib.request

api = os.environ["ADMIN_API_URL"].rstrip("/")
dav = os.environ["DAV_URL"]
pu, pp = os.environ["PRIMARY_USERNAME"], os.environ["PRIMARY_PASSWORD"]
su, sp = os.environ["SECOND_USERNAME"], os.environ["SECOND_PASSWORD"]
slug = os.environ.get("SECOND_SLUG", "scheduling2")
dn = os.environ.get("SECOND_DISPLAYNAME", slug)

# Create the second user as the admin. Non-2xx (e.g. already exists) is fine.
body = urllib.parse.urlencode(
    {"slug": slug, "email": su, "displayName": dn, "password": sp}
).encode()
req = urllib.request.Request(f"{api}/ui/api/users/create", data=body, method="POST")
req.add_header(
    "Authorization", "Basic " + base64.b64encode(f"{pu}:{pp}".encode()).decode()
)
try:
    with urllib.request.urlopen(req) as r:
        print(f"[csc] second-user create: HTTP {r.status}", file=sys.stderr)
except urllib.error.HTTPError as e:
    print(f"[csc] second-user create: HTTP {e.code} (already exists?)", file=sys.stderr)
except Exception as e:  # noqa: BLE001 — best-effort; tester still runs single-user
    print(f"[csc] second-user create failed: {e}", file=sys.stderr)

# Section keys use the caldav library's config-file prefix (`caldav_*`), which is
# distinct from its CALDAV_* environment-variable names.
cfg = {
    "primary": {"caldav_url": dav, "caldav_username": pu, "caldav_password": pp},
    "second": {"caldav_url": dav, "caldav_username": su, "caldav_password": sp},
}
with open(os.environ["CALDAV_CONFIG_FILE"], "w") as f:
    json.dump(cfg, f)
PY

echo "[$SUITE] probing $DAV_URL (primary=$PRIMARY_USERNAME, second=$SECOND_USERNAME)"

# Capture machine-readable + human-readable runs. The tool exits non-zero when
# it finds deviations, which is normal here — the baseline diff is the real
# gate, so don't let `set -e` abort on it.
set +e
caldav-server-tester \
	--config-section primary \
	--config-section second \
	--verbose \
	--format json > "$OUT/raw.json" 2> "$OUT/raw.log"
TOOL_RC=$?
set -e
echo "[$SUITE] tool exit code: $TOOL_RC (informational; not the gate)" | tee -a "$OUT/raw.log"

# Normalize: flatten the JSON to sorted `dotted.key: value` leaf lines, drop
# volatile keys (urls/hrefs/timings), and mask UUIDs/timestamps so the snapshot
# is deterministic run-to-run.
python3 - "$OUT/raw.json" > "$OUT/normalized.txt" <<'PY'
import json, re, sys

VOLATILE_KEYS = {
    "url", "href", "caldav_url", "calendar_url", "calendar",
    "timestamp", "time", "duration", "elapsed", "started", "finished",
    "traceback", "exception", "detail", "message",
    # Tool metadata, not server behaviour — exclude so the snapshot is purely
    # about what the server does.
    "caldav_version", "ts", "name",
}
UUID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
TS = re.compile(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?")
NUM = re.compile(r"\b\d+\.\d+\b")

def mask(v):
    s = str(v)
    s = UUID.sub("<UUID>", s)
    s = TS.sub("<TS>", s)
    s = NUM.sub("<NUM>", s)
    return s

def walk(node, prefix, out):
    if isinstance(node, dict):
        for k in sorted(node):
            if k.lower() in VOLATILE_KEYS:
                continue
            walk(node[k], f"{prefix}.{k}" if prefix else k, out)
    elif isinstance(node, list):
        # Sort by the masked string form so list order doesn't churn the snapshot.
        for item in sorted(node, key=lambda x: mask(x)):
            walk(item, f"{prefix}[]", out)
    else:
        out.append(f"{prefix}: {mask(node)}")

try:
    data = json.load(open(sys.argv[1]))
except Exception as e:
    print(f"!! could not parse JSON output: {e}")
    print("!! see raw.log — the tool likely failed before producing JSON.")
    sys.exit(0)

lines = []
walk(data, "", lines)
print("\n".join(sorted(lines)))
PY

echo "[$SUITE] normalized result:"
sed 's/^/    /' "$OUT/normalized.txt"

. /harness-lib/compare.sh
finish_compare "$SUITE" "$OUT/normalized.txt" "/suite/baseline.txt"
