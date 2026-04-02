import { Array as Arr, Effect, Layer } from "effect";
import { needPrivileges } from "#src/domain/errors.ts";
import type { PrincipalId } from "#src/domain/ids.ts";
import type { DavPrivilege } from "#src/domain/types/dav.ts";
import { AclRepository } from "./repository.ts";
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
	"DAV:read-current-user-privilege-set": ["DAV:all"],
	"DAV:write-acl": ["DAV:all"],
	"CALDAV:schedule-deliver-invite": ["CALDAV:schedule-deliver", "DAV:all"],
	"CALDAV:schedule-deliver-reply": ["CALDAV:schedule-deliver", "DAV:all"],
	"CALDAV:schedule-deliver": ["DAV:all"],
	"CALDAV:schedule-query-freebusy": ["CALDAV:schedule-send", "DAV:all"],
	"CALDAV:schedule-send-invite": ["CALDAV:schedule-send", "DAV:all"],
	"CALDAV:schedule-send-reply": ["CALDAV:schedule-send", "DAV:all"],
	"CALDAV:schedule-send-freebusy": ["CALDAV:schedule-send", "DAV:all"],
	"CALDAV:schedule-send": ["DAV:all"],
};

// All privileges contained within each aggregate (for currentUserPrivileges expansion)
const PRIVILEGE_CONTAINED: Readonly<
	Partial<Record<DavPrivilege, ReadonlyArray<DavPrivilege>>>
> = {
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
	],
	"CALDAV:schedule-send": [
		"CALDAV:schedule-send-invite",
		"CALDAV:schedule-send-reply",
		"CALDAV:schedule-send-freebusy",
		"CALDAV:schedule-query-freebusy",
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

		return AclService.of({
			check: (principalId, resourceUrl, privilege) =>
				Effect.gen(function* () {
					const principalIds = yield* resolvePrincipalIds(principalId);
					const privileges = expandContainers(privilege);
					const allowed = yield* repo.hasPrivilege(
						principalIds,
						resourceUrl,
						privileges,
						true,
					);
					if (!allowed) {
						return yield* Effect.fail(needPrivileges());
					}
				}),

			currentUserPrivileges: (principalId, resourceUrl) =>
				Effect.gen(function* () {
					const principalIds = yield* resolvePrincipalIds(principalId);
					const grantedAggregates = yield* repo.getGrantedPrivileges(
						principalIds,
						resourceUrl,
						true,
					);
					// Expand each granted privilege to all privileges it implies
					const expanded = new Set<DavPrivilege>();
					for (const p of grantedAggregates) {
						for (const contained of expandContained(p)) {
							expanded.add(contained);
						}
					}
					return Arr.fromIterable(expanded);
				}),
		});
	}),
);
