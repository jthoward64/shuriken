import { Effect, Layer, Option, Redacted } from "effect";
import { Temporal } from "temporal-polyfill";
import { AppConfigService } from "#src/config.ts";
import type { AuthenticatedPrincipal } from "#src/domain/types/dav.ts";
import { SessionRepository } from "#src/services/session/repository.ts";
import {
	type IssuedSession,
	SessionService,
	type SessionServiceShape,
} from "#src/services/session/service.ts";
import {
	generateSessionToken,
	sha256Hex,
} from "#src/services/session/token.ts";

const SECONDS_PER_DAY = 86_400;

export const SessionServiceLive = Layer.effect(
	SessionService,
	Effect.gen(function* () {
		const repo = yield* SessionRepository;
		const {
			auth: { sessionTtlDays },
		} = yield* AppConfigService;
		const ttlSeconds = sessionTtlDays * SECONDS_PER_DAY;

		const create: SessionServiceShape["create"] = (input) =>
			Effect.gen(function* () {
				const token = generateSessionToken();
				const tokenHash = yield* Effect.promise(() => sha256Hex(token));
				const now = Temporal.Now.instant();
				const expiresAt = now.add({ seconds: ttlSeconds });
				yield* repo.create({
					userId: input.userId,
					tokenHash,
					expiresAt,
					userAgent: Option.getOrNull(input.userAgent),
					ip: Option.getOrNull(input.ip),
				});
				return {
					token: Redacted.make(token),
					expiresAt,
				} satisfies IssuedSession;
			});

		const validate: SessionServiceShape["validate"] = (token) =>
			Effect.gen(function* () {
				const tokenHash = yield* Effect.promise(() =>
					sha256Hex(Redacted.value(token)),
				);
				const now = Temporal.Now.instant();
				const authOpt = yield* repo.findAuthByTokenHash(tokenHash, now);
				return yield* Option.match(authOpt, {
					onNone: () => Effect.succeed(Option.none<AuthenticatedPrincipal>()),
					onSome: (auth) =>
						repo.touch(auth.sessionId, now).pipe(
							Effect.ignore,
							Effect.as(
								Option.some<AuthenticatedPrincipal>({
									principalId: auth.principalId,
									userId: auth.userId,
									displayName: Option.fromNullishOr(auth.displayName),
								}),
							),
						),
				});
			});

		const revoke: SessionServiceShape["revoke"] = (token) =>
			Effect.gen(function* () {
				const tokenHash = yield* Effect.promise(() =>
					sha256Hex(Redacted.value(token)),
				);
				yield* repo.deleteByTokenHash(tokenHash);
			});

		return { create, validate, revoke };
	}),
);
