import { Duration, Effect, Layer, Schedule } from "effect";
import { Temporal } from "temporal-polyfill";
import { OidcLoginRepository } from "#src/services/session/oidc-login-repository.ts";
import { SessionRepository } from "#src/services/session/repository.ts";

// ---------------------------------------------------------------------------
// SessionCleanupLayer — periodic sweep of expired sessions and abandoned
// pending OIDC logins. Both are filtered at read time too, so this is purely
// housekeeping to keep the tables from growing without bound.
// ---------------------------------------------------------------------------

const CLEANUP_INTERVAL_HOURS = 1;

/** One sweep: drop expired sessions and abandoned pending OIDC logins */
const sweep = Effect.fn("scheduler.session-cleanup.sweep")(function* () {
	const sessions = yield* SessionRepository;
	const logins = yield* OidcLoginRepository;
	const now = Temporal.Now.instant();
	yield* sessions.deleteExpired(now);
	yield* logins.deleteExpired(now);
});

export const SessionCleanupLayer = Layer.effectDiscard(
	Effect.gen(function* () {
		yield* Effect.logInfo("scheduler.session-cleanup: starting sweep fiber", {
			intervalHours: CLEANUP_INTERVAL_HOURS,
		});
		yield* sweep().pipe(
			Effect.catchCause((cause) =>
				Effect.logWarning("scheduler.session-cleanup: tick failed", { cause }),
			),
			Effect.repeat(Schedule.spaced(Duration.hours(CLEANUP_INTERVAL_HOURS))),
			Effect.forkScoped,
		);
	}),
);
