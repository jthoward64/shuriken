import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect, Metric } from "effect";
import { encodePrometheus } from "#src/observability/prometheus.ts";

// Build a snapshot array by recording into real Effect metrics and reading the
// registry back. This exercises the actual snapshot shapes (counter/histogram
// state) rather than hand-rolled fixtures that could drift from Effect's types.
const snapshotAfter = (
	...records: ReadonlyArray<Effect.Effect<unknown>>
): ReadonlyArray<Metric.Metric.Snapshot> =>
	Effect.runSync(
		Effect.flatMap(
			Effect.all(records, { discard: true }),
			() => Metric.snapshot,
		),
	);

// Extract the lines belonging to a single metric family (HELP/TYPE + samples)
// so an assertion isn't confused by another family's identically-suffixed lines.
const familyBlock = (text: string, name: string): string => {
	const lines = text.split("\n");
	const start = lines.findIndex((l) => l.startsWith(`# HELP ${name} `));
	const block: Array<string> = [];
	for (let i = start; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined || (i > start && line.startsWith("# HELP "))) {
			break;
		}
		block.push(line);
	}
	return block.join("\n");
};

describe("encodePrometheus", () => {
	it("renders a counter with a _total suffix and sanitized name", () => {
		const counter = Metric.withAttributes(
			Metric.counter("shuriken.test.requests", {
				description: "Test requests",
			}),
			{ "http.method": "GET" },
		);
		const text = encodePrometheus(snapshotAfter(Metric.update(counter, 3)));

		expect(text).toContain("# TYPE shuriken_test_requests_total counter");
		expect(text).toContain("# HELP shuriken_test_requests_total Test requests");
		expect(text).toContain('shuriken_test_requests_total{http_method="GET"} 3');
	});

	it("emits HELP/TYPE once across multiple attribute sets of one family", () => {
		const base = Metric.counter("shuriken.test.dispatch");
		const get = Metric.withAttributes(base, { method: "GET" });
		const put = Metric.withAttributes(base, { method: "PUT" });
		const text = encodePrometheus(
			snapshotAfter(Metric.update(get, 1), Metric.update(put, 2)),
		);

		const helpCount = text
			.split("\n")
			.filter(
				(l) => l === "# TYPE shuriken_test_dispatch_total counter",
			).length;
		expect(helpCount).toBe(1);
		expect(text).toContain('shuriken_test_dispatch_total{method="GET"} 1');
		expect(text).toContain('shuriken_test_dispatch_total{method="PUT"} 2');
	});

	it("renders a histogram as cumulative buckets plus _sum and _count", () => {
		const hist = Metric.histogram("shuriken.test.latency_ms", {
			boundaries: Metric.linearBoundaries({ start: 0, width: 10, count: 3 }),
		});
		const text = encodePrometheus(
			snapshotAfter(Metric.update(hist, 5), Metric.update(hist, 15)),
		);
		const block = familyBlock(text, "shuriken_test_latency_ms");

		expect(block).toContain("# TYPE shuriken_test_latency_ms histogram");
		// le="+Inf" bucket equals the total observation count.
		expect(block).toContain('shuriken_test_latency_ms_bucket{le="+Inf"} 2');
		expect(block).toContain("shuriken_test_latency_ms_count 2");
		expect(block).toContain("shuriken_test_latency_ms_sum 20");
		// Each boundary carries an `le` label.
		expect(block).toContain('shuriken_test_latency_ms_bucket{le="10"}');
	});

	it("escapes label values and renders gauges without a suffix", () => {
		const gauge = Metric.withAttributes(Metric.gauge("shuriken.test.queue"), {
			note: 'a"b\\c',
		});
		const text = encodePrometheus(snapshotAfter(Metric.update(gauge, 7)));

		expect(text).toContain("# TYPE shuriken_test_queue gauge");
		expect(text).toContain('shuriken_test_queue{note="a\\"b\\\\c"} 7');
	});

	it("produces an empty document for no metrics", () => {
		expect(encodePrometheus([])).toBe("");
	});
});
