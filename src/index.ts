import "temporal-polyfill/global";

import { BunRuntime } from "@effect/platform-bun";
import { Effect, ManagedRuntime } from "effect";
import { AppConfigLive, AppConfigService } from "#src/config.ts";
import { handleRequest } from "#src/http/router.ts";
import { AppLayer } from "#src/layers.ts";
import { HTTP_INTERNAL_SERVER_ERROR } from "./http/status";

const program = Effect.gen(function* () {
	const {
		server: { port },
	} = yield* AppConfigService;

	const runtime = ManagedRuntime.make(AppLayer);

	Bun.serve({
		port,
		fetch: (req, server) =>
			runtime.runPromise(handleRequest(req, server)).catch((error) => {
				console.error("Error handling request:", error);
				return new Response("Internal Server Error", {
					status: HTTP_INTERNAL_SERVER_ERROR,
				});
			}),
	});

	yield* Effect.log(`shuriken-ts listening on :${port}`);
	return yield* Effect.never;
});

BunRuntime.runMain(program.pipe(Effect.provide(AppConfigLive)));
