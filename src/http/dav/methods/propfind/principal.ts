// ---------------------------------------------------------------------------
// Principal PROPFIND — RFC 3744 §4, RFC 4791 §6.2.1, RFC 6352 §7.1.1
// ---------------------------------------------------------------------------

import { Effect } from "effect";
import type { ClarkName } from "#src/data/ir.ts";
import { cn } from "#src/data/ir.ts";
import { PrincipalId, UserId } from "#src/domain/ids.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import {
	creationDateFromId,
	splitPropstats,
} from "#src/http/dav/methods/instance-props.ts";
import type { DavResponse } from "#src/http/dav/xml/multistatus.ts";
import { AclService } from "#src/services/acl/index.ts";
import { CollectionService } from "#src/services/collection/index.ts";
import type { CollectionRow } from "#src/services/collection/repository.ts";
import { GroupService } from "#src/services/group/index.ts";
import type { GroupMembership } from "#src/services/group/repository.ts";
import { PrincipalService } from "#src/services/principal/service.ts";
import { readDeadProperties } from "../dead-properties.ts";
import {
	ACL_RESTRICTIONS_VALUE,
	buildAclValue,
	buildPrivilegeSet,
} from "./acl-props.ts";
import type { PropfindContext } from "./context.ts";
import { collectionHref } from "./href.ts";
import { collectionMemberResponse } from "./members.ts";
import {
	ACL_RESTRICTIONS,
	CAL_HOME_SET,
	CAL_USER_ADDRESS_SET,
	CAL_USER_TYPE,
	CARD_HOME_SET,
	CREATIONDATE,
	CURRENT_USER_PRINCIPAL,
	CURRENT_USER_PRIVILEGE_SET,
	DAV_ACL,
	DAV_ALTERNATE_URI_SET,
	DAV_GROUP_MEMBERSHIP,
	DAV_NS,
	DISPLAYNAME,
	PRINCIPAL_URL,
	RESOURCETYPE,
	SCHEDULE_INBOX_URL,
	SCHEDULE_OUTBOX_URL,
	TIMEZONE_SERVICE_SET,
} from "./ns.ts";

type PrincipalPath = Extract<ResolvedDavPath, { kind: "principal" }>;

/**
 * RFC 6638 §2.2: scheduling inbox/outbox hrefs live at /inbox/<uuid>/ and
 * /outbox/<uuid>/, not under /cal/. UUIDs are used because these are indirect
 * references the client never addressed itself.
 */
const schedulingHref = (
	collections: ReadonlyArray<CollectionRow>,
	collectionType: "inbox" | "outbox",
	origin: string,
	principalSeg: string,
): string | undefined => {
	const row = collections.find((c) => c.collectionType === collectionType);
	return row === undefined
		? undefined
		: collectionHref(origin, principalSeg, collectionType, row.id);
};

/** The collections a depth:1 principal response enumerates, grouped by owner */
const depthOneCollections = Effect.fn("dav.propfind.principalMembers")(
	function* (
		ownCollections: ReadonlyArray<CollectionRow>,
		memberOfGroups: ReadonlyArray<GroupMembership>,
		path: PrincipalPath,
		ctx: PropfindContext,
	) {
		const collSvc = yield* CollectionService;
		const responses: Array<DavResponse> = [];
		for (const coll of ownCollections) {
			responses.push(
				yield* collectionMemberResponse(coll, path.principalSeg, ctx),
			);
		}
		const groupCollectionSets = yield* Effect.all(
			memberOfGroups.map((g) =>
				collSvc.listByOwner(PrincipalId(g.principal.id)),
			),
		);
		for (const [index, group] of memberOfGroups.entries()) {
			for (const coll of groupCollectionSets[index] ?? []) {
				responses.push(
					yield* collectionMemberResponse(coll, group.principal.id, ctx),
				);
			}
		}
		return responses;
	},
);

export const principalResponses = Effect.fn("dav.propfind.principal")(
	function* (path: PrincipalPath, ctx: PropfindContext) {
		const acl = yield* AclService;
		yield* acl.check(
			ctx.actingPrincipalId,
			path.principalId,
			"principal",
			"DAV:read",
		);
		const principalPrivileges = yield* acl.currentUserPrivileges(
			ctx.actingPrincipalId,
			path.principalId,
			"principal",
		);
		const principalSvc = yield* PrincipalService;
		const principalRow = yield* principalSvc.findById(path.principalId);
		const displayName = principalRow.principal.displayName;
		const principalHref = `${ctx.origin}/dav/principals/${path.principalSeg}/`;

		// Resolved up front so the scheduling URLs are correct; reused at depth:1.
		const collSvc = yield* CollectionService;
		const ownCollections = yield* collSvc.listByOwner(path.principalId);
		const inboxHref = schedulingHref(
			ownCollections,
			"inbox",
			ctx.origin,
			path.principalSeg,
		);
		const outboxHref = schedulingHref(
			ownCollections,
			"outbox",
			ctx.origin,
			path.principalSeg,
		);

		// RFC 3744 §4.4: list the groups this principal belongs to.
		const groupSvc = yield* GroupService;
		const memberOfGroups = yield* groupSvc.listByMember(
			UserId(principalRow.user.id),
		);
		// RFC 4918 §15.1 DAV:creationdate — derived from the principal's UUIDv7.
		const principalCreated = creationDateFromId(principalRow.principal.id);

		const allProps: Record<ClarkName, unknown> = {
			[RESOURCETYPE]: { "{DAV:}principal": "" },
			...(displayName ? { [DISPLAYNAME]: displayName } : {}),
			...(principalCreated ? { [CREATIONDATE]: principalCreated } : {}),
			// RFC 5397 §3: the acting user's principal URL
			[CURRENT_USER_PRINCIPAL]: {
				[cn(DAV_NS, "href")]: ctx.actingPrincipalHref,
			},
			// RFC 3744 §4.2: canonical URL for this principal resource
			[PRINCIPAL_URL]: { [cn(DAV_NS, "href")]: principalHref },
			// RFC 4791 §6.2.1: calendar home — the collection whose members are
			// the principal's calendars. Points at the `/cal/` namespace level so
			// MKCALENDAR <home>/<name>/ (the universal client convention) lands on
			// a real, addressable collection (RFC 4918 §5.2).
			[CAL_HOME_SET]: { [cn(DAV_NS, "href")]: `${principalHref}cal/` },
			// RFC 6352 §7.1.1: addressbook home — analogous, at `/card/`.
			[CARD_HOME_SET]: { [cn(DAV_NS, "href")]: `${principalHref}card/` },
			// RFC 6638 §2.4.1: email addresses for attendee lookup
			[CAL_USER_ADDRESS_SET]: {
				[cn(DAV_NS, "href")]: `mailto:${principalRow.user.email}`,
			},
			// RFC 3744 §4.1: alternate URIs for this principal (e.g. mailto:)
			[DAV_ALTERNATE_URI_SET]: {
				[cn(DAV_NS, "href")]: `mailto:${principalRow.user.email}`,
			},
			// RFC 6638 §2.2: scheduling collection URLs. Omitted when the
			// principal has no provisioned inbox/outbox (e.g. a group principal).
			...(inboxHref
				? { [SCHEDULE_INBOX_URL]: { [cn(DAV_NS, "href")]: inboxHref } }
				: {}),
			...(outboxHref
				? { [SCHEDULE_OUTBOX_URL]: { [cn(DAV_NS, "href")]: outboxHref } }
				: {}),
			// RFC 7809 §5.1: timezone distribution service used by this server.
			// SHOULD NOT be returned in allprop per spec, but included here for
			// consistency with other live properties. Clients that request it
			// explicitly will always receive it.
			[TIMEZONE_SERVICE_SET]: {
				[cn(DAV_NS, "href")]: `${ctx.origin}/timezones`,
			},
			// RFC 3744 §4.4: groups this user belongs to. Single <D:group-membership>
			// element with one <D:href> child per group (not one wrapper per href).
			[DAV_GROUP_MEMBERSHIP]: {
				[cn(DAV_NS, "href")]: memberOfGroups.map(
					(g) => `${ctx.origin}/dav/groups/${g.principal.id}/`,
				),
			},
			// RFC 3744 §5.6: server operates grant-only, no-invert
			[ACL_RESTRICTIONS]: ACL_RESTRICTIONS_VALUE,
			// RFC 3744 §5.4: privileges the acting principal has on this resource
			[CURRENT_USER_PRIVILEGE_SET]: buildPrivilegeSet(principalPrivileges),
			// RFC 6638 §2.4.2: calendar user type (INDIVIDUAL, GROUP, etc.)
			[CAL_USER_TYPE]:
				principalRow.principal.principalType === "group"
					? "GROUP"
					: "INDIVIDUAL",
		};

		// DAV:acl — RFC 3744 §5.5: only when the caller holds read-acl.
		if (
			(principalPrivileges as ReadonlyArray<string>).includes("DAV:read-acl")
		) {
			const aces = yield* acl.getAces(path.principalId, "principal");
			allProps[DAV_ACL] = buildAclValue(aces, ctx.origin);
		}
		for (const [clark, xmlValue] of Object.entries(
			readDeadProperties(principalRow.principal.clientProperties),
		)) {
			allProps[clark as ClarkName] = xmlValue;
		}

		const responses: Array<DavResponse> = [
			{ href: principalHref, propstats: splitPropstats(allProps, ctx.request) },
		];
		if (ctx.depth === 1) {
			responses.push(
				...(yield* depthOneCollections(
					ownCollections,
					memberOfGroups,
					path,
					ctx,
				)),
			);
		}
		return responses;
	},
);
