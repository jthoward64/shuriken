import { Effect, type Layer } from "effect";
import { BasicAuthLayer } from "#src/auth/layers/basic.ts";
import { ProxyAuthLayer } from "#src/auth/layers/proxy.ts";
import { SingleUserAuthLayer } from "#src/auth/layers/single-user.ts";
import type { AuthService } from "#src/auth/service.ts";
import { AppConfigService } from "#src/config.ts";
import type { DatabaseClient } from "#src/db/client.ts";
import type { AuthError, DatabaseError } from "#src/domain/errors.ts";
import type { CryptoService } from "#src/platform/crypto.ts";

// ---------------------------------------------------------------------------
// Auth layer selector — reads AUTH_MODE from AppConfigService at startup and
// returns the appropriate concrete Layer. Used in layers.ts via
// Layer.unwrapEffect.
// ---------------------------------------------------------------------------

export const selectAuthLayer: Effect.Effect<
	Layer.Layer<
		AuthService,
		AuthError | DatabaseError,
		DatabaseClient | CryptoService
	>,
	never,
	AppConfigService
> = Effect.gen(function* () {
	const {
		auth: { mode },
	} = yield* AppConfigService;
	switch (mode) {
		case "basic":
			return BasicAuthLayer;
		case "proxy":
			return ProxyAuthLayer as Layer.Layer<
				AuthService,
				AuthError | DatabaseError,
				DatabaseClient | CryptoService
			>;
		default:
			// "single-user" or unknown values fall back to single-user
			return SingleUserAuthLayer as Layer.Layer<
				AuthService,
				AuthError | DatabaseError,
				DatabaseClient | CryptoService
			>;
	}
});
