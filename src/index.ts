import "temporal-polyfill/global";

import { NodeRuntime } from "@effect/platform-node";
import { Effect, Layer, Logger, ManagedRuntime } from "effect";
import { AppConfigLive, AppConfigService, LogLevelLive } from "#src/config.ts";
import { metricsHandler } from "#src/http/metrics/handler.ts";
import { handleRequest } from "#src/http/router.ts";
import { AppLayer } from "#src/layers.ts";
import {
	autoLoginStartup,
	basicAuthStartup,
	oidcStartup,
} from "#src/startup.ts";
import { HTTP_INTERNAL_SERVER_ERROR } from "./http/status.ts";

/** Last-resort response for a defect, after logging it outside the failed fiber. */
const defectResponse = (
	runtime: { readonly runPromise: (e: Effect.Effect<void>) => Promise<void> },
	message: string,
	error: unknown,
): Response => {
	void runtime.runPromise(Effect.logError(message, error));
	return new Response("Internal Server Error", {
		status: HTTP_INTERNAL_SERVER_ERROR,
	});
};

NodeRuntime.runMain(
	Effect.gen(function* () {
		const {
			server: { port, host },
			metrics,
		} = yield* AppConfigService;

		const runtime = ManagedRuntime.make(AppLayer);

		yield* Effect.promise(() =>
			runtime.runPromise(
				autoLoginStartup.pipe(
					Effect.andThen(basicAuthStartup),
					Effect.andThen(oidcStartup),
					Effect.tapError((err) => Effect.logError("startup failed", err)),
				),
			),
		);

		const server = Deno.serve(
			{ port, hostname: host, automaticCompression: true },
			(req, info) => {
				const clientAddress =
					info.remoteAddr.transport === "tcp"
						? info.remoteAddr.hostname
						: undefined;
				return (
					runtime
						.runPromise(handleRequest(req, clientAddress))
						// Safety net: handleRequest is typed as never-failing, so this only
						// fires on defects (bugs in Effect itself, OOM, etc.)
						.catch((error) =>
							defectResponse(runtime, "unhandled request defect", error),
						)
				);
			},
		);

		yield* Effect.log(`shuriken-ts listening on :${port}`);

		// Dedicated metrics listener — separate port keeps the Prometheus endpoint
		// off the public HTTP surface (and thus off the ingress). Runs under the
		// same runtime so its snapshot reflects metrics recorded by request handling.
		if (metrics.enabled) {
			Deno.serve({ port: metrics.port, hostname: host }, (req) =>
				runtime
					.runPromise(metricsHandler(req, new URL(req.url)))
					.catch((error) =>
						defectResponse(runtime, "metrics endpoint defect", error),
					),
			);
			yield* Effect.log(`shuriken-ts metrics on :${metrics.port}/metrics`);
		}

		// The listener owns the process lifetime: the main effect stays suspended
		// until the server stops accepting connections.
		return yield* Effect.promise(() => server.finished);
	}).pipe(
		Effect.provide(
			Layer.mergeAll(
				Logger.layer([Logger.consolePretty()]),
				LogLevelLive,
				AppConfigLive,
			),
		),
	),
);
