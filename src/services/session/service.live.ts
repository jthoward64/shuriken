import { Effect, Layer, Option, Redacted } from "effect";
import { Temporal } from "temporal-polyfill";
import { AppConfigService } from "#src/config.ts";
import type { AuthenticatedPrincipal } from "#src/domain/types/dav.ts";
import type {
	SessionAuth,
	SessionRepositoryShape,
} from "#src/services/session/repository.ts";
import { SessionRepository } from "#src/services/session/repository.ts";
import {
	type CreateSessionInput,
	type IssuedSession,
	SessionService,
} from "#src/services/session/service.ts";
import {
	generateSessionToken,
	sha256Hex,
} from "#src/services/session/token.ts";

const SECONDS_PER_DAY = 86_400;

/** Mint an opaque session token, storing only its hash */
const createSession = Effect.fn("session.create")(function* (
	repo: SessionRepositoryShape,
	ttlSeconds: number,
	input: CreateSessionInput,
) {
	const token = generateSessionToken();
	const tokenHash = yield* Effect.promise(() => sha256Hex(token));
	const expiresAt = Temporal.Now.instant().add({ seconds: ttlSeconds });
	yield* repo.create({
		userId: input.userId,
		tokenHash,
		expiresAt,
		userAgent: Option.getOrNull(input.userAgent),
		ip: Option.getOrNull(input.ip),
	});
	return { token: Redacted.make(token), expiresAt } satisfies IssuedSession;
});

/** Refresh the session's last-seen stamp; a failure never invalidates the session */
const touchSession = Effect.fn("session.touch")(function* (
	repo: SessionRepositoryShape,
	auth: SessionAuth,
	now: Temporal.Instant,
) {
	yield* Effect.ignore(repo.touch(auth.sessionId, now));
	return Option.some<AuthenticatedPrincipal>({
		principalId: auth.principalId,
		userId: auth.userId,
		displayName: Option.fromNullishOr(auth.displayName),
	});
});

/** Resolve a session token to its authenticated principal, if it is still live */
const validateSession = Effect.fn("session.validate")(function* (
	repo: SessionRepositoryShape,
	token: Redacted.Redacted<string>,
) {
	const tokenHash = yield* Effect.promise(() =>
		sha256Hex(Redacted.value(token)),
	);
	const now = Temporal.Now.instant();
	const authOpt = yield* repo.findAuthByTokenHash(tokenHash, now);
	if (Option.isNone(authOpt)) {
		return Option.none<AuthenticatedPrincipal>();
	}
	return yield* touchSession(repo, authOpt.value, now);
});

/** Delete the session behind a token (logout) */
const revokeSession = Effect.fn("session.revoke")(function* (
	repo: SessionRepositoryShape,
	token: Redacted.Redacted<string>,
) {
	const tokenHash = yield* Effect.promise(() =>
		sha256Hex(Redacted.value(token)),
	);
	yield* repo.deleteByTokenHash(tokenHash);
});

export const SessionServiceLive = Layer.effect(
	SessionService,
	Effect.gen(function* () {
		const repo = yield* SessionRepository;
		const {
			auth: { sessionTtlDays },
		} = yield* AppConfigService;
		const ttlSeconds = sessionTtlDays * SECONDS_PER_DAY;

		return {
			create: (input) => createSession(repo, ttlSeconds, input),
			validate: (token) => validateSession(repo, token),
			revoke: (token) => revokeSession(repo, token),
		};
	}),
);
