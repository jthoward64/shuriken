import { and, eq, isNull, or } from "drizzle-orm";
import { Effect, Layer, Metric, Option, Redacted } from "effect";
import { Temporal } from "temporal-polyfill";
import { AuthService } from "#src/auth/service.ts";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
import { authUser, principal, user } from "#src/db/drizzle/schema/index.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import { PrincipalId, UserId, type UuidString } from "#src/domain/ids.ts";
import {
	Authenticated,
	type AuthResult,
	Unauthenticated,
} from "#src/domain/types/dav.ts";
import { authAttemptsTotal } from "#src/observability/metrics.ts";
import {
	CryptoService,
	type CryptoServiceShape,
} from "#src/platform/crypto.ts";

// ---------------------------------------------------------------------------
// Basic auth
//
// Parses HTTP Basic Authentication credentials and verifies them against the
// auth_user table. Two credential kinds are accepted:
//   * authSource = "local"        — the username matches auth_id directly.
//   * authSource = "app_password" — a per-device secret; the supplied username
//     may be either the credential's generated username (auth_id) or the
//     owner's principal slug, so an OIDC user (who has no local password) can
//     still connect DAV clients.
//
// The password is verified (argon2id) against each matching candidate; the
// first match wins and its last_used_at is stamped.
// ---------------------------------------------------------------------------

const BASIC_PREFIX = "Basic ";

const authCounter = Metric.withAttributes(authAttemptsTotal, {
	"auth.mode": "basic",
});

// atob throws on malformed base64; absence is the useful answer here
const decodeBase64 = (encoded: string): Option.Option<string> =>
	Effect.runSync(
		Effect.try(() => atob(encoded)).pipe(
			Effect.map(Option.some<string>),
			Effect.catch(() => Effect.succeed(Option.none<string>())),
		),
	);

export const parseBasicAuth = (
	headers: Headers,
): Option.Option<{ username: string; password: Redacted.Redacted<string> }> => {
	const authorization = headers.get("Authorization");
	if (!authorization?.startsWith(BASIC_PREFIX)) {
		return Option.none();
	}

	const decodedOpt = decodeBase64(authorization.slice(BASIC_PREFIX.length));
	if (Option.isNone(decodedOpt)) {
		return Option.none();
	}
	const decoded = decodedOpt.value;
	const colonIdx = decoded.indexOf(":");
	if (colonIdx === -1) {
		return Option.none();
	}

	const username = decoded.slice(0, colonIdx);
	const password = decoded.slice(colonIdx + 1);

	if (password.length === 0) {
		return Option.none();
	}

	return Option.some({
		username,
		password: Redacted.make(password),
	});
};

interface Candidate {
	readonly authUserId: UuidString;
	readonly authSource: string;
	readonly authCredential: Redacted.Redacted<string> | null;
	readonly userId: UuidString;
	readonly principalId: UuidString;
	readonly displayName: string | null;
}

/** The collaborators a basic-auth attempt runs against */
interface BasicAuthDeps {
	readonly db: DbClient;
	readonly crypto: CryptoServiceShape;
}

/** Count one basic-auth outcome */
const recordOutcome = (outcome: string): Effect.Effect<void> =>
	Metric.update(
		Metric.withAttributes(authCounter, { "auth.outcome": outcome }),
		1,
	);

/** No usable Authorization header: anonymous rather than failed */
const noCredentials = Effect.fn("auth.basic.noCredentials")(function* () {
	yield* Effect.logTrace("auth.basic: no credentials present");
	yield* recordOutcome("no_credentials");
	return new Unauthenticated() as AuthResult;
});

/** Credential rows a username could match: a local password or an app password */
const findCandidates = Effect.fn("auth.basic.findCandidates")(function* (
	db: DbClient,
	username: string,
) {
	const candidates: ReadonlyArray<Candidate> = yield* db
		.select({
			authUserId: authUser.id,
			authSource: authUser.authSource,
			authCredential: authUser.authCredential,
			userId: user.id,
			principalId: user.principalId,
			displayName: principal.displayName,
		})
		.from(authUser)
		.innerJoin(user, eq(authUser.userId, user.id))
		.innerJoin(principal, eq(user.principalId, principal.id))
		.where(
			and(
				isNull(principal.deletedAt),
				or(
					and(eq(authUser.authSource, "local"), eq(authUser.authId, username)),
					and(
						eq(authUser.authSource, "app_password"),
						or(eq(authUser.authId, username), eq(principal.slug, username)),
					),
				),
			),
		)
		.pipe(Effect.mapError((e) => new DatabaseError({ cause: e })));
	return candidates;
});

/** Stamp an app password's last-used time; a failed stamp must not fail the auth */
const stampLastUsed = Effect.fn("auth.basic.stampLastUsed")(function* (
	db: DbClient,
	authUserId: UuidString,
) {
	yield* db
		.update(authUser)
		.set({ lastUsedAt: Temporal.Now.instant() })
		.where(eq(authUser.id, authUserId))
		.pipe(
			Effect.mapError((e) => new DatabaseError({ cause: e })),
			Effect.ignore,
		);
});

/** Verify the password against each candidate in turn; the first match wins */
const matchCandidate = Effect.fn("auth.basic.matchCandidate")(function* (
	deps: BasicAuthDeps,
	candidates: ReadonlyArray<Candidate>,
	password: Redacted.Redacted<string>,
) {
	for (const candidate of candidates) {
		if (candidate.authCredential === null) {
			continue;
		}
		// InternalError from the crypto service is a defect, not a domain error.
		const valid = yield* deps.crypto
			.verifyPassword(password, candidate.authCredential)
			.pipe(Effect.orDie);
		if (!valid) {
			continue;
		}
		if (candidate.authSource === "app_password") {
			yield* stampLastUsed(deps.db, candidate.authUserId);
		}
		return Option.some(candidate);
	}
	return Option.none<Candidate>();
});

/** Look up the supplied username's credentials and verify the password */
const attemptBasic = Effect.fn("auth.basic.attempt")(function* (
	deps: BasicAuthDeps,
	creds: { username: string; password: Redacted.Redacted<string> },
) {
	yield* Effect.annotateCurrentSpan({ "auth.username": creds.username });
	yield* Effect.logTrace("auth.basic: attempt", { username: creds.username });

	const candidates = yield* findCandidates(deps.db, creds.username);
	if (candidates.length === 0) {
		yield* Effect.logDebug("auth.basic: user not found", {
			username: creds.username,
		});
		yield* recordOutcome("not_found");
		return new Unauthenticated() as AuthResult;
	}

	const matched = yield* matchCandidate(deps, candidates, creds.password);
	if (Option.isNone(matched)) {
		yield* Effect.logDebug("auth.basic: invalid password", {
			username: creds.username,
		});
		yield* recordOutcome("invalid_password");
		return new Unauthenticated() as AuthResult;
	}

	const candidate = matched.value;
	yield* Effect.logDebug("auth.basic: success", {
		userId: candidate.userId,
		username: creds.username,
		authSource: candidate.authSource,
	});
	yield* recordOutcome("success");
	return new Authenticated({
		principal: {
			principalId: PrincipalId(candidate.principalId),
			userId: UserId(candidate.userId),
			displayName: Option.fromNullishOr(candidate.displayName),
		},
	}) as AuthResult;
});

/** Log and count an unexpected failure during authentication */
const logAuthError = Effect.fn("auth.basic.logAuthError")(function* (
	error: DatabaseError,
) {
	yield* Effect.logWarning("auth.basic: error during authentication", {
		cause: error instanceof DatabaseError ? error.cause : error,
	});
	yield* recordOutcome("error");
});

/**
 * Core basic-auth logic. Parses the Authorization header, looks up matching
 * local / app-password credentials, verifies the password, and emits
 * per-outcome metrics. Returns Unauthenticated when no credentials are present,
 * no candidate matches, or every password check fails.
 *
 * Shared between BasicAuthLayer and CompositeAuthLayer.
 */
export const authenticateBasic = (
	headers: Headers,
): Effect.Effect<AuthResult, DatabaseError, DatabaseClient | CryptoService> =>
	Effect.gen(function* () {
		const deps: BasicAuthDeps = {
			db: yield* DatabaseClient,
			crypto: yield* CryptoService,
		};
		return yield* Option.match(parseBasicAuth(headers), {
			onNone: () => noCredentials(),
			onSome: (creds) => attemptBasic(deps, creds),
		});
	}).pipe(Effect.tapError(logAuthError));

export const BasicAuthLayer = Layer.effect(
	AuthService,
	Effect.gen(function* () {
		const db = yield* DatabaseClient;
		const crypto = yield* CryptoService;
		return {
			authenticate: Effect.fn("auth.basic.authenticate")(
				function* (headers, _clientIp) {
					yield* Effect.annotateCurrentSpan({ "auth.mode": "basic" });
					return yield* authenticateBasic(headers).pipe(
						Effect.provideService(DatabaseClient, db),
						Effect.provideService(CryptoService, crypto),
					);
				},
			),
		};
	}),
);
