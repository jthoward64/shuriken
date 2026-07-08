#!/usr/bin/env bash
# Orchestrator for the external conformance suites.
#
#   ./run.sh <suite|all> [--update-baseline] [--fresh] [--keep-up]
#
#   suite            one of: caldav-server-tester | litmus | python-caldav | all
#   --update-baseline  accept the current run as the new baseline (no gating)
#   --fresh            recreate the server stack with a clean database first
#   --keep-up          leave the server stack running after the run
#
# Exit status is non-zero if any selected suite regressed against its baseline.
set -euo pipefail

cd "$(dirname "$0")"

SUITES_ALL=(caldav-server-tester litmus python-caldav)

usage() { sed -n '2,12p' "$0"; exit "${1:-0}"; }

target="${1:-}"; [ -n "$target" ] || usage 1; shift || true

UPDATE_BASELINE=0
FRESH=0
KEEP_UP=0
for arg in "$@"; do
	case "$arg" in
		--update-baseline) UPDATE_BASELINE=1 ;;
		--fresh) FRESH=1 ;;
		--keep-up) KEEP_UP=1 ;;
		-h|--help) usage 0 ;;
		*) echo "unknown option: $arg" >&2; usage 1 ;;
	esac
done

case "$target" in
	all) suites=("${SUITES_ALL[@]}") ;;
	caldav-server-tester|litmus|python-caldav) suites=("$target") ;;
	*) echo "unknown suite: $target" >&2; usage 1 ;;
esac

compose() { docker compose "$@"; }

if [ "$FRESH" = "1" ]; then
	echo ">> tearing down stack + DATABASE VOLUME for a clean run"
	compose down -v --remove-orphans || true
else
	# Clear any stopped containers left by a previous run so podman-compose
	# doesn't fail with "container name already in use". Keeps the data volume.
	compose down --remove-orphans || true
fi

# Probe an HTTP endpoint from the host; echoes the status code (000 = down).
# Works identically under docker compose and podman-compose since it doesn't
# touch compose's (flavor-specific) health/ps reporting.
http_code() {
	if command -v curl >/dev/null 2>&1; then
		# curl prints "000" itself on connection failure; capture so a failed
		# exit code doesn't append a second value.
		out="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$1" 2>/dev/null)"
		echo "${out:-000}"
	else
		# wget fallback: any response (incl. 401) means the server is up.
		wget -q -T 3 -O /dev/null "$1" >/dev/null 2>&1 && echo 200 || echo 000
	fi
}

echo ">> starting database"
compose up -d database

echo -n ">> waiting for postgres"
for _ in $(seq 1 60); do
	if compose exec -T database pg_isready -U shuriken -d shuriken >/dev/null 2>&1; then
		echo " — ready"; break
	fi
	echo -n "."; sleep 1
done

echo ">> building + starting shuriken server"
compose up -d --build server

# Wait for the server to answer HTTP on its mapped host port. 401 is expected
# (basic auth) and counts as "up" — we only need the HTTP server listening.
echo -n ">> waiting for server on http://localhost:3737/dav/"
ready=0
for _ in $(seq 1 90); do
	code="$(http_code http://localhost:3737/dav/)"
	if [ "$code" != "000" ]; then echo " — up (HTTP $code)"; ready=1; break; fi
	echo -n "."; sleep 2
done
if [ "$ready" != "1" ]; then
	echo
	echo "!! server never answered HTTP; recent logs:" >&2
	compose logs --tail 40 server >&2 || true
	exit 1
fi

rc=0
for suite in "${suites[@]}"; do
	echo
	echo "================================================================"
	echo ">> suite: $suite"
	echo "================================================================"
	if compose run --rm --no-deps \
			-e UPDATE_BASELINE="$UPDATE_BASELINE" "$suite"; then
		echo ">> $suite: PASS"
	else
		src=$?
		echo ">> $suite: FAIL (exit $src)"
		rc=1
	fi
done

if [ "$KEEP_UP" = "1" ]; then
	echo ">> leaving server stack up (--keep-up); stop with: docker compose down"
else
	echo ">> stopping server stack"
	compose stop server database >/dev/null 2>&1 || true
fi

echo
if [ "$UPDATE_BASELINE" = "1" ]; then
	echo ">> baselines updated."
elif [ "$rc" = "0" ]; then
	echo ">> ALL SELECTED SUITES MATCH BASELINE."
else
	echo ">> ONE OR MORE SUITES REGRESSED (see diffs above)."
fi
exit "$rc"
