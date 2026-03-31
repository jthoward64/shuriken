import "dotenv/config";
import "temporal-polyfill/global";

import { BunRuntime } from "@effect/platform-bun";
import { Config, Effect, ManagedRuntime } from "effect";
import { handleRequest } from "#/http/router.ts";
import { AppLayer } from "#/layers.ts";

const program = Effect.gen(function* () {
  const port = yield* Config.integer("PORT").pipe(Config.withDefault(3000));

  const runtime = ManagedRuntime.make(AppLayer);

  Bun.serve({
    port,
    fetch: (req, server) =>
      runtime
        .runPromise(handleRequest(req, server))
        .catch(() => new Response("Internal Server Error", { status: 500 })),
  });

  yield* Effect.log(`shuriken-ts listening on :${port}`);
  return yield* Effect.never;
});

BunRuntime.runMain(program);
