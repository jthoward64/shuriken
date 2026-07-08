import { Effect } from "effect";
import {
	PROMETHEUS_CONTENT_TYPE,
	renderPrometheus,
} from "#src/observability/prometheus.ts";

// ---------------------------------------------------------------------------
// Metrics endpoint handler.
//
// Serves the Prometheus text exposition at `/metrics`. This runs on the
// dedicated metrics listener (see src/index.ts), kept separate from the public
// HTTP port so the endpoint is never reachable through the ingress. No auth:
// the listener is meant to be reached only in-cluster by the Prometheus
// scraper, gated by NetworkPolicy if desired.
// ---------------------------------------------------------------------------

const METRICS_PATH = "/metrics";

/** Handle a request to the metrics listener. */
export const metricsHandler = (
	req: Request,
	url: URL,
): Effect.Effect<Response> => {
	if (url.pathname !== METRICS_PATH) {
		return Effect.succeed(new Response("Not Found", { status: 404 }));
	}
	if (req.method !== "GET" && req.method !== "HEAD") {
		return Effect.succeed(
			new Response("Method Not Allowed", {
				status: 405,
				headers: { Allow: "GET, HEAD" },
			}),
		);
	}
	return Effect.map(
		renderPrometheus,
		(body) =>
			new Response(req.method === "HEAD" ? null : body, {
				status: 200,
				headers: { "Content-Type": PROMETHEUS_CONTENT_TYPE },
			}),
	);
};
