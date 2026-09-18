// ---------------------------------------------------------------------------
// Collection PROPFIND — the collection itself plus its depth:1 members
// ---------------------------------------------------------------------------

import { Effect, Option } from "effect";
import { encodeICalendar } from "#src/data/icalendar/codec.ts";
import { redactDocumentToBusyOnly } from "#src/data/icalendar/visibility.ts";
import { type ClarkName, cn, type IrDocument } from "#src/data/ir.ts";
import { encodeVCard } from "#src/data/vcard/codec.ts";
import type { EntityId } from "#src/domain/ids.ts";
import { InstanceId } from "#src/domain/ids.ts";
import type { DavPrivilege } from "#src/domain/types/dav.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import {
	buildInstanceProps,
	splitPropstats,
} from "#src/http/dav/methods/instance-props.ts";
import type { DavResponse } from "#src/http/dav/xml/multistatus.ts";
import { AclService } from "#src/services/acl/index.ts";
import type { AclResourceId } from "#src/services/acl/service.ts";
import { CollectionService } from "#src/services/collection/index.ts";
import {
	applyReadOnlyPrivileges,
	isReadOnlyCollectionRow,
} from "#src/services/collection/read-only-guard.ts";
import type { CollectionRow } from "#src/services/collection/repository.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { InstanceService } from "#src/services/instance/index.ts";
import type { InstanceRow } from "#src/services/instance/repository.ts";
import { CalTimezoneRepository } from "#src/services/timezone/index.ts";
import { buildAclValue, buildPrivilegeSet } from "./acl-props.ts";
import { buildCollectionProps } from "./collection-props.ts";
import type { PropfindContext } from "./context.ts";
import { collectionHref, memberInstanceHref } from "./href.ts";
import {
	CAL_SUPPORTED_COLLATION_SET,
	CAL_SUPPORTED_COLLATIONS,
	CALENDAR_TIMEZONE,
	CALENDAR_TIMEZONE_ID,
	CARD_SUPPORTED_COLLATION_SET,
	CARD_SUPPORTED_COLLATIONS,
	CURRENT_USER_PRINCIPAL,
	CURRENT_USER_PRIVILEGE_SET,
	DAV_ACL,
	DAV_NS,
	DAV_OWNER,
} from "./ns.ts";
import {
	dataClarkForNamespace,
	documentFor,
	entityTypeForDataClark,
} from "./parse.ts";

type CollectionPath = Extract<ResolvedDavPath, { kind: "collection" }>;

/**
 * CALDAV:calendar-timezone (RFC 4791 §5.2.2) and its RFC 7809 §5.2 TZID
 * shorthand, emitted only when the calendar has a timezone set.
 */
const addTimezoneProps = Effect.fn("dav.propfind.collectionTimezone")(
	function* (props: Record<ClarkName, unknown>, collRow: CollectionRow) {
		if (collRow.collectionType !== "calendar" || !collRow.timezoneTzid) {
			return;
		}
		const tzRepo = yield* CalTimezoneRepository;
		const tzOpt = yield* tzRepo.findByTzid(collRow.timezoneTzid);
		const tzData = Option.getOrUndefined(tzOpt);
		if (tzData !== undefined) {
			props[CALENDAR_TIMEZONE] = tzData.vtimezoneData;
		}
		// calendar-timezone-id is the TZID string; always present when timezone is set.
		props[CALENDAR_TIMEZONE_ID] = collRow.timezoneTzid;
	},
);

/** What the depth:1 member loop resolved once for the whole collection */
interface MemberBatch {
	readonly privMap: ReadonlyMap<AclResourceId, ReadonlyArray<DavPrivilege>>;
	/** Set only when the request explicitly names the body-data property */
	readonly data:
		| {
				readonly clark: ClarkName;
				readonly entityType: "vcard" | "icalendar";
				readonly trees: ReadonlyMap<EntityId, IrDocument["root"]>;
		  }
		| undefined;
	readonly aclMightBeNeeded: boolean;
}

/**
 * Resolve everything the depth:1 members share in one pass: the inherited
 * privilege set (one ancestor walk plus one batched query instead of a walk per
 * instance) and, when the request names it, every member's component tree in
 * three queries instead of three per instance.
 */
const prepareMemberBatch = Effect.fn("dav.propfind.memberBatch")(function* (
	path: CollectionPath,
	instances: ReadonlyArray<InstanceRow>,
	ctx: PropfindContext,
) {
	const acl = yield* AclService;
	const privMap = yield* acl.batchMemberPrivileges(ctx.actingPrincipalId, {
		parentId: path.collectionId,
		parentType: "collection",
		memberIds: instances.map((inst) => InstanceId(inst.id)),
		memberType: "instance",
	});

	// DAV:acl is part of allprop/propname output (when read-acl is held), but for
	// an explicit `prop` request it is only emitted when named — so the getAces
	// fetch can be skipped entirely otherwise.
	const aclMightBeNeeded =
		ctx.request.type !== "prop" || ctx.request.names.has(DAV_ACL);

	// RFC 4791 §9.6 / RFC 6352 §10.4 — body-data is only emitted for an explicit
	// `prop` request that names it (never allprop/propname).
	const clark = Option.getOrUndefined(dataClarkForNamespace(path.namespace));
	if (
		clark === undefined ||
		ctx.request.type !== "prop" ||
		!ctx.request.names.has(clark)
	) {
		return { privMap, data: undefined, aclMightBeNeeded } satisfies MemberBatch;
	}

	const entityType = entityTypeForDataClark(clark);
	const compRepo = yield* ComponentRepository;
	const trees = yield* compRepo.loadTreesByIds(
		instances.map((inst) => inst.entityId as unknown as EntityId),
		entityType,
	);
	return {
		privMap,
		data: { clark, entityType, trees },
		aclMightBeNeeded,
	} satisfies MemberBatch;
});

/** Serialises a member's body-data, redacting it for a free-busy-only caller */
const encodeMemberData = Effect.fn("dav.propfind.memberData")(function* (
	inst: InstanceRow,
	batch: MemberBatch,
	hasFullRead: boolean,
) {
	// Free-busy-only access has no meaning for CardDAV contacts — omit
	// address-data entirely rather than leak the full vCard.
	if (
		batch.data === undefined ||
		(!hasFullRead && batch.data.entityType !== "icalendar")
	) {
		return Option.none<string>();
	}
	const tree = batch.data.trees.get(inst.entityId as unknown as EntityId);
	if (tree === undefined) {
		return Option.none<string>();
	}
	const loaded = documentFor(batch.data.entityType, tree);
	const doc = hasFullRead ? loaded : redactDocumentToBusyOnly(loaded);
	return Option.some(
		yield* batch.data.entityType === "icalendar"
			? encodeICalendar(doc)
			: encodeVCard(doc),
	);
});

/** Builds the depth:1 response for one member instance of the collection */
const memberResponse = Effect.fn("dav.propfind.collectionMember")(function* (
	inst: InstanceRow,
	path: CollectionPath,
	ctx: PropfindContext,
	state: {
		readonly batch: MemberBatch;
		readonly ownerHref: string;
		readonly readOnly: boolean;
	},
) {
	const { batch, ownerHref, readOnly } = state;
	const instPrivileges = batch.privMap.get(InstanceId(inst.id)) ?? [];
	const hasFullRead = (instPrivileges as ReadonlyArray<string>).includes(
		"DAV:read",
	);
	const live: Record<ClarkName, unknown> = {
		[CURRENT_USER_PRINCIPAL]: { [cn(DAV_NS, "href")]: ctx.actingPrincipalHref },
		[CURRENT_USER_PRIVILEGE_SET]: buildPrivilegeSet(
			applyReadOnlyPrivileges(instPrivileges, readOnly),
		),
		// RFC 3744 §5.1: owner inherited from the parent collection
		[DAV_OWNER]: { [cn(DAV_NS, "href")]: ownerHref },
	};

	const data = yield* encodeMemberData(inst, batch, hasFullRead);
	if (batch.data !== undefined) {
		const clark = batch.data.clark;
		Option.map(data, (body) => {
			live[clark] = body;
		});
	}
	// DAV:acl — RFC 3744 §5.5: only when the caller holds read-acl.
	if (
		batch.aclMightBeNeeded &&
		(instPrivileges as ReadonlyArray<string>).includes("DAV:read-acl")
	) {
		const acl = yield* AclService;
		const instAces = yield* acl.getAces(InstanceId(inst.id), "instance");
		live[DAV_ACL] = buildAclValue(instAces, ctx.origin);
	}

	return {
		href: memberInstanceHref(
			{
				origin: ctx.origin,
				principalSeg: path.principalSeg,
				ns: path.namespace,
				collectionSeg: path.collectionSeg,
			},
			inst,
		),
		propstats: splitPropstats(buildInstanceProps(inst, live), ctx.request),
	} satisfies DavResponse;
});

export const collectionResponses = Effect.fn("dav.propfind.collection")(
	function* (path: CollectionPath, ctx: PropfindContext) {
		const acl = yield* AclService;
		yield* acl.check(
			ctx.actingPrincipalId,
			path.collectionId,
			"collection",
			"CALDAV:read-free-busy",
		);
		const collectionPrivileges = yield* acl.currentUserPrivileges(
			ctx.actingPrincipalId,
			path.collectionId,
			"collection",
		);
		const collSvc = yield* CollectionService;
		const collRow = yield* collSvc.findById(path.collectionId);
		// Subscription (ICS feed) and auto-managed (birthdays) calendars are
		// writable in the ACL — the caller owns them — but the server rejects
		// content writes. Hide the write privileges so clients render them
		// read-only instead of offering an edit that will 403. The same status
		// applies to every member instance below.
		const collReadOnly = yield* isReadOnlyCollectionRow(collRow);
		const href = collectionHref(
			ctx.origin,
			path.principalSeg,
			path.namespace,
			path.collectionSeg,
		);
		const ownerHref = `${ctx.origin}/dav/principals/${collRow.ownerPrincipalId}/`;
		const collProps = buildCollectionProps(collRow, {
			origin: ctx.origin,
			privileges: applyReadOnlyPrivileges(collectionPrivileges, collReadOnly),
			actingPrincipalHref: ctx.actingPrincipalHref,
		});
		yield* addTimezoneProps(collProps, collRow);

		// Collation sets — RFC 4791 §5.2.10 / RFC 6352 §6.2.3
		if (collRow.collectionType === "calendar") {
			collProps[CAL_SUPPORTED_COLLATION_SET] = CAL_SUPPORTED_COLLATIONS;
		} else if (collRow.collectionType === "addressbook") {
			collProps[CARD_SUPPORTED_COLLATION_SET] = CARD_SUPPORTED_COLLATIONS;
		}

		// DAV:acl — RFC 3744 §5.5: only when the caller holds read-acl.
		if (
			(collectionPrivileges as ReadonlyArray<string>).includes("DAV:read-acl")
		) {
			const aces = yield* acl.getAces(path.collectionId, "collection");
			collProps[DAV_ACL] = buildAclValue(aces, ctx.origin);
		}

		const responses: Array<DavResponse> = [
			{ href, propstats: splitPropstats(collProps, ctx.request) },
		];
		if (ctx.depth === 0) {
			return responses;
		}

		const instSvc = yield* InstanceService;
		const instances = yield* instSvc.listByCollection(path.collectionId);
		const batch = yield* prepareMemberBatch(path, instances, ctx);
		for (const inst of instances) {
			responses.push(
				yield* memberResponse(inst, path, ctx, {
					batch,
					ownerHref,
					readOnly: collReadOnly,
				}),
			);
		}
		return responses;
	},
);
