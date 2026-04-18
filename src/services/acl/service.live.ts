import { Array as Arr, Effect, Layer, Metric, Option } from "effect";
import { type DatabaseError, needPrivileges } from "#src/domain/errors.ts";
import type { PrincipalId, UuidString } from "#src/domain/ids.ts";
import type { DavPrivilege } from "#src/domain/types/dav.ts";
import { aclChecksTotal } from "#src/observability/metrics.ts";
import { AclRepository, type AclResourceType } from "./repository.ts";
import { AclService } from "./service.ts";

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
};

// All privileges contained within each aggregate (for currentUserPrivileges expansion)
const PRIVILEGE_CONTAINED: Readonly<
	Partial<Record<DavPrivilege, ReadonlyArray<DavPrivilege>>>
> = {
	"DAV:read": ["DAV:read-current-user-privilege-set"],
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

// ---------------------------------------------------------------------------
// AclServiceLive
// ---------------------------------------------------------------------------

export const AclServiceLive = Layer.effect(
	AclService,
	Effect.gen(function* () {
		const repo = yield* AclRepository;

		const resolvePrincipalIds = (
			principalId: PrincipalId,
		): Effect.Effect<ReadonlyArray<PrincipalId>, never> =>
			repo.getGroupPrincipalIds(principalId).pipe(
				Effect.map((groupIds) => [principalId, ...groupIds]),
				Effect.orElseSucceed(() => [principalId]),
			);

		// ---------------------------------------------------------------------------
		// Ancestor-chain walking helpers
		// ---------------------------------------------------------------------------

		const checkAncestors = (
			principalIds: ReadonlyArray<PrincipalId>,
			privileges: ReadonlyArray<DavPrivilege>,
			resourceId: UuidString,
			resourceType: AclResourceType,
		): Effect.Effect<boolean, DatabaseError> =>
			repo.getResourceParent(resourceId, resourceType).pipe(
				Effect.flatMap(
					Option.match({
						onNone: () => Effect.succeed(false),
						onSome: ({ id, type }) =>
							repo
								.hasPrivilege(principalIds, id, type, privileges, true)
								.pipe(
									Effect.flatMap((ok) =>
										ok
											? Effect.succeed(true)
											: checkAncestors(principalIds, privileges, id, type),
									),
								),
					}),
				),
			);

		const collectAncestorPrivileges = (
			principalIds: ReadonlyArray<PrincipalId>,
			resourceId: UuidString,
			resourceType: AclResourceType,
		): Effect.Effect<ReadonlyArray<DavPrivilege>, DatabaseError> =>
			repo.getResourceParent(resourceId, resourceType).pipe(
				Effect.flatMap(
					Option.match({
						onNone: () => Effect.succeed<ReadonlyArray<DavPrivilege>>([]),
						onSome: ({ id, type }) =>
							Effect.zipWith(
								repo.getGrantedPrivileges(principalIds, id, type, true),
								collectAncestorPrivileges(principalIds, id, type),
								(direct, inherited) => [...direct, ...inherited],
							),
					}),
				),
			);

		return AclService.of({
			getAces: Effect.fn("AclService.getAces")(
				function* (resourceId, resourceType) {
					yield* Effect.annotateCurrentSpan({ "acl.resource_id": resourceId, "acl.resource_type": resourceType });
					yield* Effect.logTrace("acl.getAces", { resourceId, resourceType });
					const aces = yield* repo.getAces(resourceId, resourceType);
					yield* Effect.logTrace("acl.getAces result", { count: aces.length });
					return aces;
				},
			),

			setAces: Effect.fn("AclService.setAces")(
				function* (resourceId, resourceType, aces) {
					yield* Effect.annotateCurrentSpan({ "acl.resource_id": resourceId, "acl.resource_type": resourceType });
					yield* Effect.logTrace("acl.setAces", { resourceId, resourceType, count: aces.length });
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
					const principalIds = yield* resolvePrincipalIds(principalId);
					const privileges = expandContainers(privilege);
					const allowed = yield* repo.hasPrivilege(
						principalIds,
						resourceId,
						resourceType,
						privileges,
						true,
					);
					if (allowed) {
						yield* Metric.increment(
							aclChecksTotal.pipe(Metric.tagged("acl.outcome", "allowed")),
						);
						return;
					}
					// Walk ancestor chain before giving up
					const inheritedAllowed = yield* checkAncestors(
						principalIds,
						privileges,
						resourceId,
						resourceType,
					);
					if (!inheritedAllowed) {
						yield* Effect.logDebug("acl.check: denied", {
							principalId,
							resourceId,
							privilege,
						});
						yield* Metric.increment(
							aclChecksTotal.pipe(Metric.tagged("acl.outcome", "denied")),
						);
						return yield* Effect.fail(needPrivileges());
					}
					yield* Metric.increment(
						aclChecksTotal.pipe(Metric.tagged("acl.outcome", "allowed")),
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
					const principalIds = yield* resolvePrincipalIds(principalId);
					const direct = yield* repo.getGrantedPrivileges(
						principalIds,
						resourceId,
						resourceType,
						true,
					);
					const inherited = yield* collectAncestorPrivileges(
						principalIds,
						resourceId,
						resourceType,
					);
					// Expand each granted privilege to all privileges it implies
					const expanded = new Set<DavPrivilege>();
					for (const p of [...direct, ...inherited]) {
						for (const contained of expandContained(p)) {
							expanded.add(contained);
						}
					}
					const result = Arr.fromIterable(expanded);
					yield* Effect.logTrace("acl.currentUserPrivileges result", {
						count: result.length,
					});
					return result;
				},
			),
		});
	}),
);
