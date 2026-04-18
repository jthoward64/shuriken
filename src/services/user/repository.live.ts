import { and, eq, isNull, sql } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
import { authUser, principal, user } from "#src/db/drizzle/schema/index.ts";
import { getActiveDb } from "#src/db/transaction.ts";
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
	function* (db: DbClient, id: UserId) {
		yield* Effect.annotateCurrentSpan({ "user.id": id });
		yield* Effect.logTrace("repo.user.findById", { id });
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb
					.select()
					.from(user)
					.innerJoin(principal, eq(principal.id, user.principalId))
					.where(and(eq(user.id, id), isNull(principal.deletedAt)))
					.limit(1)
					.then((r) =>
						Option.fromNullable(
							r[0] ? { principal: r[0].principal, user: r[0].user } : null,
						),
					),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.user.findById failed", e.cause),
	),
);

const findByEmail = Effect.fn("UserRepository.findByEmail")(
	function* (db: DbClient, email: Email) {
		yield* Effect.logTrace("repo.user.findByEmail");
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
	Effect.tapError((e) =>
		Effect.logWarning("repo.user.findByEmail failed", e.cause),
	),
);

const create = Effect.fn("UserRepository.create")(
	function* (
		db: DbClient,
		input: {
			readonly slug: Slug;
			readonly email: Email;
			readonly displayName?: string;
			readonly credentials: ReadonlyArray<HashedCredential>;
		},
	) {
		yield* Effect.annotateCurrentSpan({ "user.slug": input.slug });
		yield* Effect.logTrace("repo.user.create", { slug: input.slug });
		const activeDb = yield* getActiveDb(db);

		const principalRows = yield* Effect.tryPromise<
			ReadonlyArray<typeof principal.$inferSelect>,
			DatabaseError | ConflictError
		>({
			try: () =>
				activeDb
					.insert(principal)
					.values({
						principalType: "user",
						slug: input.slug,
						displayName: input.displayName,
					})
					.returning(),
			catch: (e) =>
				isPgUniqueViolation(e)
					? new ConflictError({
							field: "slug_or_email",
							message: "User with this slug or email already exists",
						})
					: new DatabaseError({ cause: e }),
		});
		const principalRow = principalRows[0];
		if (!principalRow) {
			return yield* Effect.fail(
				new DatabaseError({ cause: new Error("principal insert returned no rows") }),
			);
		}

		const userRows = yield* Effect.tryPromise<
			ReadonlyArray<typeof user.$inferSelect>,
			DatabaseError | ConflictError
		>({
			try: () =>
				activeDb
					.insert(user)
					.values({
						email: input.email,
						principalId: principalRow.id,
					})
					.returning(),
			catch: (e) =>
				isPgUniqueViolation(e)
					? new ConflictError({
							field: "slug_or_email",
							message: "User with this slug or email already exists",
						})
					: new DatabaseError({ cause: e }),
		});
		const userRow = userRows[0];
		if (!userRow) {
			return yield* Effect.fail(
				new DatabaseError({ cause: new Error("user insert returned no rows") }),
			);
		}

		for (const cred of input.credentials) {
			yield* Effect.tryPromise({
				try: () =>
					activeDb.insert(authUser).values({
						userId: userRow.id,
						authSource: cred.authSource,
						authId: cred.authId,
						authCredential: Option.getOrNull(cred.authCredential),
					}),
				catch: (e) => new DatabaseError({ cause: e }),
			});
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
		db: DbClient,
		id: UserId,
		input: {
			readonly email?: Email;
			readonly displayName?: string;
		},
	) {
		yield* Effect.annotateCurrentSpan({ "user.id": id });
		yield* Effect.logTrace("repo.user.update", { id });
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: async () => {
				if (input.displayName !== undefined) {
					await activeDb
						.update(principal)
						.set({ displayName: input.displayName, updatedAt: sql`now()` })
						.from(user)
						.where(and(eq(user.id, id), eq(principal.id, user.principalId)));
				}
				if (input.email !== undefined) {
					const userPatch: { email?: Email } = {};
					if (input.email !== undefined) {
						userPatch.email = input.email;
					}
					await activeDb
						.update(user)
						.set({ ...userPatch, updatedAt: sql`now()` })
						.where(eq(user.id, id));
				}

				const rows = await activeDb
					.select()
					.from(user)
					.innerJoin(principal, eq(principal.id, user.principalId))
					.where(and(eq(user.id, id), isNull(principal.deletedAt)))
					.limit(1);

				const row = rows[0];
				if (!row) {
					throw new Error(`User not found after update: ${id}`);
				}
				return {
					principal: row.principal,
					user: row.user,
				} satisfies UserWithPrincipal;
			},
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) => Effect.logWarning("repo.user.update failed", e.cause)),
);

const findCredential = Effect.fn("UserRepository.findCredential")(
	function* (db: DbClient, authSource: string, authId: string) {
		yield* Effect.annotateCurrentSpan({ "credential.source": authSource });
		yield* Effect.logTrace("repo.user.findCredential", { authSource });
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb
					.select()
					.from(authUser)
					.where(
						and(
							eq(authUser.authSource, authSource),
							eq(authUser.authId, authId),
						),
					)
					.limit(1)
					.then((r) => Option.fromNullable(r[0] as AuthUserRow | undefined)),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.user.findCredential failed", e.cause),
	),
);

const insertCredential = Effect.fn("UserRepository.insertCredential")(
	function* (
		db: DbClient,
		input: HashedCredential & { readonly userId: UserId },
	) {
		yield* Effect.annotateCurrentSpan({
			"user.id": input.userId,
			"credential.source": input.authSource,
		});
		yield* Effect.logTrace("repo.user.insertCredential", {
			authSource: input.authSource,
		});
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb
					.insert(authUser)
					.values({
						userId: input.userId,
						authSource: input.authSource,
						authId: input.authId,
						authCredential: Option.getOrNull(input.authCredential),
					})
					.returning()
					.then((r) => {
						const row = r[0];
						if (!row) {
							throw new Error("auth_user insert returned no rows");
						}
						return row;
					}),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.user.insertCredential failed", e.cause),
	),
);

const findBySlug = Effect.fn("UserRepository.findBySlug")(
	function* (db: DbClient, slug: Slug) {
		yield* Effect.annotateCurrentSpan({ "user.slug": slug });
		yield* Effect.logTrace("repo.user.findBySlug", { slug });
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb
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
					.limit(1)
					.then((r) =>
						Option.fromNullable(
							r[0] ? { principal: r[0].principal, user: r[0].user } : null,
						),
					),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.user.findBySlug failed", e.cause),
	),
);

const list = Effect.fn("UserRepository.list")(
	function* (db: DbClient) {
		yield* Effect.logTrace("repo.user.list");
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb
					.select()
					.from(user)
					.innerJoin(principal, eq(principal.id, user.principalId))
					.where(isNull(principal.deletedAt))
					.orderBy(principal.slug)
					.then((rows) =>
						rows.map((r) => ({ principal: r.principal, user: r.user })),
					),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) => Effect.logWarning("repo.user.list failed", e.cause)),
);

const softDelete = Effect.fn("UserRepository.softDelete")(
	function* (db: DbClient, id: UserId) {
		yield* Effect.annotateCurrentSpan({ "user.id": id });
		yield* Effect.logTrace("repo.user.softDelete", { id });
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb
					.update(principal)
					.set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
					.from(user)
					.where(and(eq(user.id, id), eq(principal.id, user.principalId)))
					.then(() => undefined),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.user.softDelete failed", e.cause),
	),
);

const deleteCredential = Effect.fn("UserRepository.deleteCredential")(
	function* (db: DbClient, userId: UserId, authSource: string, authId: string) {
		yield* Effect.annotateCurrentSpan({
			"user.id": userId,
			"credential.source": authSource,
		});
		yield* Effect.logTrace("repo.user.deleteCredential", {
			userId,
			authSource,
		});
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb
					.delete(authUser)
					.where(
						and(
							eq(authUser.userId, userId),
							eq(authUser.authSource, authSource),
							eq(authUser.authId, authId),
						),
					)
					.then(() => undefined),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.user.deleteCredential failed", e.cause),
	),
);

export const UserRepositoryLive = Layer.effect(
	UserRepository,
	Effect.map(DatabaseClient, (db) =>
		UserRepository.of({
			findById: (id) => findById(db, id),
			findBySlug: (slug) => findBySlug(db, slug),
			findByEmail: (email) => findByEmail(db, email),
			list: () => list(db),
			softDelete: (id) => softDelete(db, id),
			create: (input) => create(db, input),
			update: (id, input) => update(db, id, input),
			findCredential: (source, authId) => findCredential(db, source, authId),
			insertCredential: (input) => insertCredential(db, input),
			deleteCredential: (userId, source, authId) =>
				deleteCredential(db, userId, source, authId),
		}),
	),
);
