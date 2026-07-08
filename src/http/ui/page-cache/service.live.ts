import { Effect, Layer } from "effect";
import { PageCacheService } from "./service.ts";

// ---------------------------------------------------------------------------
// PageCacheServiceLive — mints the startup token once per process.
// ---------------------------------------------------------------------------

export const PageCacheServiceLive = Layer.effect(
	PageCacheService,
	Effect.sync(() => ({ startupToken: crypto.randomUUID() })),
);
