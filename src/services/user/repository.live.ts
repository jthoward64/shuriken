import { and, eq, isNull, sql } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
import { authUser, principal, user } from "#src/db/drizzle/schema/index.ts";
import { DatabaseError } from "#src/domain/errors.ts";
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

const findById = (db: DbClient, id: UserId) =>
	Effect.tryPromise({
		try: () =>
			db
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

const findByEmail = (db: DbClient, email: Email) =>
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

const create = (
	db: DbClient,
	input: {
		readonly slug: Slug;
		readonly name: string;
		readonly email: Email;
		readonly displayName?: string;
		readonly credentials: ReadonlyArray<HashedCredential>;
	},
) =>
	Effect.tryPromise({
		try: () =>
			db.transaction(async (tx) => {
				const principalRows = await tx
					.insert(principal)
					.values({
						principalType: "user",
						slug: input.slug,
						displayName: input.displayName,
					})
					.returning();
				const principalRow = principalRows[0];
				if (!principalRow) {
					throw new Error("principal insert returned no rows");
				}

				const userRows = await tx
					.insert(user)
					.values({
						name: input.name,
						email: input.email,
						principalId: principalRow.id,
					})
					.returning();
				const userRow = userRows[0];
				if (!userRow) {
					throw new Error("user insert returned no rows");
				}

				for (const cred of input.credentials) {
					await tx.insert(authUser).values({
						userId: userRow.id,
						authSource: cred.authSource,
						authId: cred.authId,
						authCredential: Option.getOrNull(cred.authCredential),
					});
				}

				return {
					principal: principalRow,
					user: userRow,
				} satisfies UserWithPrincipal;
			}),
		catch: (e) => new DatabaseError({ cause: e }),
	});

const update = (
	db: DbClient,
	id: UserId,
	input: {
		readonly name?: string;
		readonly email?: Email;
		readonly displayName?: string;
	},
) =>
	Effect.tryPromise({
		try: async () => {
			if (input.displayName !== undefined) {
				await db
					.update(principal)
					.set({ displayName: input.displayName, updatedAt: sql`now()` })
					.from(user)
					.where(and(eq(user.id, id), eq(principal.id, user.principalId)));
			}
			if (input.name !== undefined || input.email !== undefined) {
				const userPatch: { name?: string; email?: Email } = {};
				if (input.name !== undefined) {
					userPatch.name = input.name;
				}
				if (input.email !== undefined) {
					userPatch.email = input.email;
				}
				await db
					.update(user)
					.set({ ...userPatch, updatedAt: sql`now()` })
					.where(eq(user.id, id));
			}

			const rows = await db
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

const findCredential = (db: DbClient, authSource: string, authId: string) =>
	Effect.tryPromise({
		try: () =>
			db
				.select()
				.from(authUser)
				.where(
					and(eq(authUser.authSource, authSource), eq(authUser.authId, authId)),
				)
				.limit(1)
				.then((r) => Option.fromNullable(r[0] as AuthUserRow | undefined)),
		catch: (e) => new DatabaseError({ cause: e }),
	});

const insertCredential = (
	db: DbClient,
	input: HashedCredential & { readonly userId: UserId },
) =>
	Effect.tryPromise({
		try: () =>
			db
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

const deleteCredential = (
	db: DbClient,
	userId: UserId,
	authSource: string,
	authId: string,
) =>
	Effect.tryPromise({
		try: () =>
			db
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

export const UserRepositoryLive = Layer.effect(
	UserRepository,
	Effect.map(DatabaseClient, (db) =>
		UserRepository.of({
			findById: (id) => findById(db, id),
			findByEmail: (email) => findByEmail(db, email),
			create: (input) => create(db, input),
			update: (id, input) => update(db, id, input),
			findCredential: (source, authId) => findCredential(db, source, authId),
			insertCredential: (input) => insertCredential(db, input),
			deleteCredential: (userId, source, authId) =>
				deleteCredential(db, userId, source, authId),
		}),
	),
);
