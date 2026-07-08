import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import type { Temporal } from "temporal-polyfill";
import { DatabaseClient } from "#src/db/client.ts";
import { principal, session, user } from "#src/db/drizzle/schema/index.ts";
import { runDbQuery } from "#src/db/query.ts";
import { PrincipalId, UserId, type UuidString } from "#src/domain/ids.ts";
import { type NewSession, SessionRepository } from "./repository.ts";

const create = Effect.fn("SessionRepository.create")(
	function* (input: NewSession) {
		yield* Effect.annotateCurrentSpan({ "user.id": input.userId });
		yield* runDbQuery((db) =>
			db.insert(session).values({
				userId: input.userId,
				tokenHash: input.tokenHash,
				expiresAt: input.expiresAt,
				userAgent: input.userAgent,
				ip: input.ip,
			}),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.session.create failed", e.cause),
	),
);

const findAuthByTokenHash = Effect.fn("SessionRepository.findAuthByTokenHash")(
	function* (tokenHash: string, now: Temporal.Instant) {
		const rows = yield* runDbQuery((db) =>
			db
				.select({
					sessionId: session.id,
					principalId: user.principalId,
					userId: user.id,
					displayName: principal.displayName,
				})
				.from(session)
				.innerJoin(user, eq(session.userId, user.id))
				.innerJoin(principal, eq(user.principalId, principal.id))
				.where(
					and(
						eq(session.tokenHash, tokenHash),
						gt(session.expiresAt, now),
						isNull(principal.deletedAt),
					),
				)
				.limit(1),
		);
		const row = rows[0];
		if (row === undefined) {
			return Option.none();
		}
		return Option.some({
			sessionId: row.sessionId as UuidString,
			principalId: PrincipalId(row.principalId),
			userId: UserId(row.userId),
			displayName: row.displayName,
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.session.findAuthByTokenHash failed", e.cause),
	),
);

const touch = Effect.fn("SessionRepository.touch")(
	function* (sessionId: UuidString, now: Temporal.Instant) {
		yield* runDbQuery((db) =>
			db
				.update(session)
				.set({ lastSeenAt: now })
				.where(eq(session.id, sessionId)),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.session.touch failed", e.cause),
	),
);

const deleteByTokenHash = Effect.fn("SessionRepository.deleteByTokenHash")(
	function* (tokenHash: string) {
		yield* runDbQuery((db) =>
			db.delete(session).where(eq(session.tokenHash, tokenHash)),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.session.deleteByTokenHash failed", e.cause),
	),
);

const deleteExpired = Effect.fn("SessionRepository.deleteExpired")(
	function* (now: Temporal.Instant) {
		yield* runDbQuery((db) =>
			db.delete(session).where(lt(session.expiresAt, now)),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.session.deleteExpired failed", e.cause),
	),
);

export const SessionRepositoryLive = Layer.effect(
	SessionRepository,
	Effect.gen(function* () {
		const dc = yield* DatabaseClient;
		const run = <A, E>(
			e: Effect.Effect<A, E, DatabaseClient>,
		): Effect.Effect<A, E> => Effect.provideService(e, DatabaseClient, dc);
		return {
			create: (...args: Parameters<typeof create>) => run(create(...args)),
			findAuthByTokenHash: (...args: Parameters<typeof findAuthByTokenHash>) =>
				run(findAuthByTokenHash(...args)),
			touch: (...args: Parameters<typeof touch>) => run(touch(...args)),
			deleteByTokenHash: (...args: Parameters<typeof deleteByTokenHash>) =>
				run(deleteByTokenHash(...args)),
			deleteExpired: (...args: Parameters<typeof deleteExpired>) =>
				run(deleteExpired(...args)),
		};
	}),
);
