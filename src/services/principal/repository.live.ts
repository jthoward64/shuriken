import { and, eq, isNull } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { DatabaseClient } from "#/db/client.ts";
import { principal, user } from "#/db/drizzle/schema/index.ts";
import { databaseError } from "#/domain/errors.ts";
import type { PrincipalId, UserId } from "#/domain/ids.ts";
import type { Slug } from "#/domain/types/path.ts";
import {
	PrincipalRepository,
	type PrincipalRow,
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
			PrincipalRow | null,
			import("#/domain/errors.ts").DatabaseError
		> =>
			Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(principal)
						.where(and(eq(principal.id, id), isNull(principal.deletedAt)))
						.limit(1)
						.then((r) => r[0] ?? null),
				catch: (e) => databaseError(e),
			});

		const findBySlug = (
			slug: Slug,
		): Effect.Effect<
			PrincipalWithUser | null,
			import("#/domain/errors.ts").DatabaseError
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
							r[0] ? { principal: r[0].principal, user: r[0].user } : null,
						),
				catch: (e) => databaseError(e),
			});

		const findByEmail = (
			email: string,
		): Effect.Effect<
			PrincipalWithUser | null,
			import("#/domain/errors.ts").DatabaseError
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
							r[0] ? { principal: r[0].principal, user: r[0].user } : null,
						),
				catch: (e) => databaseError(e),
			});

		const findUserByUserId = (
			id: UserId,
		): Effect.Effect<
			UserRow | null,
			import("#/domain/errors.ts").DatabaseError
		> =>
			Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(user)
						.where(eq(user.id, id))
						.limit(1)
						.then((r) => r[0] ?? null),
				catch: (e) => databaseError(e),
			});

		return PrincipalRepository.of({
			findById,
			findBySlug,
			findByEmail,
			findUserByUserId,
		});
	}),
);
