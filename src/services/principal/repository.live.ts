import { and, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import { DatabaseClient } from "#src/db/client.ts";
import { principal, user } from "#src/db/drizzle/schema/index.ts";
import { getActiveDb } from "#src/db/transaction.ts";
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
				yield* Effect.annotateCurrentSpan({ "principal.id": id });
				yield* Effect.logTrace("repo.principal.findById", { id });
				const activeDb = yield* getActiveDb(db);
				return yield* Effect.tryPromise({
					try: () =>
						activeDb
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
				yield* Effect.annotateCurrentSpan({ "principal.slug": slug });
				yield* Effect.logTrace("repo.principal.findBySlug", { slug });
				const activeDb = yield* getActiveDb(db);
				return yield* Effect.tryPromise({
					try: () =>
						activeDb
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
				yield* Effect.annotateCurrentSpan({ "principal.slug": slug });
				yield* Effect.logTrace("repo.principal.findPrincipalBySlug", { slug });
				const activeDb = yield* getActiveDb(db);
				return yield* Effect.tryPromise({
					try: () =>
						activeDb
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
				const activeDb = yield* getActiveDb(db);
				return yield* Effect.tryPromise({
					try: () =>
						activeDb
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
				yield* Effect.annotateCurrentSpan({ "user.id": id });
				yield* Effect.logTrace("repo.principal.findUserByUserId", { id });
				const activeDb = yield* getActiveDb(db);
				return yield* Effect.tryPromise({
					try: () =>
						activeDb
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
				yield* Effect.annotateCurrentSpan({ "principal.id": id });
				yield* Effect.logTrace("repo.principal.updateProperties", { id });
				const setValues: Record<string, unknown> = {
					clientProperties: changes.clientProperties,
					updatedAt: sql`now()`,
				};
				if (changes.displayName !== undefined) {
					setValues.displayName = changes.displayName;
				}
				const activeDb = yield* getActiveDb(db);
				return yield* Effect.tryPromise({
					try: () =>
						activeDb
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

		const listAll = Effect.fn("PrincipalRepository.listAll")(
			function* () {
				yield* Effect.logTrace("repo.principal.listAll");
				const activeDb = yield* getActiveDb(db);
				return yield* Effect.tryPromise({
					try: () =>
						activeDb
							.select()
							.from(principal)
							.innerJoin(user, eq(user.principalId, principal.id))
							.where(isNull(principal.deletedAt))
							.then((rows) =>
								rows.map((r) => ({ principal: r.principal, user: r.user })),
							),
					catch: (e) => new DatabaseError({ cause: e }),
				});
			},
			Effect.tapError((e: DatabaseError) =>
				Effect.logWarning("repo.principal.listAll failed", e.cause),
			),
		);

		const searchByDisplayName = Effect.fn(
			"PrincipalRepository.searchByDisplayName",
		)(
			function* (query: string) {
				yield* Effect.annotateCurrentSpan({ "search.query_len": query.length });
				yield* Effect.logTrace("repo.principal.searchByDisplayName", { query });
				const pattern = `%${query}%`;
				const activeDb = yield* getActiveDb(db);
				return yield* Effect.tryPromise({
					try: () =>
						activeDb
							.select()
							.from(principal)
							.innerJoin(user, eq(user.principalId, principal.id))
							.where(
								and(
									isNull(principal.deletedAt),
									or(
										ilike(principal.displayName, pattern),
										ilike(user.email, pattern),
									),
								),
							)
							.then((rows) =>
								rows.map((r) => ({ principal: r.principal, user: r.user })),
							),
					catch: (e) => new DatabaseError({ cause: e }),
				});
			},
			Effect.tapError((e: DatabaseError) =>
				Effect.logWarning("repo.principal.searchByDisplayName failed", e.cause),
			),
		);

		return PrincipalRepository.of({
			findById,
			findBySlug,
			findPrincipalBySlug,
			findByEmail,
			findUserByUserId,
			updateProperties,
			listAll,
			searchByDisplayName,
		});
	}),
);
