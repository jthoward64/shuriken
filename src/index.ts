import "temporal-polyfill/global";

import { NodeRuntime } from "@effect/platform-node";
import { Effect, Layer, Logger, ManagedRuntime } from "effect";
import { AppConfigLive, AppConfigService } from "#src/config.ts";
import { metricsHandler } from "#src/http/metrics/handler.ts";
import { handleRequest } from "#src/http/router.ts";
import { AppLayer } from "#src/layers.ts";
import {
	autoLoginStartup,
	basicAuthStartup,
	oidcStartup,
} from "#src/startup.ts";
import { HTTP_INTERNAL_SERVER_ERROR } from "./http/status.ts";

const program = Effect.gen(function* () {
	const {
		server: { port, host },
		metrics,
	} = yield* AppConfigService;

	const runtime = ManagedRuntime.make(AppLayer);

	yield* Effect.promise(() =>
		runtime.runPromise(
			Effect.gen(function* () {
				yield* autoLoginStartup;
				yield* basicAuthStartup;
				yield* oidcStartup;
			}).pipe(Effect.tapError((err) => Effect.logError("startup failed", err))),
		),
	);

	Deno.serve({ port, hostname: host }, (req, info) => {
		const clientAddress =
			info.remoteAddr.transport === "tcp"
				? info.remoteAddr.hostname
				: undefined;
		return runtime
			.runPromise(handleRequest(req, clientAddress))
			.catch((error) => {
				// Safety net: handleRequest is typed as never-failing, so this only
				// fires on defects (bugs in Effect itself, OOM, etc.)
				void runtime
					.runPromise(Effect.logError("unhandled request defect", error))
					.catch(() => undefined);
				return new Response("Internal Server Error", {
					status: HTTP_INTERNAL_SERVER_ERROR,
				});
			});
	});

	yield* Effect.log(`shuriken-ts listening on :${port}`);

	// Dedicated metrics listener — separate port keeps the Prometheus endpoint
	// off the public HTTP surface (and thus off the ingress). Runs under the
	// same runtime so its snapshot reflects metrics recorded by request handling.
	if (metrics.enabled) {
		Deno.serve({ port: metrics.port, hostname: host }, (req) =>
			runtime
				.runPromise(metricsHandler(req, new URL(req.url)))
				.catch((error) => {
					void runtime
						.runPromise(Effect.logError("metrics endpoint defect", error))
						.catch(() => undefined);
					return new Response("Internal Server Error", {
						status: HTTP_INTERNAL_SERVER_ERROR,
					});
				}),
		);
		yield* Effect.log(`shuriken-ts metrics on :${metrics.port}/metrics`);
	}

	return yield* Effect.never;
});

NodeRuntime.runMain(
	program.pipe(
		Effect.provide(
			Layer.mergeAll(Logger.layer([Logger.consolePretty()]), AppConfigLive),
		),
	),
);
