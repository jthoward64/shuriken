import { and, desc, eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { DatabaseClient } from "#src/db/client.ts";
import { authUser } from "#src/db/drizzle/schema/index.ts";
import { runDbQuery } from "#src/db/query.ts";
import type { UserId, UuidString } from "#src/domain/ids.ts";
import {
	AppPasswordRepository,
	type AppPasswordRow,
	type NewAppPassword,
} from "./repository.ts";

const APP_PASSWORD_SOURCE = "app_password";

const create = Effect.fn("AppPasswordRepository.create")(
	function* (input: NewAppPassword) {
		yield* Effect.annotateCurrentSpan({ "user.id": input.userId });
		yield* runDbQuery((db) =>
			db.insert(authUser).values({
				userId: input.userId,
				authSource: APP_PASSWORD_SOURCE,
				authId: input.username,
				label: input.label,
				authCredential: input.authCredential,
			}),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.appPassword.create failed", e.cause),
	),
);

const listByUser = Effect.fn("AppPasswordRepository.listByUser")(
	function* (userId: UserId) {
		yield* Effect.annotateCurrentSpan({ "user.id": userId });
		const rows = yield* runDbQuery((db) =>
			db
				.select({
					id: authUser.id,
					username: authUser.authId,
					label: authUser.label,
					lastUsedAt: authUser.lastUsedAt,
					createdAt: authUser.updatedAt,
				})
				.from(authUser)
				.where(
					and(
						eq(authUser.userId, userId),
						eq(authUser.authSource, APP_PASSWORD_SOURCE),
					),
				)
				.orderBy(desc(authUser.updatedAt)),
		);
		return rows satisfies ReadonlyArray<AppPasswordRow>;
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.appPassword.listByUser failed", e.cause),
	),
);

const deleteForUser = Effect.fn("AppPasswordRepository.deleteForUser")(
	function* (userId: UserId, id: UuidString) {
		yield* Effect.annotateCurrentSpan({ "user.id": userId });
		yield* runDbQuery((db) =>
			db
				.delete(authUser)
				.where(
					and(
						eq(authUser.id, id),
						eq(authUser.userId, userId),
						eq(authUser.authSource, APP_PASSWORD_SOURCE),
					),
				),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.appPassword.deleteForUser failed", e.cause),
	),
);

export const AppPasswordRepositoryLive = Layer.effect(
	AppPasswordRepository,
	Effect.gen(function* () {
		const dc = yield* DatabaseClient;
		const run = <A, E>(
			e: Effect.Effect<A, E, DatabaseClient>,
		): Effect.Effect<A, E> => Effect.provideService(e, DatabaseClient, dc);
		return {
			create: (...args: Parameters<typeof create>) => run(create(...args)),
			listByUser: (...args: Parameters<typeof listByUser>) =>
				run(listByUser(...args)),
			deleteForUser: (...args: Parameters<typeof deleteForUser>) =>
				run(deleteForUser(...args)),
		};
	}),
);
