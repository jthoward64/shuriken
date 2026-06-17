#!/bin/sh
# Runs caldav-server-tester against the shuriken server and compares the
# normalized result against the checked-in baseline.
#
# Env (from docker-compose.yml): DAV_URL, CALDAV_USERNAME, CALDAV_PASSWORD.
# UPDATE_BASELINE=1 refreshes the baseline instead of comparing.
set -eu

SUITE=caldav-server-tester
OUT=/results/$SUITE
mkdir -p "$OUT"

echo "[$SUITE] probing $DAV_URL as $CALDAV_USERNAME"

# Capture machine-readable + human-readable runs. The tool exits non-zero when
# it finds deviations, which is normal here — the baseline diff is the real
# gate, so don't let `set -e` abort on it.
set +e
caldav-server-tester \
	--caldav-url "$DAV_URL" \
	--caldav-username "$CALDAV_USERNAME" \
	--caldav-password "$CALDAV_PASSWORD" \
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
