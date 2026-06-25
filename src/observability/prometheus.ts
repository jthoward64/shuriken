import { Effect, Metric } from "effect";

// ---------------------------------------------------------------------------
// Prometheus exposition encoder.
//
// Renders the in-process Effect metric registry (`Metric.snapshot`) into the
// Prometheus text exposition format (version 0.0.4) so a Prometheus scraper can
// pull it from the `/metrics` endpoint. This is the *only* place that knows the
// Prometheus wire format; the rest of the app records metrics via the typed
// `Metric` API in `#src/observability/metrics.ts`.
//
// Mapping rules:
//   - Metric ids use dots (`shuriken.http.requests`); Prometheus names allow
//     only [a-zA-Z0-9_:], so dots become underscores.
//   - Counters get the conventional `_total` suffix.
//   - Effect timers/histograms expose cumulative `[boundary, count]` buckets,
//     which map directly onto Prometheus `_bucket{le=...}` + `_sum` + `_count`.
//   - `Metric.withAttributes` yields one snapshot per attribute combination,
//     all sharing the same id; HELP/TYPE is emitted once per id, then every
//     attribute set is rendered as a distinct series.
// ---------------------------------------------------------------------------

// `Snapshot` lives in the nested `Metric` namespace within the module of the
// same name, so the fully-qualified path is `Metric.Metric.Snapshot`.
type Snapshot = Metric.Metric.Snapshot;

const PROMETHEUS_VERSION = "0.0.4";

/** Prometheus content type for the text exposition format. */
export const PROMETHEUS_CONTENT_TYPE = `text/plain; version=${PROMETHEUS_VERSION}; charset=utf-8`;

/** Coerce an Effect metric id into a valid Prometheus metric name. */
const sanitizeMetricName = (name: string): string =>
	name.replace(/[^a-zA-Z0-9_:]/g, "_");

/** Coerce an attribute key into a valid Prometheus label name. */
const sanitizeLabelName = (name: string): string =>
	name.replace(/[^a-zA-Z0-9_]/g, "_");

/** Escape a label value per the exposition format (backslash, newline, quote). */
const escapeLabelValue = (value: string): string =>
	value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');

/** Render a numeric sample value; `+Inf`/`-Inf`/`NaN` use Prometheus spellings. */
const formatNumber = (value: number | bigint): string => {
	if (typeof value === "bigint") {
		return value.toString();
	}
	if (Number.isNaN(value)) {
		return "NaN";
	}
	if (value === Number.POSITIVE_INFINITY) {
		return "+Inf";
	}
	if (value === Number.NEGATIVE_INFINITY) {
		return "-Inf";
	}
	return value.toString();
};

/**
 * Render a label block (`{k="v",…}`) from a metric's attribute set plus any
 * extra synthetic labels (e.g. histogram `le`). Returns "" when there are none.
 */
const renderLabels = (
	attributes: Readonly<Record<string, string>> | undefined,
	extra: ReadonlyArray<readonly [string, string]> = [],
): string => {
	const pairs: Array<string> = [];
	if (attributes !== undefined) {
		for (const [key, value] of Object.entries(attributes)) {
			pairs.push(`${sanitizeLabelName(key)}="${escapeLabelValue(value)}"`);
		}
	}
	for (const [key, value] of extra) {
		pairs.push(`${key}="${escapeLabelValue(value)}"`);
	}
	return pairs.length === 0 ? "" : `{${pairs.join(",")}}`;
};

/** The Prometheus metric type keyword for an Effect snapshot type. */
const prometheusType = (type: Snapshot["type"]): string => {
	switch (type) {
		case "Counter":
			return "counter";
		case "Gauge":
			return "gauge";
		case "Histogram":
			return "histogram";
		case "Summary":
			return "summary";
		case "Frequency":
			// Frequencies are exposed as a set of labelled counts.
			return "gauge";
	}
};

/**
 * The exposed Prometheus family name for a snapshot. Counters gain the
 * conventional `_total` suffix (unless already present).
 */
const familyName = (snapshot: Snapshot): string => {
	const base = sanitizeMetricName(snapshot.id);
	if (snapshot.type === "Counter" && !base.endsWith("_total")) {
		return `${base}_total`;
	}
	return base;
};

/** Render every sample line for a single snapshot (one attribute set). */
const renderSamples = (name: string, snapshot: Snapshot): Array<string> => {
	const labels = renderLabels(snapshot.attributes);
	switch (snapshot.type) {
		case "Counter":
		case "Gauge": {
			const value =
				snapshot.type === "Counter"
					? snapshot.state.count
					: snapshot.state.value;
			return [`${name}${labels} ${formatNumber(value)}`];
		}
		case "Histogram": {
			const { buckets, count, sum } = snapshot.state;
			const lines: Array<string> = [];
			for (const [boundary, cumulative] of buckets) {
				const le = renderLabels(snapshot.attributes, [
					["le", formatNumber(boundary)],
				]);
				lines.push(`${name}_bucket${le} ${formatNumber(cumulative)}`);
			}
			const inf = renderLabels(snapshot.attributes, [["le", "+Inf"]]);
			lines.push(`${name}_bucket${inf} ${formatNumber(count)}`);
			lines.push(`${name}_sum${labels} ${formatNumber(sum)}`);
			lines.push(`${name}_count${labels} ${formatNumber(count)}`);
			return lines;
		}
		case "Summary": {
			const { quantiles, count, sum } = snapshot.state;
			const lines: Array<string> = [];
			for (const [quantile, value] of quantiles) {
				if (value !== undefined) {
					const q = renderLabels(snapshot.attributes, [
						["quantile", formatNumber(quantile)],
					]);
					lines.push(`${name}${q} ${formatNumber(value)}`);
				}
			}
			lines.push(`${name}_sum${labels} ${formatNumber(sum)}`);
			lines.push(`${name}_count${labels} ${formatNumber(count)}`);
			return lines;
		}
		case "Frequency": {
			const lines: Array<string> = [];
			for (const [key, value] of snapshot.state.occurrences) {
				const labelled = renderLabels(snapshot.attributes, [["key", key]]);
				lines.push(`${name}${labelled} ${formatNumber(value)}`);
			}
			return lines;
		}
	}
};

interface Family {
	readonly type: string;
	readonly help: string;
	readonly samples: Array<string>;
}

/**
 * Encode a metric snapshot array into a Prometheus exposition document.
 * Pure and deterministic given its input — the unit under test.
 */
export const encodePrometheus = (
	snapshots: ReadonlyArray<Snapshot>,
): string => {
	// Group by family name so HELP/TYPE is emitted exactly once per family,
	// preserving first-seen order for stable output.
	const families = new Map<string, Family>();
	for (const snapshot of snapshots) {
		const name = familyName(snapshot);
		let family = families.get(name);
		if (family === undefined) {
			family = {
				type: prometheusType(snapshot.type),
				help: snapshot.description ?? name,
				samples: [],
			};
			families.set(name, family);
		}
		family.samples.push(...renderSamples(name, snapshot));
	}

	const blocks: Array<string> = [];
	for (const [name, family] of families) {
		const lines = [
			`# HELP ${name} ${family.help.replace(/\\/g, "\\\\").replace(/\n/g, "\\n")}`,
			`# TYPE ${name} ${family.type}`,
			...family.samples,
		];
		blocks.push(lines.join("\n"));
	}
	// Trailing newline — scrapers expect the document to end with one.
	return blocks.length === 0 ? "" : `${blocks.join("\n")}\n`;
};

/**
 * Snapshot the current Effect metric registry and render it as Prometheus text.
 * Runs in whatever runtime context provides the metric state, so it must be
 * executed under the same runtime that records the application's metrics.
 */
export const renderPrometheus: Effect.Effect<string> = Effect.map(
	Metric.snapshot,
	encodePrometheus,
);
