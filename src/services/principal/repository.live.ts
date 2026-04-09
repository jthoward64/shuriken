import { and, eq, isNull, sql } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import { DatabaseClient } from "#src/db/client.ts";
import { principal, user } from "#src/db/drizzle/schema/index.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import type { PrincipalId, UserId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import type { Email } from "#src/domain/types/strings.ts";
import {
	type PrincipalPropertyChanges,
	PrincipalRepository,
	type UserRow,
} from "./repository.ts";

// ---------------------------------------------------------------------------
// PrincipalRepository — Drizzle implementation
// ---------------------------------------------------------------------------

export const PrincipalRepositoryLive = Layer.effect(
	PrincipalRepository,
	Effect.gen(function* () {
		const db = yield* DatabaseClient;

		const findById = Effect.fn("PrincipalRepository.findById")(
			function* (id: PrincipalId) {
				yield* Effect.logTrace("repo.principal.findById", { id });
				return yield* Effect.tryPromise({
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
			},
			Effect.tapError((e: DatabaseError) =>
				Effect.logWarning("repo.principal.findById failed", e.cause),
			),
		);

		const findBySlug = Effect.fn("PrincipalRepository.findBySlug")(
			function* (slug: Slug) {
				yield* Effect.logTrace("repo.principal.findBySlug", { slug });
				return yield* Effect.tryPromise({
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
			},
			Effect.tapError((e: DatabaseError) =>
				Effect.logWarning("repo.principal.findBySlug failed", e.cause),
			),
		);

		const findPrincipalBySlug = Effect.fn(
			"PrincipalRepository.findPrincipalBySlug",
		)(
			function* (slug: Slug) {
				yield* Effect.logTrace("repo.principal.findPrincipalBySlug", { slug });
				return yield* Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(principal)
							.where(and(eq(principal.slug, slug), isNull(principal.deletedAt)))
							.limit(1)
							.then((r) => Option.fromNullable(r[0] ?? null)),
					catch: (e) => new DatabaseError({ cause: e }),
				});
			},
			Effect.tapError((e: DatabaseError) =>
				Effect.logWarning("repo.principal.findPrincipalBySlug failed", e.cause),
			),
		);

		const findByEmail = Effect.fn("PrincipalRepository.findByEmail")(
			function* (email: Email) {
				yield* Effect.logTrace("repo.principal.findByEmail");
				return yield* Effect.tryPromise({
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
			},
			Effect.tapError((e: DatabaseError) =>
				Effect.logWarning("repo.principal.findByEmail failed", e.cause),
			),
		);

		const findUserByUserId = Effect.fn("PrincipalRepository.findUserByUserId")(
			function* (id: UserId) {
				yield* Effect.logTrace("repo.principal.findUserByUserId", { id });
				return yield* Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(user)
							.where(eq(user.id, id))
							.limit(1)
							.then((r) => Option.fromNullable(r[0] as UserRow | undefined)),
					catch: (e) => new DatabaseError({ cause: e }),
				});
			},
			Effect.tapError((e: DatabaseError) =>
				Effect.logWarning("repo.principal.findUserByUserId failed", e.cause),
			),
		);

		const updateProperties = Effect.fn("PrincipalRepository.updateProperties")(
			function* (id: PrincipalId, changes: PrincipalPropertyChanges) {
				yield* Effect.logTrace("repo.principal.updateProperties", { id });
				const setValues: Record<string, unknown> = {
					clientProperties: changes.clientProperties,
					updatedAt: sql`now()`,
				};
				if (changes.displayName !== undefined) {
					setValues.displayName = changes.displayName;
				}
				return yield* Effect.tryPromise({
					try: () =>
						db
							.update(principal)
							.set(setValues)
							.where(and(eq(principal.id, id), isNull(principal.deletedAt)))
							.returning()
							.then((rows) => {
								const row = rows[0];
								if (!row) {
									throw new Error(
										`Principal not found for property update: ${id}`,
									);
								}
								return row;
							}),
					catch: (e) => new DatabaseError({ cause: e }),
				});
			},
			Effect.tapError((e: DatabaseError) =>
				Effect.logWarning("repo.principal.updateProperties failed", e.cause),
			),
		);

		return PrincipalRepository.of({
			findById,
			findBySlug,
			findPrincipalBySlug,
			findByEmail,
			findUserByUserId,
			updateProperties,
		});
	}),
);
