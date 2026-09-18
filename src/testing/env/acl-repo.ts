import { Effect, Option } from "effect";
import { Temporal } from "temporal-polyfill";
import type { ResourceType } from "#src/db/drizzle/schema/index.ts";
import type { PrincipalId, UuidString } from "#src/domain/ids.ts";
import type { DavPrivilege } from "#src/domain/types/dav.ts";
import type {
	AceRow,
	AclRepositoryShape,
	NewAce,
} from "#src/services/acl/repository.ts";
import { DEFAULT_ROLE } from "#src/services/role/policy.ts";
import { allUsers, type TestStores } from "./stores.ts";

// ---------------------------------------------------------------------------
// In-memory AclRepository
// ---------------------------------------------------------------------------

/** A resource reference, as the ACL walk up the hierarchy returns it */
interface ParentRef {
	readonly id: UuidString;
	readonly type: ResourceType;
}

// Principal-matching helper — mirrors the SQL logic in repository.live.ts
const matchesPrincipal = (
	ace: AceRow,
	principalIds: ReadonlyArray<string>,
	isAuthenticated: boolean,
): boolean => {
	if (ace.principalType === "all") {
		return true;
	}
	if (ace.principalType === "authenticated") {
		return isAuthenticated;
	}
	if (ace.principalType === "unauthenticated") {
		return !isAuthenticated;
	}
	if (ace.principalType === "principal" && ace.principalId !== null) {
		return principalIds.includes(ace.principalId);
	}
	return false;
};

// Group principals the user belongs to, resolved through the membership table
const groupPrincipalIdsOf = (
	stores: TestStores,
	userPrincipalId: string,
): ReadonlyArray<PrincipalId> => {
	const userRow = allUsers(stores).find(
		(u) => u.principalId === userPrincipalId,
	);
	if (!userRow) {
		return [];
	}
	return [...stores.memberships.entries()]
		.filter(([, members]) => members.has(userRow.id))
		.flatMap(([groupId]) => {
			const groupRow = stores.groups.get(groupId);
			return groupRow ? [groupRow.principalId as PrincipalId] : [];
		});
};

// One step up the ACL inheritance chain: instance → collection → principal
const resourceParent = (
	stores: TestStores,
	resourceId: string,
	resourceType: ResourceType,
): Option.Option<ParentRef> => {
	if (resourceType === "instance") {
		return Option.map(
			Option.fromNullishOr(stores.instances.get(resourceId)),
			(inst): ParentRef => ({
				id: inst.collectionId as UuidString,
				type: "collection",
			}),
		);
	}
	if (resourceType === "collection") {
		return Option.map(
			Option.fromNullishOr(stores.collections.get(resourceId)),
			(col): ParentRef =>
				col.parentCollectionId
					? { id: col.parentCollectionId as UuidString, type: "collection" }
					: { id: col.ownerPrincipalId as UuidString, type: "principal" },
		);
	}
	// principal — top of the hierarchy
	return Option.none();
};

export const makeAclRepo = (stores: TestStores): AclRepositoryShape => ({
	getAces: (resourceId, resourceType) =>
		Effect.succeed(
			(stores.acl.get(resourceId) ?? [])
				.filter((a) => a.resourceType === resourceType)
				.sort((a, b) => a.ordinal - b.ordinal),
		),

	setAces: (resourceId, resourceType, aces) =>
		Effect.sync(() => {
			const existing = stores.acl.get(resourceId) ?? [];
			const kept = existing.filter(
				(a) => a.resourceType !== resourceType || a.protected,
			);
			const now = Temporal.Now.instant();
			const newRows: Array<AceRow> = aces.map((ace) => ({
				id: crypto.randomUUID(),
				resourceType: ace.resourceType,
				resourceId: ace.resourceId,
				principalType: ace.principalType,
				principalId: ace.principalId ?? null,
				privilege: ace.privilege,
				grantDeny: ace.grantDeny,
				protected: ace.protected,
				ordinal: ace.ordinal,
				updatedAt: now,
			}));
			stores.acl.set(resourceId, [...kept, ...newRows]);
		}),

	grantAce: (ace: NewAce) =>
		Effect.sync(() => {
			const existing = stores.acl.get(ace.resourceId) ?? [];
			stores.acl.set(ace.resourceId, [
				...existing,
				{
					id: crypto.randomUUID(),
					resourceType: ace.resourceType,
					resourceId: ace.resourceId,
					principalType: ace.principalType,
					principalId: ace.principalId ?? null,
					privilege: ace.privilege,
					grantDeny: ace.grantDeny,
					protected: ace.protected,
					ordinal: ace.ordinal,
					updatedAt: Temporal.Now.instant(),
				},
			]);
		}),

	hasPrivilege: (
		principalIds,
		{ resourceId, resourceType },
		privileges,
		isAuthenticated,
	) =>
		Effect.succeed(
			(stores.acl.get(resourceId) ?? []).some(
				(ace) =>
					ace.resourceType === resourceType &&
					ace.grantDeny === "grant" &&
					(privileges as ReadonlyArray<string>).includes(ace.privilege) &&
					matchesPrincipal(ace, principalIds, isAuthenticated),
			),
		),

	getGrantedPrivileges: (
		principalIds,
		resourceId,
		resourceType,
		isAuthenticated,
	) =>
		Effect.succeed([
			...new Set(
				(stores.acl.get(resourceId) ?? [])
					.filter(
						(ace) =>
							ace.resourceType === resourceType &&
							ace.grantDeny === "grant" &&
							matchesPrincipal(ace, principalIds, isAuthenticated),
					)
					.map((ace) => ace.privilege as DavPrivilege),
			),
		]),

	batchGetGrantedPrivileges: (callerPrincipalIds, resourceIds, resourceType) =>
		Effect.succeed(
			new Map(
				resourceIds.map((resourceId) => [
					resourceId,
					[
						...new Set(
							(stores.acl.get(resourceId) ?? [])
								.filter(
									(ace) =>
										ace.resourceType === resourceType &&
										ace.grantDeny === "grant" &&
										matchesPrincipal(ace, callerPrincipalIds, true),
								)
								.map((ace) => ace.privilege as DavPrivilege),
						),
					] as ReadonlyArray<DavPrivilege>,
				]),
			),
		),

	getGroupPrincipalIds: (userPrincipalId) =>
		Effect.sync(() => groupPrincipalIdsOf(stores, userPrincipalId)),

	getResourceParent: (resourceId, resourceType) =>
		Effect.sync(() => resourceParent(stores, resourceId, resourceType)),

	getRoleForPrincipal: (principalId) =>
		Effect.sync(
			() =>
				allUsers(stores).find((u) => u.principalId === principalId)?.role ??
				DEFAULT_ROLE,
		),
});
