import { eq } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import { DatabaseClient } from "#src/db/client.ts";
import { userEmailCredential } from "#src/db/drizzle/schema/index.ts";
import { runDbQuery } from "#src/db/query.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import type { UserId } from "#src/domain/ids.ts";
import {
	type NewUserEmailCredential,
	UserEmailCredentialRepository,
} from "./repository.ts";

const findByUserId = Effect.fn("UserEmailCredentialRepository.findByUserId")(
	function* (userId: UserId) {
		yield* Effect.annotateCurrentSpan({ "user.id": userId });
		const rows = yield* runDbQuery((db) =>
			db
				.select()
				.from(userEmailCredential)
				.where(eq(userEmailCredential.userId, userId))
				.limit(1),
		);
		return Option.fromNullishOr(rows[0]);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.userEmailCredential.findByUserId failed", e.cause),
	),
);

const upsert = Effect.fn("UserEmailCredentialRepository.upsert")(
	function* (input: NewUserEmailCredential) {
		yield* Effect.annotateCurrentSpan({ "user.id": input.userId });
		return yield* runDbQuery((db) =>
			db
				.insert(userEmailCredential)
				.values(input)
				.onConflictDoUpdate({
					target: userEmailCredential.userId,
					set: {
						fromAddress: input.fromAddress,
						fromName: input.fromName,
						host: input.host,
						port: input.port,
						username: input.username,
						passwordEncrypted: input.passwordEncrypted,
						passwordIv: input.passwordIv,
						security: input.security,
					},
				})
				.returning(),
		).pipe(
			Effect.flatMap((rows) => {
				const row = rows[0];
				if (!row) {
					return Effect.fail(
						new DatabaseError({ cause: new Error("upsert returned no rows") }),
					);
				}
				return Effect.succeed(row);
			}),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.userEmailCredential.upsert failed", e.cause),
	),
);

const del = Effect.fn("UserEmailCredentialRepository.delete")(
	function* (userId: UserId) {
		yield* Effect.annotateCurrentSpan({ "user.id": userId });
		yield* runDbQuery((db) =>
			db
				.delete(userEmailCredential)
				.where(eq(userEmailCredential.userId, userId)),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.userEmailCredential.delete failed", e.cause),
	),
);

export const UserEmailCredentialRepositoryLive = Layer.effect(
	UserEmailCredentialRepository,
	Effect.gen(function* () {
		const dc = yield* DatabaseClient;
		const run = <A, E>(
			e: Effect.Effect<A, E, DatabaseClient>,
		): Effect.Effect<A, E> => Effect.provideService(e, DatabaseClient, dc);
		return {
			findByUserId: (...args: Parameters<typeof findByUserId>) =>
				run(findByUserId(...args)),
			upsert: (...args: Parameters<typeof upsert>) => run(upsert(...args)),
			delete: (...args: Parameters<typeof del>) => run(del(...args)),
		};
	}),
);
