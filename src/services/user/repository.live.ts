import { and, eq, isNull, sql } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import { DatabaseClient } from "#src/db/client.ts";
import { authUser, principal, user } from "#src/db/drizzle/schema/index.ts";
import { runDbQuery } from "#src/db/query.ts";
import {
	ConflictError,
	DatabaseError,
	isPgUniqueViolation,
} from "#src/domain/errors.ts";
import type { UserId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import type { Email } from "#src/domain/types/strings.ts";
import {
	type AuthUserRow,
	type HashedCredential,
	UserRepository,
	type UserWithPrincipal,
} from "./repository.ts";

// ---------------------------------------------------------------------------
// UserRepository — Drizzle implementation
// ---------------------------------------------------------------------------

const findById = Effect.fn("UserRepository.findById")(
	function* (id: UserId) {
		yield* Effect.annotateCurrentSpan({ "user.id": id });
		yield* Effect.logTrace("repo.user.findById", { id });
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(user)
				.innerJoin(principal, eq(principal.id, user.principalId))
				.where(and(eq(user.id, id), isNull(principal.deletedAt)))
				.limit(1),
		).pipe(
			Effect.map((r) =>
				Option.fromNullable(
					r[0] ? { principal: r[0].principal, user: r[0].user } : null,
				),
			),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.user.findById failed", e.cause),
	),
);

const findByEmail = Effect.fn("UserRepository.findByEmail")(
	function* (email: Email) {
		yield* Effect.logTrace("repo.user.findByEmail");
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
	Effect.tapError((e) =>
		Effect.logWarning("repo.user.findByEmail failed", e.cause),
	),
);

const create = Effect.fn("UserRepository.create")(
	function* (input: {
		readonly slug: Slug;
		readonly email: Email;
		readonly displayName?: string;
		readonly credentials: ReadonlyArray<HashedCredential>;
	}) {
		yield* Effect.annotateCurrentSpan({ "user.slug": input.slug });
		yield* Effect.logTrace("repo.user.create", { slug: input.slug });

		const principalRows = yield* runDbQuery((db) =>
			db
				.insert(principal)
				.values({
					principalType: "user",
					slug: input.slug,
					displayName: input.displayName,
				})
				.returning(),
		).pipe(
			Effect.mapError((e) =>
				isPgUniqueViolation(e.cause)
					? new ConflictError({
							field: "slug_or_email",
							message: "User with this slug or email already exists",
						})
					: e,
			),
		);
		const principalRow = principalRows[0];
		if (!principalRow) {
			return yield* Effect.fail(
				new DatabaseError({
					cause: new Error("principal insert returned no rows"),
				}),
			);
		}

		const userRows = yield* runDbQuery((db) =>
			db
				.insert(user)
				.values({ email: input.email, principalId: principalRow.id })
				.returning(),
		).pipe(
			Effect.mapError((e) =>
				isPgUniqueViolation(e.cause)
					? new ConflictError({
							field: "slug_or_email",
							message: "User with this slug or email already exists",
						})
					: e,
			),
		);
		const userRow = userRows[0];
		if (!userRow) {
			return yield* Effect.fail(
				new DatabaseError({ cause: new Error("user insert returned no rows") }),
			);
		}

		for (const cred of input.credentials) {
			yield* runDbQuery((db) =>
				db.insert(authUser).values({
					userId: userRow.id,
					authSource: cred.authSource,
					authId: cred.authId,
					authCredential: Option.getOrNull(cred.authCredential),
				}),
			).pipe(Effect.asVoid);
		}

		return {
			principal: principalRow,
			user: userRow,
		} satisfies UserWithPrincipal;
	},
	Effect.tapError((e) => Effect.logWarning("repo.user.create failed", e.cause)),
);

const update = Effect.fn("UserRepository.update")(
	function* (
		id: UserId,
		input: {
			readonly email?: Email;
			readonly displayName?: string;
		},
	) {
		yield* Effect.annotateCurrentSpan({ "user.id": id });
		yield* Effect.logTrace("repo.user.update", { id });

		if (input.displayName !== undefined) {
			const displayName = input.displayName;
			yield* runDbQuery((db) =>
				db
					.update(principal)
					.set({ displayName, updatedAt: sql`now()` })
					.from(user)
					.where(and(eq(user.id, id), eq(principal.id, user.principalId))),
			).pipe(Effect.asVoid);
		}
		if (input.email !== undefined) {
			const email = input.email;
			yield* runDbQuery((db) =>
				db
					.update(user)
					.set({ email, updatedAt: sql`now()` })
					.where(eq(user.id, id)),
			).pipe(Effect.asVoid);
		}

		const rows = yield* runDbQuery((db) =>
			db
				.select()
				.from(user)
				.innerJoin(principal, eq(principal.id, user.principalId))
				.where(and(eq(user.id, id), isNull(principal.deletedAt)))
				.limit(1),
		);
		const row = rows[0];
		if (!row) {
			return yield* Effect.fail(
				new DatabaseError({
					cause: new Error(`User not found after update: ${id}`),
				}),
			);
		}
		return { principal: row.principal, user: row.user } satisfies UserWithPrincipal;
	},
	Effect.tapError((e) => Effect.logWarning("repo.user.update failed", e.cause)),
);

const findCredential = Effect.fn("UserRepository.findCredential")(
	function* (authSource: string, authId: string) {
		yield* Effect.annotateCurrentSpan({ "credential.source": authSource });
		yield* Effect.logTrace("repo.user.findCredential", { authSource });
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(authUser)
				.where(
					and(
						eq(authUser.authSource, authSource),
						eq(authUser.authId, authId),
					),
				)
				.limit(1),
		).pipe(
			Effect.map((r) => Option.fromNullable(r[0] as AuthUserRow | undefined)),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.user.findCredential failed", e.cause),
	),
);

const insertCredential = Effect.fn("UserRepository.insertCredential")(
	function* (input: HashedCredential & { readonly userId: UserId }) {
		yield* Effect.annotateCurrentSpan({
			"user.id": input.userId,
			"credential.source": input.authSource,
		});
		yield* Effect.logTrace("repo.user.insertCredential", {
			authSource: input.authSource,
		});
		return yield* runDbQuery((db) =>
			db
				.insert(authUser)
				.values({
					userId: input.userId,
					authSource: input.authSource,
					authId: input.authId,
					authCredential: Option.getOrNull(input.authCredential),
				})
				.returning(),
		).pipe(
			Effect.flatMap((r) => {
				const row = r[0];
				if (!row) {
					return Effect.fail(
						new DatabaseError({
							cause: new Error("auth_user insert returned no rows"),
						}),
					);
				}
				return Effect.succeed(row);
			}),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.user.insertCredential failed", e.cause),
	),
);

const findBySlug = Effect.fn("UserRepository.findBySlug")(
	function* (slug: Slug) {
		yield* Effect.annotateCurrentSpan({ "user.slug": slug });
		yield* Effect.logTrace("repo.user.findBySlug", { slug });
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(user)
				.innerJoin(principal, eq(principal.id, user.principalId))
				.where(
					and(
						eq(principal.slug, slug),
						eq(principal.principalType, "user"),
						isNull(principal.deletedAt),
					),
				)
				.limit(1),
		).pipe(
			Effect.map((r) =>
				Option.fromNullable(
					r[0] ? { principal: r[0].principal, user: r[0].user } : null,
				),
			),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.user.findBySlug failed", e.cause),
	),
);

const list = Effect.fn("UserRepository.list")(
	function* () {
		yield* Effect.logTrace("repo.user.list");
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(user)
				.innerJoin(principal, eq(principal.id, user.principalId))
				.where(isNull(principal.deletedAt))
				.orderBy(principal.slug),
		).pipe(
			Effect.map((rows) =>
				rows.map((r) => ({ principal: r.principal, user: r.user })),
			),
		);
	},
	Effect.tapError((e) => Effect.logWarning("repo.user.list failed", e.cause)),
);

const softDelete = Effect.fn("UserRepository.softDelete")(
	function* (id: UserId) {
		yield* Effect.annotateCurrentSpan({ "user.id": id });
		yield* Effect.logTrace("repo.user.softDelete", { id });
		return yield* runDbQuery((db) =>
			db
				.update(principal)
				.set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
				.from(user)
				.where(and(eq(user.id, id), eq(principal.id, user.principalId))),
		).pipe(Effect.asVoid);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.user.softDelete failed", e.cause),
	),
);

const deleteCredential = Effect.fn("UserRepository.deleteCredential")(
	function* (userId: UserId, authSource: string, authId: string) {
		yield* Effect.annotateCurrentSpan({
			"user.id": userId,
			"credential.source": authSource,
		});
		yield* Effect.logTrace("repo.user.deleteCredential", {
			userId,
			authSource,
		});
		return yield* runDbQuery((db) =>
			db
				.delete(authUser)
				.where(
					and(
						eq(authUser.userId, userId),
						eq(authUser.authSource, authSource),
						eq(authUser.authId, authId),
					),
				),
		).pipe(Effect.asVoid);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.user.deleteCredential failed", e.cause),
	),
);

export const UserRepositoryLive = Layer.effect(
	UserRepository,
	Effect.gen(function* () {
		const dc = yield* DatabaseClient;
		const run = <A, E>(e: Effect.Effect<A, E, DatabaseClient>): Effect.Effect<A, E> =>
			Effect.provideService(e, DatabaseClient, dc);
		return UserRepository.of({
			findById: (...args: Parameters<typeof findById>) => run(findById(...args)),
			findBySlug: (...args: Parameters<typeof findBySlug>) => run(findBySlug(...args)),
			findByEmail: (...args: Parameters<typeof findByEmail>) =>
				run(findByEmail(...args)),
			list: (...args: Parameters<typeof list>) => run(list(...args)),
			softDelete: (...args: Parameters<typeof softDelete>) => run(softDelete(...args)),
			create: (...args: Parameters<typeof create>) => run(create(...args)),
			update: (...args: Parameters<typeof update>) => run(update(...args)),
			findCredential: (...args: Parameters<typeof findCredential>) =>
				run(findCredential(...args)),
			insertCredential: (...args: Parameters<typeof insertCredential>) =>
				run(insertCredential(...args)),
			deleteCredential: (...args: Parameters<typeof deleteCredential>) =>
				run(deleteCredential(...args)),
		});
	}),
);
