#!/bin/sh
# Shared baseline comparison logic, sourced by each suite's run.sh inside its
# container. Mounted at /lib (see docker-compose.yml volumes).
#
# Model: snapshot. The checked-in baseline records the *current accepted*
# output of a suite, including failures for features we don't implement
# (locks, versioning, ...). A run "passes" when its normalized output exactly
# matches the baseline. Any difference — a new pass, a new failure, a renamed
# test — is a regression that must be reviewed and explicitly accepted by
# refreshing the baseline.
#
# Each suite's run.sh is responsible for producing a *normalized* result file
# (deterministic: no timestamps, durations, ports, generated UUIDs/etags) and
# then calling finish_compare.

# finish_compare <suite-name> <normalized-file> <baseline-file>
#
# Honors UPDATE_BASELINE=1 to (re)write the baseline from the current run.
# Exit codes: 0 = match / baseline updated, 1 = regression (diff), 2 = no baseline.
finish_compare() {
	suite="$1"
	normalized="$2"
	baseline="$3"

	if [ "${UPDATE_BASELINE:-0}" = "1" ]; then
		cp "$normalized" "$baseline"
		echo "[$suite] baseline updated -> $baseline"
		return 0
	fi

	if [ ! -f "$baseline" ]; then
		echo "[$suite] NO BASELINE at $baseline"
		echo "[$suite] review the normalized output above, then re-run with --update-baseline to accept it."
		return 2
	fi

	if diff -u "$baseline" "$normalized" > /tmp/baseline.diff 2>&1; then
		echo "[$suite] OK — output matches baseline."
		return 0
	fi

	echo "[$suite] REGRESSION — output differs from baseline:"
	echo "    (- baseline / + current run)"
	sed 's/^/    /' /tmp/baseline.diff
	echo "[$suite] if this change is intended, re-run with --update-baseline to accept it."
	return 1
}
