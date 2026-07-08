import { eq, lt } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import type { Temporal } from "temporal-polyfill";
import { DatabaseClient } from "#src/db/client.ts";
import { oidcLogin } from "#src/db/drizzle/schema/index.ts";
import { runDbQuery } from "#src/db/query.ts";
import {
	type NewOidcLogin,
	OidcLoginRepository,
} from "./oidc-login-repository.ts";

const create = Effect.fn("OidcLoginRepository.create")(
	function* (input: NewOidcLogin) {
		yield* runDbQuery((db) =>
			db.insert(oidcLogin).values({
				state: input.state,
				pkceVerifier: input.pkceVerifier,
				nonce: input.nonce,
				returnTo: input.returnTo,
				expiresAt: input.expiresAt,
			}),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.oidcLogin.create failed", e.cause),
	),
);

const consume = Effect.fn("OidcLoginRepository.consume")(
	function* (state: string) {
		const rows = yield* runDbQuery((db) =>
			db.delete(oidcLogin).where(eq(oidcLogin.state, state)).returning({
				pkceVerifier: oidcLogin.pkceVerifier,
				nonce: oidcLogin.nonce,
				returnTo: oidcLogin.returnTo,
				expiresAt: oidcLogin.expiresAt,
			}),
		);
		return Option.fromNullishOr(rows[0]);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.oidcLogin.consume failed", e.cause),
	),
);

const deleteExpired = Effect.fn("OidcLoginRepository.deleteExpired")(
	function* (now: Temporal.Instant) {
		yield* runDbQuery((db) =>
			db.delete(oidcLogin).where(lt(oidcLogin.expiresAt, now)),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.oidcLogin.deleteExpired failed", e.cause),
	),
);

export const OidcLoginRepositoryLive = Layer.effect(
	OidcLoginRepository,
	Effect.gen(function* () {
		const dc = yield* DatabaseClient;
		const run = <A, E>(
			e: Effect.Effect<A, E, DatabaseClient>,
		): Effect.Effect<A, E> => Effect.provideService(e, DatabaseClient, dc);
		return {
			create: (...args: Parameters<typeof create>) => run(create(...args)),
			consume: (...args: Parameters<typeof consume>) => run(consume(...args)),
			deleteExpired: (...args: Parameters<typeof deleteExpired>) =>
				run(deleteExpired(...args)),
		};
	}),
);
