import { type Duration, Effect, Metric } from "effect";

// ---------------------------------------------------------------------------
// Shared boundary definitions
// ---------------------------------------------------------------------------

// Exponential bucket boundaries: ~0.5 ms → ~16 s (16 buckets)
const durBoundaries = Metric.exponentialBoundaries({
	start: 0.5,
	factor: 2,
	count: 16,
});

// ---------------------------------------------------------------------------
// trackDuration — times an effect and records its elapsed Duration into a
// duration metric. Effect v4 removed `Metric.trackDuration`; this helper
// preserves the call-site ergonomics. The duration is recorded on success;
// failures are tracked separately via the *Total counters.
// ---------------------------------------------------------------------------

export const trackDuration =
	(metric: Metric.Metric<Duration.Duration, unknown>) =>
	<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
		Effect.flatMap(Effect.timed(effect), ([duration, value]) =>
			Effect.as(Metric.update(metric, duration), value),
		);

// ---------------------------------------------------------------------------
// HTTP layer
// ---------------------------------------------------------------------------

/**
 * Total HTTP requests by method, path_group ("dav" | "timezones" | "ui" | "unknown"),
 * and status_code.
 */
export const httpRequestsTotal = Metric.counter("shuriken.http.requests", {
	description: "Total HTTP requests received",
});

/**
 * HTTP request end-to-end latency.
 * Tagged with method and path_group (known before the handler runs).
 * Uses timerWithBoundaries so it accepts Effect Duration values from Metric.trackDuration.
 */
export const httpRequestDurationMs = Metric.timer(
	"shuriken.http.request.duration_ms",
	{ boundaries: durBoundaries },
);

// ---------------------------------------------------------------------------
// DAV method dispatch
// ---------------------------------------------------------------------------

/**
 * Total DAV method requests by dav_method ("PROPFIND", "PUT", …) and
 * path_kind (resolved ResolvedDavPath.kind).
 */
export const davRequestsTotal = Metric.counter("shuriken.dav.requests", {
	description: "Total DAV method requests dispatched",
});

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/**
 * Total authentication attempts by mode ("basic" | "proxy" | "single-user")
 * and outcome ("success" | "not_found" | "invalid_password" | "no_credentials"
 *              | "header_absent" | "untrusted_proxy" | "error").
 */
export const authAttemptsTotal = Metric.counter("shuriken.auth.attempts", {
	description: "Total authentication attempts",
});

// ---------------------------------------------------------------------------
// Access Control
// ---------------------------------------------------------------------------

/**
 * Total ACL privilege checks by outcome ("allowed" | "denied").
 */
export const aclChecksTotal = Metric.counter("shuriken.acl.checks", {
	description: "Total ACL privilege checks",
});

// ---------------------------------------------------------------------------
// Repository layer
// ---------------------------------------------------------------------------

/**
 * Total repository queries by entity (e.g. "Principal", "Collection"),
 * operation (e.g. "findById", "insert"), and outcome ("success" | "error").
 */
export const repoQueriesTotal = Metric.counter("shuriken.repo.queries", {
	description: "Total repository queries executed",
});

/**
 * Repository query latency.
 * Tagged with entity and operation before use.
 * Uses timerWithBoundaries so it accepts Effect Duration values from Metric.trackDuration.
 */
export const repoQueryDurationMs = Metric.timer(
	"shuriken.repo.query.duration_ms",
	{ boundaries: durBoundaries },
);
