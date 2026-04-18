import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
import {
	davAcl,
	davCollection,
	davInstance,
	group,
	membership,
	user,
} from "#src/db/drizzle/schema/index.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import type { PrincipalId, UuidString } from "#src/domain/ids.ts";
import type { DavPrivilege } from "#src/domain/types/dav.ts";
import {
	AclRepository,
	type AclResourceType,
	type NewAce,
} from "./repository.ts";

// ---------------------------------------------------------------------------
// AclRepository — Drizzle implementation over dav_acl
// ---------------------------------------------------------------------------

const getAces = Effect.fn("AclRepository.getAces")(
	function* (
		db: DbClient,
		resourceId: UuidString,
		resourceType: AclResourceType,
	) {
		yield* Effect.annotateCurrentSpan({ "resource.id": resourceId, "resource.type": resourceType });
		yield* Effect.logTrace("repo.acl.getAces", { resourceId, resourceType });
		return yield* Effect.tryPromise({
			try: () =>
				db
					.select()
					.from(davAcl)
					.where(
						and(
							eq(davAcl.resourceId, resourceId),
							eq(davAcl.resourceType, resourceType),
						),
					)
					.orderBy(davAcl.ordinal),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) => Effect.logWarning("repo.acl.getAces failed", e.cause)),
);

const setAces = Effect.fn("AclRepository.setAces")(
	function* (
		db: DbClient,
		resourceId: UuidString,
		resourceType: AclResourceType,
		aces: ReadonlyArray<NewAce>,
	) {
		yield* Effect.annotateCurrentSpan({
			"resource.id": resourceId,
			"resource.type": resourceType,
			"acl.count": aces.length,
		});
		yield* Effect.logTrace("repo.acl.setAces", {
			resourceId,
			resourceType,
			count: aces.length,
		});
		return yield* Effect.tryPromise({
			try: () =>
				db.transaction(async (tx) => {
					// Delete all non-protected ACEs for this resource
					await tx
						.delete(davAcl)
						.where(
							and(
								eq(davAcl.resourceId, resourceId),
								eq(davAcl.resourceType, resourceType),
								eq(davAcl.protected, false),
							),
						);
					// Insert the new ACEs (skip if empty)
					if (aces.length > 0) {
						await tx.insert(davAcl).values(
							aces.map((ace) => ({
								resourceType: ace.resourceType,
								resourceId: ace.resourceId,
								principalType: ace.principalType,
								principalId: ace.principalId ?? null,
								privilege: ace.privilege,
								grantDeny: ace.grantDeny,
								protected: ace.protected,
								ordinal: ace.ordinal,
							})),
						);
					}
				}),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) => Effect.logWarning("repo.acl.setAces failed", e.cause)),
);

const grantAce = Effect.fn("AclRepository.grantAce")(
	function* (db: DbClient, ace: NewAce) {
		yield* Effect.annotateCurrentSpan({
			"resource.id": ace.resourceId,
			"acl.privilege": ace.privilege,
		});
		yield* Effect.logTrace("repo.acl.grantAce", {
			resourceId: ace.resourceId,
			privilege: ace.privilege,
		});
		return yield* Effect.tryPromise({
			try: () =>
				db
					.insert(davAcl)
					.values({
						resourceType: ace.resourceType,
						resourceId: ace.resourceId,
						principalType: ace.principalType,
						principalId: ace.principalId ?? null,
						privilege: ace.privilege,
						grantDeny: ace.grantDeny,
						protected: ace.protected,
						ordinal: ace.ordinal,
					})
					.then(() => undefined),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.acl.grantAce failed", e.cause),
	),
);

// ---------------------------------------------------------------------------
// Principal filter helper
//
// Matches rows where:
//   principal_type = 'all'                                    (always)
//   principal_type = 'authenticated'  AND caller is authed    (when isAuthenticated)
//   principal_type = 'unauthenticated' AND caller is not authed
//   principal_type = 'principal'      AND principal_id in set
// ---------------------------------------------------------------------------

function buildPrincipalFilter(
	principalIds: ReadonlyArray<PrincipalId>,
	isAuthenticated: boolean,
): SQL {
	const conditions: Array<SQL | undefined> = [
		eq(davAcl.principalType, "all"),
		isAuthenticated
			? eq(davAcl.principalType, "authenticated")
			: eq(davAcl.principalType, "unauthenticated"),
	];

	if (principalIds.length > 0) {
		conditions.push(
			and(
				eq(davAcl.principalType, "principal"),
				inArray(davAcl.principalId, principalIds as ReadonlyArray<UuidString>),
			),
		);
	}

	return or(...conditions) as SQL;
}

const hasPrivilege = Effect.fn("AclRepository.hasPrivilege")(
	function* (
		db: DbClient,
		principalIds: ReadonlyArray<PrincipalId>,
		resourceId: UuidString,
		resourceType: AclResourceType,
		privileges: ReadonlyArray<DavPrivilege>,
		isAuthenticated: boolean,
	) {
		yield* Effect.annotateCurrentSpan({
			"resource.id": resourceId,
			"resource.type": resourceType,
		});
		yield* Effect.logTrace("repo.acl.hasPrivilege", {
			resourceId,
			resourceType,
		});
		return yield* Effect.tryPromise({
			try: () =>
				db
					.select({ id: davAcl.id })
					.from(davAcl)
					.where(
						and(
							eq(davAcl.resourceId, resourceId),
							eq(davAcl.resourceType, resourceType),
							eq(davAcl.grantDeny, "grant"),
							inArray(davAcl.privilege, privileges as Array<DavPrivilege>),
							buildPrincipalFilter(principalIds, isAuthenticated),
						),
					)
					.limit(1)
					.then((r) => r.length > 0),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.acl.hasPrivilege failed", e.cause),
	),
);

const getGrantedPrivileges = Effect.fn("AclRepository.getGrantedPrivileges")(
	function* (
		db: DbClient,
		principalIds: ReadonlyArray<PrincipalId>,
		resourceId: UuidString,
		resourceType: AclResourceType,
		isAuthenticated: boolean,
	) {
		yield* Effect.annotateCurrentSpan({
			"resource.id": resourceId,
			"resource.type": resourceType,
		});
		yield* Effect.logTrace("repo.acl.getGrantedPrivileges", {
			resourceId,
			resourceType,
		});
		return yield* Effect.tryPromise({
			try: () =>
				db
					.selectDistinct({ privilege: davAcl.privilege })
					.from(davAcl)
					.where(
						and(
							eq(davAcl.resourceId, resourceId),
							eq(davAcl.resourceType, resourceType),
							eq(davAcl.grantDeny, "grant"),
							buildPrincipalFilter(principalIds, isAuthenticated),
						),
					)
					.then((rows) => rows.map((r) => r.privilege as DavPrivilege)),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.acl.getGrantedPrivileges failed", e.cause),
	),
);

const getResourceParent = Effect.fn("AclRepository.getResourceParent")(
	function* (
		db: DbClient,
		resourceId: UuidString,
		resourceType: AclResourceType,
	) {
		yield* Effect.annotateCurrentSpan({
			"resource.id": resourceId,
			"resource.type": resourceType,
		});
		yield* Effect.logTrace("repo.acl.getResourceParent", {
			resourceId,
			resourceType,
		});
		if (resourceType === "principal" || resourceType === "virtual") {
			return Option.none<{
				readonly id: UuidString;
				readonly type: AclResourceType;
			}>();
		}
		if (resourceType === "instance") {
			return yield* Effect.tryPromise({
				try: () =>
					db
						.select({ collectionId: davInstance.collectionId })
						.from(davInstance)
						.where(eq(davInstance.id, resourceId))
						.limit(1)
						.then((rows) =>
							rows[0]
								? Option.some({
										id: rows[0].collectionId as UuidString,
										type: "collection" as const,
									})
								: Option.none(),
						),
				catch: (e) => new DatabaseError({ cause: e }),
			});
		}
		// collection
		return yield* Effect.tryPromise({
			try: () =>
				db
					.select({
						parentCollectionId: davCollection.parentCollectionId,
						ownerPrincipalId: davCollection.ownerPrincipalId,
					})
					.from(davCollection)
					.where(eq(davCollection.id, resourceId))
					.limit(1)
					.then((rows) => {
						const row = rows[0];
						if (!row) {
							return Option.none<{
								readonly id: UuidString;
								readonly type: AclResourceType;
							}>();
						}
						if (row.parentCollectionId) {
							return Option.some({
								id: row.parentCollectionId as UuidString,
								type: "collection" as const,
							});
						}
						return Option.some({
							id: row.ownerPrincipalId as UuidString,
							type: "principal" as const,
						});
					}),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.acl.getResourceParent failed", e.cause),
	),
);

const getGroupPrincipalIds = Effect.fn("AclRepository.getGroupPrincipalIds")(
	function* (db: DbClient, userPrincipalId: PrincipalId) {
		yield* Effect.annotateCurrentSpan({ "principal.id": userPrincipalId });
		yield* Effect.logTrace("repo.acl.getGroupPrincipalIds", {
			userPrincipalId,
		});
		return yield* Effect.tryPromise({
			try: () =>
				db
					.select({ principalId: group.principalId })
					.from(group)
					.innerJoin(membership, eq(membership.groupId, group.id))
					.innerJoin(user, eq(user.id, membership.userId))
					.where(eq(user.principalId, userPrincipalId))
					.then((rows) => rows.map((r) => r.principalId as PrincipalId)),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.acl.getGroupPrincipalIds failed", e.cause),
	),
);

export const AclRepositoryLive = Layer.effect(
	AclRepository,
	Effect.map(DatabaseClient, (db) =>
		AclRepository.of({
			getAces: (resourceId, resourceType) =>
				getAces(db, resourceId, resourceType),
			setAces: (resourceId, resourceType, aces) =>
				setAces(db, resourceId, resourceType, aces),
			grantAce: (ace) => grantAce(db, ace),
			hasPrivilege: (
				principalIds,
				resourceId,
				resourceType,
				privileges,
				isAuthenticated,
			) =>
				hasPrivilege(
					db,
					principalIds,
					resourceId,
					resourceType,
					privileges,
					isAuthenticated,
				),
			getGrantedPrivileges: (
				principalIds,
				resourceId,
				resourceType,
				isAuthenticated,
			) =>
				getGrantedPrivileges(
					db,
					principalIds,
					resourceId,
					resourceType,
					isAuthenticated,
				),
			getGroupPrincipalIds: (userPrincipalId) =>
				getGroupPrincipalIds(db, userPrincipalId),
			getResourceParent: (resourceId, resourceType) =>
				getResourceParent(db, resourceId, resourceType),
		}),
	),
);
