#!/bin/sh
# Runs WebDAV litmus against the shuriken server and compares the normalized
# per-test results against the checked-in baseline.
#
# Env (from docker-compose.yml): LITMUS_URL, LITMUS_USER, LITMUS_PASSWORD.
# LITMUS_TESTS selects which litmus suites run (default excludes `locks`,
# which shuriken does not implement). UPDATE_BASELINE=1 refreshes the baseline.
set -eu

SUITE=litmus
OUT=/results/$SUITE
mkdir -p "$OUT"

# Default suites: skip `locks` (no LOCK/UNLOCK support in shuriken).
export TESTS="${LITMUS_TESTS:-basic copymove props http}"

echo "[$SUITE] running suites [$TESTS] against $LITMUS_URL as $LITMUS_USER"

# litmus exits non-zero when tests fail (expected here); the baseline diff is
# the gate, so don't let `set -e` abort.
set +e
litmus "$LITMUS_URL" "$LITMUS_USER" "$LITMUS_PASSWORD" > "$OUT/raw.txt" 2>&1
TOOL_RC=$?
set -e
echo "[$SUITE] tool exit code: $TOOL_RC (informational; not the gate)"

# Normalize: emit `suite/testname: RESULT` per test, dropping litmus's
# sequential numbering, dotted leaders, summary/percentage lines, and masking
# volatile detail (UUIDs, timestamps, numbers) in any failure reason. Sort so
# ordering never churns the snapshot.
#
# litmus overwrites its progress line with carriage returns; with a non-TTY
# stdout those CRs land literally in the file, so first collapse each line to
# the text after its last CR (what a terminal would finally render).
sed -E 's/.*\r//' "$OUT/raw.txt" \
  | awk '
  /^-> running/ {
    s = $0
    sub(/.*`/, "", s)   # drop up to the opening backtick
    sub(/.*/, "", t)
    sub(/'\''.*/, "", s) # drop the closing quote onward
    suite = s
    next
  }
  /^[ \t]*[0-9]+\./ {
    line = $0
    sub(/^[ \t]*[0-9]+\.[ \t]*/, "", line)   # strip leading "  N. "
    name = line; sub(/\.\.+.*/, "", name)     # name is up to the dotted leader
    res = line;  sub(/^[^.]*\.\.+[ \t]*/, "", res)  # result follows the dots
    print suite "/" name ": " res
  }
' \
  | sed -E \
      -e 's/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/<UUID>/g' \
      -e 's/[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}/<TS>/g' \
      -e 's/\b[0-9]+\b/<NUM>/g' \
  | sort > "$OUT/normalized.txt"

echo "[$SUITE] normalized result:"
sed 's/^/    /' "$OUT/normalized.txt"

. /harness-lib/compare.sh
finish_compare "$SUITE" "$OUT/normalized.txt" "/suite/baseline.txt"
