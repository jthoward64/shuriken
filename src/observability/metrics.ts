import { Metric, MetricBoundaries } from "effect";

// ---------------------------------------------------------------------------
// Shared boundary definitions
// ---------------------------------------------------------------------------

// Exponential bucket boundaries: ~0.5 ms → ~16 s (16 buckets)
const durBoundaries = MetricBoundaries.exponential({
	start: 0.5,
	factor: 2,
	count: 16,
});

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
export const httpRequestDurationMs = Metric.timerWithBoundaries(
	"shuriken.http.request.duration_ms",
	durBoundaries.values,
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
export const repoQueryDurationMs = Metric.timerWithBoundaries(
	"shuriken.repo.query.duration_ms",
	durBoundaries.values,
);
