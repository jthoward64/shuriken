import { and, eq, isNull } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import { DatabaseClient } from "#src/db/client.ts";
import { principal, user } from "#src/db/drizzle/schema/index.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import type { PrincipalId, UserId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import type { Email } from "#src/domain/types/strings.ts";
import {
	PrincipalRepository,
	type PrincipalWithUser,
	type UserRow,
} from "./repository.ts";

// ---------------------------------------------------------------------------
// PrincipalRepository — Drizzle implementation
// ---------------------------------------------------------------------------

export const PrincipalRepositoryLive = Layer.effect(
	PrincipalRepository,
	Effect.gen(function* () {
		const db = yield* DatabaseClient;

		const findById = (
			id: PrincipalId,
		): Effect.Effect<
			Option.Option<PrincipalWithUser>,
			import("#src/domain/errors.ts").DatabaseError
		> =>
			Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(principal)
						.innerJoin(user, eq(user.principalId, principal.id))
						.where(and(eq(principal.id, id), isNull(principal.deletedAt)))
						.limit(1)
						.then((r) =>
							Option.fromNullable(
								r[0] ? { principal: r[0].principal, user: r[0].user } : null,
							),
						),
				catch: (e) => new DatabaseError({ cause: e }),
			});

		const findBySlug = (
			slug: Slug,
		): Effect.Effect<
			Option.Option<PrincipalWithUser>,
			import("#src/domain/errors.ts").DatabaseError
		> =>
			Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(principal)
						.innerJoin(user, eq(user.principalId, principal.id))
						.where(and(eq(principal.slug, slug), isNull(principal.deletedAt)))
						.limit(1)
						.then((r) =>
							Option.fromNullable(
								r[0] ? { principal: r[0].principal, user: r[0].user } : null,
							),
						),
				catch: (e) => new DatabaseError({ cause: e }),
			});

		const findByEmail = (
			email: Email,
		): Effect.Effect<
			Option.Option<PrincipalWithUser>,
			import("#src/domain/errors.ts").DatabaseError
		> =>
			Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(user)
						.innerJoin(principal, eq(principal.id, user.principalId))
						.where(and(eq(user.email, email), isNull(principal.deletedAt)))
						.limit(1)
						.then((r) =>
							Option.fromNullable(
								r[0] ? { principal: r[0].principal, user: r[0].user } : null,
							),
						),
				catch: (e) => new DatabaseError({ cause: e }),
			});

		const findUserByUserId = (
			id: UserId,
		): Effect.Effect<
			Option.Option<UserRow>,
			import("#src/domain/errors.ts").DatabaseError
		> =>
			Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(user)
						.where(eq(user.id, id))
						.limit(1)
						.then((r) => Option.fromNullable(r[0])),
				catch: (e) => new DatabaseError({ cause: e }),
			});

		return PrincipalRepository.of({
			findById,
			findBySlug,
			findByEmail,
			findUserByUserId,
		});
	}),
);
