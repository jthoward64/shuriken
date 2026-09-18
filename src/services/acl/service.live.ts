import { Array as Arr, Effect, Layer, Metric, Option } from "effect";
import type { ResourceType } from "#src/db/drizzle/schema/index.ts";
import { type DatabaseError, needPrivileges } from "#src/domain/errors.ts";
import type { PrincipalId, UuidString } from "#src/domain/ids.ts";
import type { DavPrivilege } from "#src/domain/types/dav.ts";
import { aclChecksTotal } from "#src/observability/metrics.ts";
import { bypassesAclCheck } from "#src/services/role/policy.ts";
import {
	AclRepository,
	type AclRepositoryShape,
	type AclResourceRef,
} from "./repository.ts";
import {
	type AclMemberBatch,
	type AclResourceId,
	AclService,
} from "./service.ts";

// ---------------------------------------------------------------------------
// Privilege hierarchy (RFC 3744 §3 + CalDAV §6)
//
// expandContainers(p) returns p plus all aggregate privileges that contain p.
// When checking whether a principal has privilege P, we look for any ACE
// granting P or any aggregate that implies P.
// ---------------------------------------------------------------------------

const PRIVILEGE_CONTAINERS: Readonly<
	Partial<Record<DavPrivilege, ReadonlyArray<DavPrivilege>>>
> = {
	"DAV:write-properties": ["DAV:write", "DAV:all"],
	"DAV:write-content": ["DAV:write", "DAV:all"],
	"DAV:bind": ["DAV:write", "DAV:all"],
	"DAV:unbind": ["DAV:write", "DAV:all"],
	"DAV:write": ["DAV:all"],
	"DAV:read": ["DAV:all"],
	"DAV:unlock": ["DAV:all"],
	"DAV:read-acl": ["DAV:all"],
	"DAV:read-current-user-privilege-set": ["DAV:read", "DAV:all"],
	"DAV:write-acl": ["DAV:all"],
	"CALDAV:schedule-deliver-invite": ["CALDAV:schedule-deliver", "DAV:all"],
	"CALDAV:schedule-deliver-reply": ["CALDAV:schedule-deliver", "DAV:all"],
	"CALDAV:schedule-deliver": ["DAV:all"],
	// RFC 6638 §6.3: schedule-query-freebusy is a sub-privilege of schedule-deliver (inbox), not schedule-send
	"CALDAV:schedule-query-freebusy": ["CALDAV:schedule-deliver", "DAV:all"],
	"CALDAV:schedule-send-invite": ["CALDAV:schedule-send", "DAV:all"],
	"CALDAV:schedule-send-reply": ["CALDAV:schedule-send", "DAV:all"],
	"CALDAV:schedule-send-freebusy": ["CALDAV:schedule-send", "DAV:all"],
	"CALDAV:schedule-send": ["DAV:all"],
	// shuriken extension: anyone holding DAV:read (or DAV:all) already sees
	// the full calendar, so they trivially satisfy the narrower free-busy-only
	// privilege too.
	"CALDAV:read-free-busy": ["DAV:read", "DAV:all"],
};

// All privileges contained within each aggregate (for currentUserPrivileges expansion)
const PRIVILEGE_CONTAINED: Readonly<
	Partial<Record<DavPrivilege, ReadonlyArray<DavPrivilege>>>
> = {
	"DAV:read": ["DAV:read-current-user-privilege-set", "CALDAV:read-free-busy"],
	"DAV:write": [
		"DAV:write-properties",
		"DAV:write-content",
		"DAV:bind",
		"DAV:unbind",
	],
	"DAV:all": [
		"DAV:read",
		"DAV:write",
		"DAV:write-properties",
		"DAV:write-content",
		"DAV:bind",
		"DAV:unbind",
		"DAV:unlock",
		"DAV:read-acl",
		"DAV:read-current-user-privilege-set",
		"DAV:write-acl",
		"CALDAV:schedule-deliver",
		"CALDAV:schedule-deliver-invite",
		"CALDAV:schedule-deliver-reply",
		"CALDAV:schedule-query-freebusy",
		"CALDAV:schedule-send",
		"CALDAV:schedule-send-invite",
		"CALDAV:schedule-send-reply",
		"CALDAV:schedule-send-freebusy",
		"CALDAV:read-free-busy",
	],
	"CALDAV:schedule-deliver": [
		"CALDAV:schedule-deliver-invite",
		"CALDAV:schedule-deliver-reply",
		// RFC 6638 §6.3: schedule-query-freebusy is a sub-privilege of schedule-deliver (inbox)
		"CALDAV:schedule-query-freebusy",
	],
	"CALDAV:schedule-send": [
		"CALDAV:schedule-send-invite",
		"CALDAV:schedule-send-reply",
		"CALDAV:schedule-send-freebusy",
	],
};

/** Returns the privilege itself plus all aggregates that contain it. */
function expandContainers(p: DavPrivilege): ReadonlyArray<DavPrivilege> {
	return [p, ...(PRIVILEGE_CONTAINERS[p] ?? [])];
}

/** Returns all concrete privileges implied by a granted aggregate (or the privilege itself). */
function expandContained(p: DavPrivilege): ReadonlyArray<DavPrivilege> {
	return [p, ...(PRIVILEGE_CONTAINED[p] ?? [])];
}

/** Returns every privilege implied by the granted set, deduplicated. */
function expandAllContained(
	granted: Iterable<DavPrivilege>,
): Set<DavPrivilege> {
	const expanded = new Set<DavPrivilege>();
	for (const p of granted) {
		for (const contained of expandContained(p)) {
			expanded.add(contained);
		}
	}
	return expanded;
}

// ---------------------------------------------------------------------------
// Principal and ancestor-chain helpers
// ---------------------------------------------------------------------------

/** The principal itself plus every group it belongs to, for ACE matching. */
const resolvePrincipalIds = Effect.fn("AclService.resolvePrincipalIds")(
	function* (repo: AclRepositoryShape, principalId: PrincipalId) {
		const groupIds = yield* Effect.orElseSucceed(
			repo.getGroupPrincipalIds(principalId),
			(): ReadonlyArray<PrincipalId> => [],
		);
		return [principalId, ...groupIds] as ReadonlyArray<PrincipalId>;
	},
);

/** Walks up the resource hierarchy looking for an inherited grant. */
const checkAncestors = Effect.fn("AclService.checkAncestors")(function* (
	repo: AclRepositoryShape,
	principalIds: ReadonlyArray<PrincipalId>,
	privileges: ReadonlyArray<DavPrivilege>,
	resource: AclResourceRef,
): Generator<Effect.Effect<unknown, DatabaseError>, boolean> {
	const parent = yield* repo.getResourceParent(
		resource.resourceId,
		resource.resourceType,
	);
	if (Option.isNone(parent)) {
		return false;
	}
	const parentRef: AclResourceRef = {
		resourceId: parent.value.id,
		resourceType: parent.value.type,
	};
	const allowed = yield* repo.hasPrivilege(
		principalIds,
		parentRef,
		privileges,
		true,
	);
	return (
		allowed ||
		(yield* checkAncestors(repo, principalIds, privileges, parentRef))
	);
});

/** Collects every privilege granted anywhere above the resource in the hierarchy. */
const collectAncestorPrivileges = Effect.fn(
	"AclService.collectAncestorPrivileges",
)(function* (
	repo: AclRepositoryShape,
	principalIds: ReadonlyArray<PrincipalId>,
	resourceId: UuidString,
	resourceType: ResourceType,
): Generator<
	Effect.Effect<unknown, DatabaseError>,
	ReadonlyArray<DavPrivilege>
> {
	const parent = yield* repo.getResourceParent(resourceId, resourceType);
	if (Option.isNone(parent)) {
		return [];
	}
	const { id, type } = parent.value;
	const direct = yield* repo.getGrantedPrivileges(principalIds, id, type, true);
	const inherited = yield* collectAncestorPrivileges(
		repo,
		principalIds,
		id,
		type,
	);
	return [...direct, ...inherited];
});

// Effective privileges for sibling members sharing one parent, computed
// with a single parent resolution + one batched direct-ACE query. A
// member's effective set = its direct ACEs ∪ the parent's effective set
// (which already includes the parent's own ancestors). Does not apply the
// role-based bypass — matches currentUserPrivileges. Shared by
// batchMemberPrivileges and batchCheckMembers.
const computeMemberPrivileges = Effect.fn("AclService.computeMemberPrivileges")(
	function* (
		repo: AclRepositoryShape,
		principalId: PrincipalId,
		batch: AclMemberBatch,
	) {
		const { parentId, parentType, memberIds, memberType } = batch;
		const result = new Map<AclResourceId, ReadonlyArray<DavPrivilege>>();
		if (memberIds.length === 0) {
			return result as ReadonlyMap<AclResourceId, ReadonlyArray<DavPrivilege>>;
		}
		const principalIds = yield* resolvePrincipalIds(repo, principalId);

		const parentDirect = yield* repo.getGrantedPrivileges(
			principalIds,
			parentId,
			parentType,
			true,
		);
		const parentInherited = yield* collectAncestorPrivileges(
			repo,
			principalIds,
			parentId,
			parentType,
		);
		const inheritedExpanded = expandAllContained([
			...parentDirect,
			...parentInherited,
		]);

		const directRaw = yield* repo.batchGetGrantedPrivileges(
			principalIds,
			memberIds as ReadonlyArray<UuidString>,
			memberType,
		);

		for (const memberId of memberIds) {
			const direct = directRaw.get(memberId as UuidString) ?? [];
			result.set(
				memberId,
				Arr.fromIterable(
					new Set([...inheritedExpanded, ...expandAllContained(direct)]),
				),
			);
		}
		return result as ReadonlyMap<AclResourceId, ReadonlyArray<DavPrivilege>>;
	},
);

// ---------------------------------------------------------------------------
// AclServiceLive
// ---------------------------------------------------------------------------

export const AclServiceLive = Layer.effect(
	AclService,
	Effect.gen(function* () {
		const repo = yield* AclRepository;

		return {
			getAces: Effect.fn("AclService.getAces")(
				function* (resourceId, resourceType) {
					yield* Effect.annotateCurrentSpan({
						"acl.resource_id": resourceId,
						"acl.resource_type": resourceType,
					});
					yield* Effect.logTrace("acl.getAces", { resourceId, resourceType });
					const aces = yield* repo.getAces(resourceId, resourceType);
					yield* Effect.logTrace("acl.getAces result", { count: aces.length });
					return aces;
				},
			),

			setAces: Effect.fn("AclService.setAces")(
				function* (resourceId, resourceType, aces) {
					yield* Effect.annotateCurrentSpan({
						"acl.resource_id": resourceId,
						"acl.resource_type": resourceType,
					});
					yield* Effect.logTrace("acl.setAces", {
						resourceId,
						resourceType,
						count: aces.length,
					});
					yield* repo.setAces(resourceId, resourceType, aces);
					yield* Effect.logTrace("acl.setAces done");
				},
			),

			check: Effect.fn("AclService.check")(
				function* (principalId, resourceId, resourceType, privilege) {
					yield* Effect.annotateCurrentSpan({
						"acl.principal_id": principalId,
						"acl.resource_id": resourceId,
						"acl.resource_type": resourceType,
						"acl.privilege": privilege,
					});
					yield* Effect.logTrace("acl.check", {
						principalId,
						resourceId,
						resourceType,
						privilege,
					});
					// Role-based short-circuit (super_admin et al). Skips the
					// ACE evaluation entirely.
					const role = yield* repo.getRoleForPrincipal(principalId);
					if (bypassesAclCheck(role)) {
						yield* Metric.update(
							Metric.withAttributes(aclChecksTotal, {
								"acl.outcome": "allowed",
							}),
							1,
						);
						return;
					}
					const principalIds = yield* resolvePrincipalIds(repo, principalId);
					const privileges = expandContainers(privilege);
					const allowed = yield* repo.hasPrivilege(
						principalIds,
						{ resourceId, resourceType },
						privileges,
						true,
					);
					if (allowed) {
						yield* Metric.update(
							Metric.withAttributes(aclChecksTotal, {
								"acl.outcome": "allowed",
							}),
							1,
						);
						return;
					}
					// Walk ancestor chain before giving up
					const inheritedAllowed = yield* checkAncestors(
						repo,
						principalIds,
						privileges,
						{ resourceId, resourceType },
					);
					if (!inheritedAllowed) {
						yield* Effect.logDebug("acl.check: denied", {
							principalId,
							resourceId,
							privilege,
						});
						yield* Metric.update(
							Metric.withAttributes(aclChecksTotal, {
								"acl.outcome": "denied",
							}),
							1,
						);
						return yield* Effect.fail(needPrivileges());
					}
					yield* Metric.update(
						Metric.withAttributes(aclChecksTotal, { "acl.outcome": "allowed" }),
						1,
					);
				},
			),

			currentUserPrivileges: Effect.fn("AclService.currentUserPrivileges")(
				function* (principalId, resourceId, resourceType) {
					yield* Effect.annotateCurrentSpan({
						"acl.principal_id": principalId,
						"acl.resource_id": resourceId,
						"acl.resource_type": resourceType,
					});
					yield* Effect.logTrace("acl.currentUserPrivileges", {
						principalId,
						resourceId,
						resourceType,
					});
					const principalIds = yield* resolvePrincipalIds(repo, principalId);
					const direct = yield* repo.getGrantedPrivileges(
						principalIds,
						resourceId,
						resourceType,
						true,
					);
					const inherited = yield* collectAncestorPrivileges(
						repo,
						principalIds,
						resourceId,
						resourceType,
					);
					// Expand each granted privilege to all privileges it implies
					const result = Arr.fromIterable(
						expandAllContained([...direct, ...inherited]),
					);
					yield* Effect.logTrace("acl.currentUserPrivileges result", {
						count: result.length,
					});
					return result;
				},
			),

			batchCurrentUserPrivileges: Effect.fn(
				"AclService.batchCurrentUserPrivileges",
			)(function* (principalId, resourceIds, resourceType) {
				yield* Effect.logTrace("acl.batchCurrentUserPrivileges", {
					principalId,
					resourceCount: resourceIds.length,
					resourceType,
				});
				const principalIds = yield* resolvePrincipalIds(repo, principalId);
				const raw = yield* repo.batchGetGrantedPrivileges(
					principalIds,
					resourceIds as ReadonlyArray<UuidString>,
					resourceType,
				);
				const result = new Map<AclResourceId, ReadonlyArray<DavPrivilege>>();
				for (const [id, privileges] of raw) {
					result.set(
						id as AclResourceId,
						Arr.fromIterable(expandAllContained(privileges)),
					);
				}
				return result;
			}),

			batchMemberPrivileges: Effect.fn("AclService.batchMemberPrivileges")(
				function* (principalId, batch) {
					yield* Effect.logTrace("acl.batchMemberPrivileges", {
						principalId,
						parentId: batch.parentId,
						parentType: batch.parentType,
						memberType: batch.memberType,
						memberCount: batch.memberIds.length,
					});
					return yield* computeMemberPrivileges(repo, principalId, batch);
				},
			),

			batchCheckMembers: Effect.fn("AclService.batchCheckMembers")(
				function* (principalId, batch, privilege) {
					const { parentId, parentType, memberIds, memberType } = batch;
					yield* Effect.logTrace("acl.batchCheckMembers", {
						principalId,
						parentId,
						parentType,
						memberType,
						privilege,
						memberCount: memberIds.length,
					});
					const allowed = new Set<AclResourceId>();
					if (memberIds.length === 0) {
						return allowed;
					}

					// Role-based bypass is per-principal — resolve once. Mirrors the
					// short-circuit in check() so super_admin et al. keep full access
					// without any per-member ACE.
					const role = yield* repo.getRoleForPrincipal(principalId);
					if (bypassesAclCheck(role)) {
						for (const id of memberIds) {
							allowed.add(id);
						}
						return allowed;
					}

					// Otherwise a member passes iff its effective privilege set
					// contains the requested privilege — equivalent to check() but
					// computed for every member in a bounded number of queries.
					const privMap = yield* computeMemberPrivileges(
						repo,
						principalId,
						batch,
					);
					for (const id of memberIds) {
						const privs = privMap.get(id) ?? [];
						if ((privs as ReadonlyArray<string>).includes(privilege)) {
							allowed.add(id);
						}
					}
					return allowed;
				},
			),
		};
	}),
);
