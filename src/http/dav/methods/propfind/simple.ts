// ---------------------------------------------------------------------------
// The PROPFIND branches that build a small, fixed property set
// ---------------------------------------------------------------------------

import { Effect, Option } from "effect";
import { type ClarkName, cn } from "#src/data/ir.ts";
import { GroupId } from "#src/domain/ids.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import {
	buildInstanceProps,
	splitPropstats,
} from "#src/http/dav/methods/instance-props.ts";
import type { DavResponse } from "#src/http/dav/xml/multistatus.ts";
import { AclService } from "#src/services/acl/index.ts";
import { CollectionService } from "#src/services/collection/index.ts";
import {
	applyReadOnlyPrivileges,
	isReadOnlyCollectionRow,
} from "#src/services/collection/read-only-guard.ts";
import { GroupService } from "#src/services/group/index.ts";
import { InstanceService } from "#src/services/instance/index.ts";
import { PrincipalRepository } from "#src/services/principal/index.ts";
import { buildAclValue, buildPrivilegeSet } from "./acl-props.ts";
import type { PropfindContext } from "./context.ts";
import { COLLECTION_HOME_DISPLAYNAME, instanceHref } from "./href.ts";
import { collectionMemberResponse, namespaceOf } from "./members.ts";
import {
	CURRENT_USER_PRINCIPAL,
	CURRENT_USER_PRIVILEGE_SET,
	DAV_ACL,
	DAV_GROUP_MEMBER_SET,
	DAV_NS,
	DAV_OWNER,
	DISPLAYNAME,
	PRINCIPAL_URL,
	RESOURCETYPE,
} from "./ns.ts";
import { dataClarkForNamespace, loadInstanceData } from "./parse.ts";

/**
 * RFC 6764 §6.1 / RFC 5397 §3: the root resource exposes
 * DAV:current-user-principal so auto-discovery clients can bootstrap without
 * knowing any principal URL.
 */
export const rootResponses = (
	ctx: PropfindContext,
): ReadonlyArray<DavResponse> => [
	{
		href: `${ctx.origin}/dav/`,
		propstats: splitPropstats(
			{
				[RESOURCETYPE]: { [cn(DAV_NS, "collection")]: "" },
				[DISPLAYNAME]: "DAV",
				[CURRENT_USER_PRINCIPAL]: {
					[cn(DAV_NS, "href")]: ctx.actingPrincipalHref,
				},
			},
			ctx.request,
		),
	},
];

/**
 * RFC 3744 §4.5: the principal-collection resource. Depth:0 returns just this
 * resource; Depth:1 enumerates every (non-deleted) user principal so client UIs
 * can populate principal pickers.
 */
export const principalCollectionResponses = Effect.fn(
	"dav.propfind.principalCollection",
)(function* (ctx: PropfindContext) {
	const responses: Array<DavResponse> = [
		{
			href: `${ctx.origin}/dav/principals/`,
			propstats: splitPropstats(
				{
					[RESOURCETYPE]: { [cn(DAV_NS, "collection")]: "" },
					[DISPLAYNAME]: "Principals",
					[CURRENT_USER_PRINCIPAL]: {
						[cn(DAV_NS, "href")]: ctx.actingPrincipalHref,
					},
				},
				ctx.request,
			),
		},
	];
	if (ctx.depth === 0) {
		return responses;
	}
	const principalRepo = yield* PrincipalRepository;
	for (const p of yield* principalRepo.listAll()) {
		const pHref = `${ctx.origin}/dav/principals/${p.principal.id}/`;
		responses.push({
			href: pHref,
			propstats: splitPropstats(
				{
					[RESOURCETYPE]: { [cn(DAV_NS, "principal")]: "" },
					[DISPLAYNAME]: p.principal.displayName ?? p.principal.slug,
					[PRINCIPAL_URL]: { [cn(DAV_NS, "href")]: pHref },
				},
				ctx.request,
			),
		});
	}
	return responses;
});

/**
 * RFC 4918 §5.2: the per-type namespace level (e.g. /…/cal/) is a real
 * collection — the calendar/addressbook home whose members are the principal's
 * typed collections. Authorized via the owning principal's ACL, since the home
 * has no ACL row of its own.
 */
export const collectionHomeResponses = Effect.fn("dav.propfind.home")(
	function* (
		path: Extract<ResolvedDavPath, { kind: "collectionHome" }>,
		ctx: PropfindContext,
	) {
		const acl = yield* AclService;
		yield* acl.check(
			ctx.actingPrincipalId,
			path.principalId,
			"principal",
			"DAV:read",
		);
		const homePrivileges = yield* acl.currentUserPrivileges(
			ctx.actingPrincipalId,
			path.principalId,
			"principal",
		);
		const responses: Array<DavResponse> = [
			{
				href: `${ctx.origin}/dav/principals/${path.principalSeg}/${path.namespace}/`,
				propstats: splitPropstats(
					{
						// An ordinary WebDAV collection, NOT a calendar/addressbook —
						// those resourcetypes belong on the members beneath it.
						[RESOURCETYPE]: { [cn(DAV_NS, "collection")]: "" },
						[DISPLAYNAME]: COLLECTION_HOME_DISPLAYNAME[path.namespace],
						[DAV_OWNER]: {
							[cn(DAV_NS, "href")]:
								`${ctx.origin}/dav/principals/${path.principalId}/`,
						},
						[CURRENT_USER_PRINCIPAL]: {
							[cn(DAV_NS, "href")]: ctx.actingPrincipalHref,
						},
						[CURRENT_USER_PRIVILEGE_SET]: buildPrivilegeSet(homePrivileges),
					},
					ctx.request,
				),
			},
		];
		if (ctx.depth === 0) {
			return responses;
		}
		const collSvc = yield* CollectionService;
		for (const coll of yield* collSvc.listByOwner(path.principalId)) {
			if (namespaceOf(coll.collectionType) === path.namespace) {
				responses.push(
					yield* collectionMemberResponse(coll, path.principalSeg, ctx),
				);
			}
		}
		return responses;
	},
);

/** RFC 3744 §4.3: group principals expose DAV:group-member-set. */
export const groupResponses = Effect.fn("dav.propfind.group")(function* (
	path: Extract<ResolvedDavPath, { kind: "group" }>,
	ctx: PropfindContext,
) {
	const acl = yield* AclService;
	yield* acl.check(
		ctx.actingPrincipalId,
		path.principalId,
		"principal",
		"DAV:read",
	);
	const groupSvc = yield* GroupService;
	const groupRow = yield* groupSvc.findById(GroupId(path.groupId));
	const members = yield* groupSvc.listMembers(GroupId(path.groupId));
	return [
		{
			href: `${ctx.origin}/dav/groups/${path.groupSeg}/`,
			propstats: splitPropstats(
				{
					[RESOURCETYPE]: { [cn(DAV_NS, "principal")]: "" },
					[DISPLAYNAME]:
						groupRow.principal.displayName ?? groupRow.principal.slug,
					[DAV_GROUP_MEMBER_SET]: members.map((m) => ({
						[cn(DAV_NS, "href")]:
							`${ctx.origin}/dav/principals/${m.principal.id}/`,
					})),
					[CURRENT_USER_PRINCIPAL]: {
						[cn(DAV_NS, "href")]: ctx.actingPrincipalHref,
					},
				},
				ctx.request,
			),
		},
	] satisfies ReadonlyArray<DavResponse>;
});

export const instanceResponses = Effect.fn("dav.propfind.instance")(function* (
	path: Extract<ResolvedDavPath, { kind: "instance" }>,
	ctx: PropfindContext,
) {
	const acl = yield* AclService;
	yield* acl.check(
		ctx.actingPrincipalId,
		path.instanceId,
		"instance",
		"CALDAV:read-free-busy",
	);
	const instancePrivileges = yield* acl.currentUserPrivileges(
		ctx.actingPrincipalId,
		path.instanceId,
		"instance",
	);
	const hasFullRead = (instancePrivileges as ReadonlyArray<string>).includes(
		"DAV:read",
	);
	const instSvc = yield* InstanceService;
	const instRow = yield* instSvc.findById(path.instanceId);
	// DAV:owner comes from the parent collection.
	const collSvc = yield* CollectionService;
	const instCollRow = yield* collSvc.findById(path.collectionId);
	// A member of a read-only calendar is itself read-only to the client.
	const instReadOnly = yield* isReadOnlyCollectionRow(instCollRow);

	const live: Record<ClarkName, unknown> = {
		[CURRENT_USER_PRINCIPAL]: { [cn(DAV_NS, "href")]: ctx.actingPrincipalHref },
		[CURRENT_USER_PRIVILEGE_SET]: buildPrivilegeSet(
			applyReadOnlyPrivileges(instancePrivileges, instReadOnly),
		),
		// RFC 3744 §5.1: owner inherited from the parent collection
		[DAV_OWNER]: {
			[cn(DAV_NS, "href")]:
				`${ctx.origin}/dav/principals/${instCollRow.ownerPrincipalId}/`,
		},
	};

	// RFC 4791 §9.6 / RFC 6352 §10.4 — body-data when explicitly requested.
	const dataOpt = yield* loadInstanceData(
		instRow,
		path.namespace,
		ctx.request,
		!hasFullRead,
	);
	const dataKey = Option.getOrUndefined(dataClarkForNamespace(path.namespace));
	if (dataKey !== undefined) {
		Option.map(dataOpt, (body) => {
			live[dataKey] = body;
		});
	}

	// DAV:acl — RFC 3744 §5.5: only when the caller holds read-acl.
	if ((instancePrivileges as ReadonlyArray<string>).includes("DAV:read-acl")) {
		const aces = yield* acl.getAces(path.instanceId, "instance");
		live[DAV_ACL] = buildAclValue(aces, ctx.origin);
	}

	return [
		{
			href: instanceHref(
				{
					origin: ctx.origin,
					principalSeg: path.principalSeg,
					ns: path.namespace,
					collectionSeg: path.collectionSeg,
				},
				path.instanceSeg,
			),
			propstats: splitPropstats(buildInstanceProps(instRow, live), ctx.request),
		},
	] satisfies ReadonlyArray<DavResponse>;
});
