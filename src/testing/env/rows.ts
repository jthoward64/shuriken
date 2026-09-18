import { Option } from "effect";
import type {
	PrincipalRow,
	PrincipalWithUser,
	UserRow,
} from "#src/services/principal/repository.ts";
import { allPrincipals, allUsers, type TestStores } from "./stores.ts";

// ---------------------------------------------------------------------------
// Row lookups shared by the user and principal repositories, which read the
// same two tables from opposite ends.
// ---------------------------------------------------------------------------

/** Pairs a user row with its principal, or none when either side is missing */
export const withPrincipal = (
	stores: TestStores,
	userRow: UserRow | undefined,
): Option.Option<PrincipalWithUser> =>
	Option.flatMap(Option.fromNullishOr(userRow), (user) =>
		Option.map(
			Option.fromNullishOr(stores.principals.get(user.principalId)),
			(principal) => ({ principal, user }),
		),
	);

/** Pairs a principal row with its user, or none when either side is missing */
export const withUser = (
	stores: TestStores,
	principalRow: PrincipalRow | undefined,
): Option.Option<PrincipalWithUser> =>
	Option.flatMap(Option.fromNullishOr(principalRow), (principal) =>
		Option.map(
			Option.fromNullishOr(
				allUsers(stores).find((u) => u.principalId === principal.id),
			),
			(user) => ({ principal, user }),
		),
	);

/** The live (non-deleted) user principal holding this slug */
export const findLivePrincipalBySlug = (
	stores: TestStores,
	slug: string,
): PrincipalRow | undefined =>
	allPrincipals(stores).find((p) => p.slug === slug && p.deletedAt === null);

/** The user row with this email address */
export const findUserRowByEmail = (
	stores: TestStores,
	email: string,
): UserRow | undefined => allUsers(stores).find((u) => u.email === email);

/** Every live user principal paired with its user row, in insertion order */
export const livePrincipalsWithUsers = (
	stores: TestStores,
): ReadonlyArray<PrincipalWithUser> =>
	allPrincipals(stores)
		.filter((p) => p.deletedAt === null)
		.flatMap((principal) => {
			const user = allUsers(stores).find((u) => u.principalId === principal.id);
			return user ? [{ principal, user }] : [];
		});
