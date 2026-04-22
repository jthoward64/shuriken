import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import { DatabaseClient } from "#src/db/client.ts";
import {
	davAcl,
	davCollection,
	davInstance,
	group,
	membership,
	type ResourceType,
	user,
} from "#src/db/drizzle/schema/index.ts";
import { runDbQuery } from "#src/db/query.ts";
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
	function* (resourceId: UuidString, resourceType: AclResourceType) {
		yield* Effect.annotateCurrentSpan({
			"resource.id": resourceId,
			"resource.type": resourceType,
		});
		yield* Effect.logTrace("repo.acl.getAces", { resourceId, resourceType });
		return yield* runDbQuery((db) =>
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
		);
	},
	Effect.tapError((e) => Effect.logWarning("repo.acl.getAces failed", e.cause)),
);

const setAces = Effect.fn("AclRepository.setAces")(
	function* (
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
		yield* runDbQuery((db) =>
			db
				.delete(davAcl)
				.where(
					and(
						eq(davAcl.resourceId, resourceId),
						eq(davAcl.resourceType, resourceType),
						eq(davAcl.protected, false),
					),
				),
		).pipe(Effect.asVoid);
		if (aces.length > 0) {
			yield* runDbQuery((db) =>
				db.insert(davAcl).values(
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
				),
			).pipe(Effect.asVoid);
		}
	},
	Effect.tapError((e) => Effect.logWarning("repo.acl.setAces failed", e.cause)),
);

const grantAce = Effect.fn("AclRepository.grantAce")(
	function* (ace: NewAce) {
		yield* Effect.annotateCurrentSpan({
			"resource.id": ace.resourceId,
			"acl.privilege": ace.privilege,
		});
		yield* Effect.logTrace("repo.acl.grantAce", {
			resourceId: ace.resourceId,
			privilege: ace.privilege,
		});
		return yield* runDbQuery((db) =>
			db.insert(davAcl).values({
				resourceType: ace.resourceType,
				resourceId: ace.resourceId,
				principalType: ace.principalType,
				principalId: ace.principalId ?? null,
				privilege: ace.privilege,
				grantDeny: ace.grantDeny,
				protected: ace.protected,
				ordinal: ace.ordinal,
			}),
		).pipe(Effect.asVoid);
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
		return yield* runDbQuery((db) =>
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
				.limit(1),
		).pipe(Effect.map((r) => r.length > 0));
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.acl.hasPrivilege failed", e.cause),
	),
);

const getGrantedPrivileges = Effect.fn("AclRepository.getGrantedPrivileges")(
	function* (
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
		return yield* runDbQuery((db) =>
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
				),
		).pipe(Effect.map((rows) => rows.map((r) => r.privilege as DavPrivilege)));
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.acl.getGrantedPrivileges failed", e.cause),
	),
);

const getResourceParent = Effect.fn("AclRepository.getResourceParent")(
	function* (resourceId: UuidString, resourceType: ResourceType) {
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
				readonly type: ResourceType;
			}>();
		}
		if (resourceType === "instance") {
			return yield* runDbQuery((db) =>
				db
					.select({ collectionId: davInstance.collectionId })
					.from(davInstance)
					.where(eq(davInstance.id, resourceId))
					.limit(1),
			).pipe(
				Effect.map((rows) =>
					rows[0]
						? Option.some({
								id: rows[0].collectionId as UuidString,
								type: "collection" as const,
							})
						: Option.none(),
				),
			);
		}
		// collection
		return yield* runDbQuery((db) =>
			db
				.select({
					parentCollectionId: davCollection.parentCollectionId,
					ownerPrincipalId: davCollection.ownerPrincipalId,
				})
				.from(davCollection)
				.where(eq(davCollection.id, resourceId))
				.limit(1),
		).pipe(
			Effect.map((rows) => {
				const row = rows[0];
				if (!row) {
					return Option.none<{
						readonly id: UuidString;
						readonly type: ResourceType;
					}>();
				}
				if (row.parentCollectionId) {
					return Option.some({
						id: row.parentCollectionId,
						type: "collection" as const,
					});
				}
				return Option.some({
					id: row.ownerPrincipalId,
					type: "principal" as const,
				});
			}),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.acl.getResourceParent failed", e.cause),
	),
);

const getGroupPrincipalIds = Effect.fn("AclRepository.getGroupPrincipalIds")(
	function* (userPrincipalId: PrincipalId) {
		yield* Effect.annotateCurrentSpan({ "principal.id": userPrincipalId });
		yield* Effect.logTrace("repo.acl.getGroupPrincipalIds", {
			userPrincipalId,
		});
		return yield* runDbQuery((db) =>
			db
				.select({ principalId: group.principalId })
				.from(group)
				.innerJoin(membership, eq(membership.groupId, group.id))
				.innerJoin(user, eq(user.id, membership.userId))
				.where(eq(user.principalId, userPrincipalId)),
		).pipe(Effect.map((rows) => rows.map((r) => r.principalId as PrincipalId)));
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.acl.getGroupPrincipalIds failed", e.cause),
	),
);

const batchGetGrantedPrivileges = Effect.fn(
	"AclRepository.batchGetGrantedPrivileges",
)(
	function* (
		callerPrincipalIds: ReadonlyArray<PrincipalId>,
		resourceIds: ReadonlyArray<UuidString>,
		resourceType: ResourceType,
	) {
		if (resourceIds.length === 0) {
			return new Map<UuidString, ReadonlyArray<DavPrivilege>>();
		}
		yield* Effect.logTrace("repo.acl.batchGetGrantedPrivileges", {
			resourceCount: resourceIds.length,
			resourceType,
		});
		const rows = yield* runDbQuery((db) =>
			db
				.selectDistinct({
					resourceId: davAcl.resourceId,
					privilege: davAcl.privilege,
				})
				.from(davAcl)
				.where(
					and(
						inArray(davAcl.resourceId, resourceIds),
						eq(davAcl.resourceType, resourceType),
						eq(davAcl.grantDeny, "grant"),
						buildPrincipalFilter(callerPrincipalIds, true),
					),
				),
		);
		const result = new Map<UuidString, ReadonlyArray<DavPrivilege>>();
		for (const row of rows) {
			const id = row.resourceId as UuidString;
			const existing = result.get(id) ?? [];
			result.set(id, [...existing, row.privilege as DavPrivilege]);
		}
		return result;
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.acl.batchGetGrantedPrivileges failed", e.cause),
	),
);

export const AclRepositoryLive = Layer.effect(
	AclRepository,
	Effect.gen(function* () {
		const dc = yield* DatabaseClient;
		const run = <A, E>(
			e: Effect.Effect<A, E, DatabaseClient>,
		): Effect.Effect<A, E> => Effect.provideService(e, DatabaseClient, dc);
		return AclRepository.of({
			getAces: (...args: Parameters<typeof getAces>) => run(getAces(...args)),
			setAces: (...args: Parameters<typeof setAces>) => run(setAces(...args)),
			grantAce: (...args: Parameters<typeof grantAce>) =>
				run(grantAce(...args)),
			hasPrivilege: (...args: Parameters<typeof hasPrivilege>) =>
				run(hasPrivilege(...args)),
			getGrantedPrivileges: (
				...args: Parameters<typeof getGrantedPrivileges>
			) => run(getGrantedPrivileges(...args)),
			getGroupPrincipalIds: (
				...args: Parameters<typeof getGroupPrincipalIds>
			) => run(getGroupPrincipalIds(...args)),
			getResourceParent: (...args: Parameters<typeof getResourceParent>) =>
				run(getResourceParent(...args)),
			batchGetGrantedPrivileges: (
				...args: Parameters<typeof batchGetGrantedPrivileges>
			) => run(batchGetGrantedPrivileges(...args)),
		});
	}),
);
