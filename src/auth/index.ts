import { Config, Effect, type Layer } from "effect";
import { BasicAuthLayer } from "#/auth/layers/basic.ts";
import { ProxyAuthLayer } from "#/auth/layers/proxy.ts";
import { SingleUserAuthLayer } from "#/auth/layers/single-user.ts";
import type { AuthService } from "#/auth/service.ts";
import type { DatabaseClient } from "#/db/client.ts";
import type { AuthError, DatabaseError } from "#/domain/errors.ts";
import type { CryptoService } from "#/platform/crypto.ts";

// ---------------------------------------------------------------------------
// Auth layer selector — reads AUTH_MODE config at startup and returns the
// appropriate concrete Layer. Used in layers.ts via Layer.unwrapEffect.
// ---------------------------------------------------------------------------

export const selectAuthLayer: Effect.Effect<
	Layer.Layer<
		AuthService,
		AuthError | DatabaseError,
		DatabaseClient | CryptoService
	>,
	never
> = Config.string("AUTH_MODE").pipe(
	Config.withDefault("single-user"),
	Effect.orDie,
	Effect.map((mode) => {
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
	}),
);
