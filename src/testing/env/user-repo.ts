import { Effect, Option } from "effect";
import { Temporal } from "temporal-polyfill";
import type {
	PrincipalRow,
	PrincipalWithUser,
} from "#src/services/principal/repository.ts";
import type {
	AuthUserRow,
	UserRepositoryShape,
	UserRow,
} from "#src/services/user/repository.ts";
import {
	findLivePrincipalBySlug,
	findUserRowByEmail,
	withPrincipal,
	withUser,
} from "./rows.ts";
import { allCredentials, allUsers, type TestStores } from "./stores.ts";

// ---------------------------------------------------------------------------
// In-memory UserRepository
// ---------------------------------------------------------------------------

/** Every user whose principal is still live, in insertion order */
const listLiveUsers = (stores: TestStores): ReadonlyArray<PrincipalWithUser> =>
	allUsers(stores).flatMap((user) => {
		const principal = stores.principals.get(user.principalId);
		return principal && principal.deletedAt === null
			? [{ principal, user }]
			: [];
	});

export const makeUserRepo = (stores: TestStores): UserRepositoryShape => ({
	findById: (id) => Effect.succeed(withPrincipal(stores, stores.users.get(id))),

	findByEmail: (email) =>
		Effect.succeed(withPrincipal(stores, findUserRowByEmail(stores, email))),

	create: (input) =>
		Effect.sync(() => {
			const principalId = crypto.randomUUID();
			const userId = crypto.randomUUID();
			const now = Temporal.Now.instant();

			const principalRow: PrincipalRow = {
				id: principalId,
				principalType: "user",
				displayName: input.displayName ?? null,
				updatedAt: now,
				deletedAt: null,
				slug: input.slug,
				clientProperties: {},
			};
			const userRow: UserRow = {
				id: userId,
				email: input.email,
				role: input.role ?? "normal",
				updatedAt: now,
				principalId,
			};

			stores.principals.set(principalId, principalRow);
			stores.users.set(userId, userRow);

			for (const cred of input.credentials) {
				const credRow: AuthUserRow = {
					id: crypto.randomUUID(),
					userId,
					authSource: cred.authSource,
					authId: cred.authId,
					label: null,
					updatedAt: now,
					lastUsedAt: null,
					authCredential: Option.getOrNull(cred.authCredential),
				};
				stores.credentials.set(`${cred.authSource}:${cred.authId}`, credRow);
			}

			return { user: userRow, principal: principalRow };
		}),

	update: (id, input) =>
		Effect.sync(() => {
			const existingUser = stores.users.get(id);
			if (!existingUser) {
				throw new Error(`[TestEnv] User not found: ${id}`);
			}
			const existingPrincipal = stores.principals.get(existingUser.principalId);
			if (!existingPrincipal) {
				throw new Error(
					`[TestEnv] Principal not found: ${existingUser.principalId}`,
				);
			}

			const now = Temporal.Now.instant();
			const updatedUser: UserRow = {
				...existingUser,
				email: input.email ?? existingUser.email,
				updatedAt: now,
			};
			const updatedPrincipal: PrincipalRow = {
				...existingPrincipal,
				displayName:
					input.displayName !== undefined
						? input.displayName
						: existingPrincipal.displayName,
				updatedAt: now,
			};

			stores.users.set(id, updatedUser);
			stores.principals.set(existingUser.principalId, updatedPrincipal);

			return { user: updatedUser, principal: updatedPrincipal };
		}),

	findCredential: (authSource, authId) =>
		Effect.succeed(
			Option.fromNullishOr(stores.credentials.get(`${authSource}:${authId}`)),
		),

	listAuthSources: (userId) =>
		Effect.succeed([
			...new Set(
				allCredentials(stores)
					.filter((c) => c.userId === userId)
					.map((c) => c.authSource),
			),
		]),

	insertCredential: (input) =>
		Effect.sync(() => {
			const now = Temporal.Now.instant();
			const credRow: AuthUserRow = {
				id: crypto.randomUUID(),
				userId: input.userId,
				authSource: input.authSource,
				authId: input.authId,
				label: null,
				updatedAt: now,
				lastUsedAt: null,
				authCredential: Option.getOrNull(input.authCredential),
			};
			stores.credentials.set(`${input.authSource}:${input.authId}`, credRow);
			return credRow;
		}),

	deleteCredential: (_userId, authSource, authId) =>
		Effect.sync(() => {
			stores.credentials.delete(`${authSource}:${authId}`);
		}),

	findBySlug: (slug) =>
		Effect.succeed(withUser(stores, findLivePrincipalBySlug(stores, slug))),

	list: () => Effect.succeed(listLiveUsers(stores)),

	softDelete: (id) =>
		Effect.sync(() => {
			const userRow = stores.users.get(id);
			if (!userRow) {
				return;
			}
			const principal = stores.principals.get(userRow.principalId);
			if (!principal) {
				return;
			}
			stores.principals.set(userRow.principalId, {
				...principal,
				deletedAt: Temporal.Now.instant(),
			});
		}),
});
