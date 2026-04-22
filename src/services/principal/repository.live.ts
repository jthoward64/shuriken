import { and, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import { DatabaseClient } from "#src/db/client.ts";
import { principal, user } from "#src/db/drizzle/schema/index.ts";
import { runDbQuery } from "#src/db/query.ts";
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

const findById = Effect.fn("PrincipalRepository.findById")(
	function* (id: PrincipalId) {
		yield* Effect.annotateCurrentSpan({ "principal.id": id });
		yield* Effect.logTrace("repo.principal.findById", { id });
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(principal)
				.innerJoin(user, eq(user.principalId, principal.id))
				.where(and(eq(principal.id, id), isNull(principal.deletedAt)))
				.limit(1),
		).pipe(
			Effect.map((r) =>
				Option.fromNullable(
					r[0] ? { principal: r[0].principal, user: r[0].user } : null,
				),
			),
		);
	},
	Effect.tapError((e: DatabaseError) =>
		Effect.logWarning("repo.principal.findById failed", e.cause),
	),
);

const findBySlug = Effect.fn("PrincipalRepository.findBySlug")(
	function* (slug: Slug) {
		yield* Effect.annotateCurrentSpan({ "principal.slug": slug });
		yield* Effect.logTrace("repo.principal.findBySlug", { slug });
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(principal)
				.innerJoin(user, eq(user.principalId, principal.id))
				.where(and(eq(principal.slug, slug), isNull(principal.deletedAt)))
				.limit(1),
		).pipe(
			Effect.map((r) =>
				Option.fromNullable(
					r[0] ? { principal: r[0].principal, user: r[0].user } : null,
				),
			),
		);
	},
	Effect.tapError((e: DatabaseError) =>
		Effect.logWarning("repo.principal.findBySlug failed", e.cause),
	),
);

const findPrincipalById = Effect.fn("PrincipalRepository.findPrincipalById")(
	function* (id: PrincipalId) {
		yield* Effect.annotateCurrentSpan({ "principal.id": id });
		yield* Effect.logTrace("repo.principal.findPrincipalById", { id });
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(principal)
				.where(and(eq(principal.id, id), isNull(principal.deletedAt)))
				.limit(1),
		).pipe(Effect.map((r) => Option.fromNullable(r[0] ?? null)));
	},
	Effect.tapError((e: DatabaseError) =>
		Effect.logWarning("repo.principal.findPrincipalById failed", e.cause),
	),
);

const findPrincipalBySlug = Effect.fn(
	"PrincipalRepository.findPrincipalBySlug",
)(
	function* (slug: Slug) {
		yield* Effect.annotateCurrentSpan({ "principal.slug": slug });
		yield* Effect.logTrace("repo.principal.findPrincipalBySlug", { slug });
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(principal)
				.where(and(eq(principal.slug, slug), isNull(principal.deletedAt)))
				.limit(1),
		).pipe(Effect.map((r) => Option.fromNullable(r[0] ?? null)));
	},
	Effect.tapError((e: DatabaseError) =>
		Effect.logWarning("repo.principal.findPrincipalBySlug failed", e.cause),
	),
);

const findByEmail = Effect.fn("PrincipalRepository.findByEmail")(
	function* (email: Email) {
		yield* Effect.logTrace("repo.principal.findByEmail");
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(user)
				.innerJoin(principal, eq(principal.id, user.principalId))
				.where(and(eq(user.email, email), isNull(principal.deletedAt)))
				.limit(1),
		).pipe(
			Effect.map((r) =>
				Option.fromNullable(
					r[0] ? { principal: r[0].principal, user: r[0].user } : null,
				),
			),
		);
	},
	Effect.tapError((e: DatabaseError) =>
		Effect.logWarning("repo.principal.findByEmail failed", e.cause),
	),
);

const findUserByUserId = Effect.fn("PrincipalRepository.findUserByUserId")(
	function* (id: UserId) {
		yield* Effect.annotateCurrentSpan({ "user.id": id });
		yield* Effect.logTrace("repo.principal.findUserByUserId", { id });
		return yield* runDbQuery((db) =>
			db.select().from(user).where(eq(user.id, id)).limit(1),
		).pipe(Effect.map((r) => Option.fromNullable(r[0] as UserRow | undefined)));
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
		if (changes.slug !== undefined) {
			setValues.slug = changes.slug;
		}
		return yield* runDbQuery((db) =>
			db
				.update(principal)
				.set(setValues)
				.where(and(eq(principal.id, id), isNull(principal.deletedAt)))
				.returning(),
		).pipe(
			Effect.flatMap((rows) => {
				const row = rows[0];
				if (!row) {
					return Effect.fail(
						new DatabaseError({
							cause: new Error(
								`Principal not found for property update: ${id}`,
							),
						}),
					);
				}
				return Effect.succeed(row);
			}),
		);
	},
	Effect.tapError((e: DatabaseError) =>
		Effect.logWarning("repo.principal.updateProperties failed", e.cause),
	),
);

const listAll = Effect.fn("PrincipalRepository.listAll")(
	function* () {
		yield* Effect.logTrace("repo.principal.listAll");
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(principal)
				.innerJoin(user, eq(user.principalId, principal.id))
				.where(isNull(principal.deletedAt)),
		).pipe(
			Effect.map((rows) =>
				rows.map((r) => ({ principal: r.principal, user: r.user })),
			),
		);
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
		return yield* runDbQuery((db) =>
			db
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
				),
		).pipe(
			Effect.map((rows) =>
				rows.map((r) => ({ principal: r.principal, user: r.user })),
			),
		);
	},
	Effect.tapError((e: DatabaseError) =>
		Effect.logWarning("repo.principal.searchByDisplayName failed", e.cause),
	),
);

export const PrincipalRepositoryLive = Layer.effect(
	PrincipalRepository,
	Effect.gen(function* () {
		const dc = yield* DatabaseClient;
		const run = <A, E>(
			e: Effect.Effect<A, E, DatabaseClient>,
		): Effect.Effect<A, E> => Effect.provideService(e, DatabaseClient, dc);
		return PrincipalRepository.of({
			findById: (...args: Parameters<typeof findById>) =>
				run(findById(...args)),
			findPrincipalById: (...args: Parameters<typeof findPrincipalById>) =>
				run(findPrincipalById(...args)),
			findBySlug: (...args: Parameters<typeof findBySlug>) =>
				run(findBySlug(...args)),
			findPrincipalBySlug: (...args: Parameters<typeof findPrincipalBySlug>) =>
				run(findPrincipalBySlug(...args)),
			findByEmail: (...args: Parameters<typeof findByEmail>) =>
				run(findByEmail(...args)),
			findUserByUserId: (...args: Parameters<typeof findUserByUserId>) =>
				run(findUserByUserId(...args)),
			updateProperties: (...args: Parameters<typeof updateProperties>) =>
				run(updateProperties(...args)),
			listAll: (...args: Parameters<typeof listAll>) => run(listAll(...args)),
			searchByDisplayName: (...args: Parameters<typeof searchByDisplayName>) =>
				run(searchByDisplayName(...args)),
		});
	}),
);
