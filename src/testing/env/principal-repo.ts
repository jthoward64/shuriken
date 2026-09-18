import { Effect, Option } from "effect";
import { Temporal } from "temporal-polyfill";
import type { PrincipalId } from "#src/domain/ids.ts";
import type {
	PrincipalPropertyChanges,
	PrincipalRepositoryShape,
	PrincipalRow,
	PrincipalWithUser,
} from "#src/services/principal/repository.ts";
import {
	findLivePrincipalBySlug,
	findUserRowByEmail,
	livePrincipalsWithUsers,
	withPrincipal,
	withUser,
} from "./rows.ts";
import type { TestStores } from "./stores.ts";

// ---------------------------------------------------------------------------
// In-memory PrincipalRepository
// ---------------------------------------------------------------------------

// Case-insensitive substring match on display name (falling back to slug) or email
const matchesQuery = (row: PrincipalWithUser, lowerQuery: string): boolean =>
	(row.principal.displayName ?? row.principal.slug)
		.toLowerCase()
		.includes(lowerQuery) || row.user.email.toLowerCase().includes(lowerQuery);

export const makePrincipalRepo = (
	stores: TestStores,
): PrincipalRepositoryShape => ({
	findById: (id) => Effect.succeed(withUser(stores, stores.principals.get(id))),

	findBySlug: (slug) =>
		Effect.succeed(withUser(stores, findLivePrincipalBySlug(stores, slug))),

	findByEmail: (email) =>
		Effect.succeed(withPrincipal(stores, findUserRowByEmail(stores, email))),

	findPrincipalById: (id) =>
		Effect.succeed(Option.fromNullishOr(stores.principals.get(id))),

	findPrincipalByIds: (ids) =>
		Effect.sync(() => {
			const map = new Map<PrincipalId, PrincipalRow>();
			for (const id of ids) {
				const row = stores.principals.get(id);
				if (row !== undefined && row.deletedAt === null) {
					map.set(id, row);
				}
			}
			return map;
		}),

	findPrincipalBySlug: (slug) =>
		Effect.succeed(Option.fromNullishOr(findLivePrincipalBySlug(stores, slug))),

	findUserByUserId: (id) =>
		Effect.succeed(Option.fromNullishOr(stores.users.get(id))),

	updateProperties: (id, changes: PrincipalPropertyChanges) =>
		Effect.sync(() => {
			const row = stores.principals.get(id);
			if (!row || row.deletedAt !== null) {
				throw new Error(`Principal not found for property update: ${id}`);
			}
			const updated: PrincipalRow = {
				...row,
				clientProperties: changes.clientProperties,
				...(changes.displayName !== undefined
					? { displayName: changes.displayName }
					: {}),
				updatedAt: Temporal.Now.instant(),
			};
			stores.principals.set(id, updated);
			return updated;
		}),

	listAll: () => Effect.sync(() => livePrincipalsWithUsers(stores)),

	searchByDisplayName: (query, limit) =>
		Effect.sync(() =>
			livePrincipalsWithUsers(stores)
				.filter((row) => matchesQuery(row, query.toLowerCase()))
				.slice(0, limit),
		),
});
