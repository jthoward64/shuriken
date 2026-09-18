// ---------------------------------------------------------------------------
// PROPPATCH handler — RFC 4918 §9.2
//
// Supported path kinds:
//   collection  → update collection dead/live properties
//   instance    → update instance dead properties
//   principal   → update principal dead/live properties
//   new-collection / new-instance / root / principalCollection / wellknown → 404
//
// Atomicity (RFC 4918 §9.2.1): if any property fails, ALL fail.
//   - Protected or type-mismatched properties → 403
//   - Other properties in a failed request → 424 Failed Dependency
// ---------------------------------------------------------------------------

import { Effect, Option } from "effect";
import { extractTzidFromVtimezone } from "#src/data/icalendar/calendar-zone.ts";
import { type ClarkName, cn, type IrDeadProperties } from "#src/data/ir.ts";
import { APPLE_ICAL_NS } from "#src/domain/calendar-color.ts";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import {
	badRequest,
	forbidden,
	notFound,
	unauthorized,
} from "#src/domain/errors.ts";
import { CollectionId, isUuid, type PrincipalId } from "#src/domain/ids.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { encodeSegment } from "#src/http/dav/encode-segment.ts";
import { readDeadProperties } from "#src/http/dav/methods/dead-properties.ts";
import {
	isXmlNode,
	xmlChild,
	xmlPath,
} from "#src/http/dav/methods/xml-node.ts";
import { normalizeClarkNames } from "#src/http/dav/xml/clark.ts";
import type { DavResponse, Propstat } from "#src/http/dav/xml/multistatus.ts";
import { multistatusResponse } from "#src/http/dav/xml/multistatus.ts";
import { parseXml, readXmlBody } from "#src/http/dav/xml/parser.ts";
import { AclService } from "#src/services/acl/index.ts";
import { CollectionService } from "#src/services/collection/index.ts";
import { ExternalCalendarRepository } from "#src/services/external-calendar/repository.ts";
import { InstanceService } from "#src/services/instance/index.ts";
import { PrincipalService } from "#src/services/principal/service.ts";
import { IanaTimezoneService } from "#src/services/timezone/iana.ts";
import { CalTimezoneRepository } from "#src/services/timezone/index.ts";

const TRAILING_SLASH = /\/$/u;

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

const DAV_NS = "DAV:";
const CALDAV_NS = "urn:ietf:params:xml:ns:caldav";
const CARDDAV_NS = "urn:ietf:params:xml:ns:carddav";

// ---------------------------------------------------------------------------
// Protected properties — 403 cannot-modify-protected-property if set/removed
// ---------------------------------------------------------------------------

const PROTECTED_PROPS = new Set<ClarkName>([
	cn(DAV_NS, "resourcetype"),
	cn(DAV_NS, "getetag"),
	cn(DAV_NS, "getcontenttype"),
	cn(DAV_NS, "getlastmodified"),
	cn(DAV_NS, "sync-token"),
	cn(DAV_NS, "lockdiscovery"),
	cn(DAV_NS, "supportedlock"),
	cn(CALDAV_NS, "supported-calendar-component-set"),
]);

// ---------------------------------------------------------------------------
// Modifiable live properties on collections
// ---------------------------------------------------------------------------

// Maps Clark name → { DB field, required collection type ("any" = all types) }
const COLLECTION_LIVE_PROPS = new Map<
	ClarkName,
	{ field: "displayName" | "description"; collectionType: string | "any" }
>([
	[cn(DAV_NS, "displayname"), { field: "displayName", collectionType: "any" }],
	[
		cn(CALDAV_NS, "calendar-description"),
		{ field: "description", collectionType: "calendar" },
	],
	[
		cn(CARDDAV_NS, "addressbook-description"),
		{ field: "description", collectionType: "addressbook" },
	],
]);

// Clark names for timezone live properties (handled specially below).
const CALENDAR_TIMEZONE_PROP = cn(CALDAV_NS, "calendar-timezone");
// RFC 7809 §5.2 — TZID-only alternative to calendar-timezone
const CALENDAR_TIMEZONE_ID_PROP = cn(CALDAV_NS, "calendar-timezone-id");
// RFC 6638 §9.1 — schedule-calendar-transp (calendar/inbox/outbox collections)
const SCHEDULE_CALENDAR_TRANSP_PROP = cn(CALDAV_NS, "schedule-calendar-transp");
// RFC 6638 §9.2 — schedule-default-calendar-URL (inbox only)
const SCHEDULE_DEFAULT_CAL_URL_PROP = cn(
	CALDAV_NS,
	"schedule-default-calendar-URL",
);

// Apple's calendar-color, the one dead property a subscription claim mirrors
const APPLE_CALENDAR_COLOR = cn(APPLE_ICAL_NS, "calendar-color");

// Maps Clark name → DB field on principal
const PRINCIPAL_LIVE_PROPS = new Map<ClarkName, "displayName">([
	[cn(DAV_NS, "displayname"), "displayName"],
]);

// ---------------------------------------------------------------------------
// PROPPATCH body parsing
// ---------------------------------------------------------------------------

interface PropOp {
	/** Properties to set: Clark name → parsed value. */
	readonly set: ReadonlyMap<ClarkName, unknown>;
	/** Properties to remove (may overlap with set — set wins per RFC 4918). */
	readonly remove: ReadonlySet<ClarkName>;
}

/** Normalize a value that may be a single item or an array into an array. */
const toArray = (v: unknown): ReadonlyArray<unknown> => {
	if (v === undefined || v === null) {
		return [];
	}
	if (Array.isArray(v)) {
		return v;
	}
	return [v];
};

/** Reads the Clark-named children of every `<D:prop>` under one operation element */
const collectPropEntries = (
	update: Record<string, unknown>,
	operation: ClarkName,
): ReadonlyArray<readonly [ClarkName, unknown]> => {
	const entries: Array<readonly [ClarkName, unknown]> = [];
	for (const opEl of toArray(update[operation])) {
		const prop = isXmlNode(opEl)
			? xmlChild(opEl, cn(DAV_NS, "prop"))
			: undefined;
		if (prop === undefined) {
			continue;
		}
		for (const [key, value] of Object.entries(prop)) {
			if (!key.startsWith("@_")) {
				entries.push([key as ClarkName, value]);
			}
		}
	}
	return entries;
};

/** Splits a DAV:propertyupdate document into its set and remove operations */
const extractPropOps = (tree: unknown): PropOp => {
	const update = xmlPath(tree, cn(DAV_NS, "propertyupdate"));
	if (update === undefined) {
		return { set: new Map(), remove: new Set() };
	}
	return {
		set: new Map(collectPropEntries(update, cn(DAV_NS, "set"))),
		remove: new Set(
			collectPropEntries(update, cn(DAV_NS, "remove")).map(([key]) => key),
		),
	};
};

const parseProppatchDocument = (
	body: string,
): Effect.Effect<PropOp, DavError> =>
	parseXml(body).pipe(
		Effect.map((raw) => extractPropOps(normalizeClarkNames(raw))),
		Effect.catchTag("XmlParseError", () =>
			Effect.fail(badRequest("Invalid PROPPATCH XML")),
		),
	);

const parseProppatchBody = (req: Request): Effect.Effect<PropOp, DavError> =>
	readXmlBody(req).pipe(
		Effect.flatMap((body) =>
			body.trim() === ""
				? Effect.fail(forbidden(undefined, "Empty PROPPATCH body"))
				: parseProppatchDocument(body),
		),
	);

/** A property value that may be plain text or an element carrying character data */
const textValue = (rawVal: unknown): string => {
	if (typeof rawVal === "string") {
		return rawVal.trim();
	}
	return isXmlNode(rawVal) && "#text" in rawVal
		? String(rawVal["#text"]).trim()
		: "";
};

/** Applies the set/remove operations for the given names to a dead-property map */
const applyDeadProps = (
	current: IrDeadProperties,
	names: Iterable<ClarkName>,
	ops: PropOp,
): IrDeadProperties => {
	const next: Record<ClarkName, unknown> = { ...current };
	for (const name of names) {
		if (ops.set.has(name)) {
			next[name] = ops.set.get(name);
		} else {
			delete next[name];
		}
	}
	return next;
};

/** The value a live property is being set to, or null when it is being removed */
const liveValue = (ops: PropOp, name: ClarkName): string | null => {
	const value = ops.set.has(name) ? (ops.set.get(name) ?? null) : null;
	return value !== null ? String(value) : null;
};

// ---------------------------------------------------------------------------
// Propstat builders
// ---------------------------------------------------------------------------

const buildSuccessPropstats = (
	allNames: ReadonlyArray<ClarkName>,
): ReadonlyArray<Propstat> => {
	const props: Record<ClarkName, unknown> = {};
	for (const name of allNames) {
		props[name] = "";
	}
	return [{ props, status: 200 }];
};

const buildFailurePropstats = (
	allNames: ReadonlyArray<ClarkName>,
	failedNames: ReadonlySet<ClarkName>,
): ReadonlyArray<Propstat> => {
	const failed: Record<ClarkName, unknown> = {};
	const dependent: Record<ClarkName, unknown> = {};
	for (const name of allNames) {
		if (failedNames.has(name)) {
			failed[name] = "";
		} else {
			dependent[name] = "";
		}
	}
	const propstats: Array<Propstat> = [{ props: failed, status: 403 }];
	if (Object.keys(dependent).length > 0) {
		propstats.push({ props: dependent, status: 424 });
	}
	return propstats;
};

/** The single-resource multistatus every PROPPATCH branch answers with */
const proppatchResponse = (
	href: string,
	propstats: ReadonlyArray<Propstat>,
): Effect.Effect<Response, DavError> =>
	multistatusResponse([{ href, propstats } satisfies DavResponse]);

/** What every PROPPATCH branch needs beyond the resolved path */
interface ProppatchRequest {
	readonly actingPrincipalId: PrincipalId;
	readonly origin: string;
	readonly ops: PropOp;
	readonly allNames: ReadonlyArray<ClarkName>;
}

// ---------------------------------------------------------------------------
// Collection PROPPATCH
// ---------------------------------------------------------------------------

type LiveField = "displayName" | "description";

/** How the requested properties divide up for one collection */
interface CollectionPropPlan {
	readonly failedNames: ReadonlySet<ClarkName>;
	readonly liveFields: ReadonlyMap<ClarkName, LiveField>;
	readonly deadNames: ReadonlySet<ClarkName>;
}

// Collection types each specially-handled live property is valid on
const COLLECTION_TYPE_SCOPES: ReadonlyMap<
	ClarkName,
	ReadonlySet<string>
> = new Map([
	[CALENDAR_TIMEZONE_PROP, new Set(["calendar"])],
	[CALENDAR_TIMEZONE_ID_PROP, new Set(["calendar"])],
	[SCHEDULE_CALENDAR_TRANSP_PROP, new Set(["calendar", "inbox", "outbox"])],
	[SCHEDULE_DEFAULT_CAL_URL_PROP, new Set(["inbox"])],
]);

/** Sorts the requested names into protected, live-field and dead-property buckets */
const classifyCollectionProps = (
	allNames: ReadonlyArray<ClarkName>,
	collectionType: string,
): CollectionPropPlan => {
	const failedNames = new Set<ClarkName>();
	const liveFields = new Map<ClarkName, LiveField>();
	const deadNames = new Set<ClarkName>();

	for (const name of allNames) {
		const scope = COLLECTION_TYPE_SCOPES.get(name);
		const live = COLLECTION_LIVE_PROPS.get(name);
		if (PROTECTED_PROPS.has(name)) {
			failedNames.add(name);
		} else if (scope !== undefined) {
			// The timezone and scheduling properties are applied separately below
			if (!scope.has(collectionType)) {
				failedNames.add(name);
			}
		} else if (live === undefined) {
			deadNames.add(name);
		} else if (
			live.collectionType !== "any" &&
			collectionType !== live.collectionType
		) {
			// Property is valid but not for this collection type
			failedNames.add(name);
		} else {
			liveFields.set(name, live.field);
		}
	}
	return { failedNames, liveFields, deadNames };
};

/** calendar-timezone-id carries a bare TZID, validated against the IANA database */
const resolveTimezoneId = Effect.fn("dav.proppatch.timezoneId")(function* (
	rawVal: unknown,
) {
	const tzid = textValue(rawVal);
	if (tzid === "") {
		return;
	}
	const ianaSvc = yield* IanaTimezoneService;
	if (!ianaSvc.isKnownTzid(tzid)) {
		return yield* forbidden("CALDAV:valid-calendar-timezone");
	}
	// Upsert the IANA VTIMEZONE into the cache.
	const vtOpt = ianaSvc.getVtimezone(tzid);
	if (Option.isSome(vtOpt)) {
		const tzRepo = yield* CalTimezoneRepository;
		yield* tzRepo.upsert(tzid, vtOpt.value, Option.none(), Option.none());
	}
	return tzid;
});

/**
 * CALDAV:calendar-timezone (RFC 4791 §5.2.2) and CALDAV:calendar-timezone-id
 * (RFC 7809 §5.2) both drive the same timezoneTzid field; calendar-timezone wins
 * when both are present because it carries the full VTIMEZONE data. Setting
 * either also upserts the VTIMEZONE into cal_timezone so the cache is populated
 * from PROPPATCH, not only from PUT.
 */
const resolveTimezone = Effect.fn("dav.proppatch.timezone")(function* (
	ops: PropOp,
) {
	if (ops.set.has(CALENDAR_TIMEZONE_PROP)) {
		const rawVal = ops.set.get(CALENDAR_TIMEZONE_PROP);
		const valStr = typeof rawVal === "string" ? rawVal : "";
		const tzid = extractTzidFromVtimezone(valStr);
		if (tzid !== null && valStr !== "") {
			// Upsert the client-provided VTIMEZONE into the cache.
			const tzRepo = yield* CalTimezoneRepository;
			yield* tzRepo.upsert(tzid, valStr, Option.none(), Option.none());
		}
		return tzid;
	}
	if (ops.set.has(CALENDAR_TIMEZONE_ID_PROP)) {
		return yield* resolveTimezoneId(ops.set.get(CALENDAR_TIMEZONE_ID_PROP));
	}
	return ops.remove.has(CALENDAR_TIMEZONE_PROP) ||
		ops.remove.has(CALENDAR_TIMEZONE_ID_PROP)
		? null
		: undefined;
});

/** RFC 6638 §9.1: the value is an element, either <C:opaque/> or <C:transparent/> */
const resolveScheduleTransp = (
	ops: PropOp,
): "opaque" | "transparent" | null | undefined => {
	if (!ops.set.has(SCHEDULE_CALENDAR_TRANSP_PROP)) {
		// Removing it resets the collection to the default "opaque"
		return ops.remove.has(SCHEDULE_CALENDAR_TRANSP_PROP) ? null : undefined;
	}
	const rawVal = ops.set.get(SCHEDULE_CALENDAR_TRANSP_PROP);
	if (!isXmlNode(rawVal)) {
		return undefined;
	}
	if (`{${CALDAV_NS}}opaque` in rawVal) {
		return "opaque";
	}
	return `{${CALDAV_NS}}transparent` in rawVal ? "transparent" : undefined;
};

/** RFC 6638 §9.2: the value wraps a DAV:href naming a calendar the principal owns */
const resolveScheduleDefaultCalendar = Effect.fn(
	"dav.proppatch.defaultCalendar",
)(function* (
	ops: PropOp,
	ownerPrincipalId: PrincipalId,
): Generator<
	Effect.Effect<unknown, DavError | DatabaseError, CollectionService>,
	CollectionId | null | undefined
> {
	if (!ops.set.has(SCHEDULE_DEFAULT_CAL_URL_PROP)) {
		return ops.remove.has(SCHEDULE_DEFAULT_CAL_URL_PROP) ? null : undefined;
	}
	const rawVal = ops.set.get(SCHEDULE_DEFAULT_CAL_URL_PROP);
	const hrefStr = isXmlNode(rawVal)
		? String(rawVal[`{${DAV_NS}}href`] ?? "")
		: "";
	// The last non-empty path segment is the collection UUID
	const lastSeg = hrefStr.replace(TRAILING_SLASH, "").split("/").at(-1) ?? "";
	if (!isUuid(lastSeg)) {
		return undefined;
	}
	// Look up the collection to validate it exists and belongs to this principal.
	const collSvc = yield* CollectionService;
	const targetOpt = yield* collSvc
		.findById(CollectionId(lastSeg))
		.pipe(Effect.option);
	return Option.match(targetOpt, {
		onNone: () => undefined,
		onSome: (target) =>
			target.collectionType === "calendar" &&
			target.ownerPrincipalId === ownerPrincipalId
				? CollectionId(lastSeg)
				: undefined,
	});
});

/**
 * Policy B for subscribed collections: PROPPATCH of displayname or
 * calendar-color writes the new value into the claim's override columns.
 * Otherwise the next sync pass would re-apply
 * `external_calendar.default_displayname` and clobber the user's edit. The
 * collection row's own column is still updated by the caller for immediate read
 * consistency; the next sync sees the override and keeps the same value.
 */
const syncSubscriptionOverrides = Effect.fn("dav.proppatch.subscription")(
	function* (
		collectionId: CollectionId,
		ops: PropOp,
		newDisplayName: string | null | undefined,
	) {
		const extRepo = yield* ExternalCalendarRepository;
		const claimOpt = yield* extRepo.findClaimByCollection(collectionId);
		if (Option.isNone(claimOpt)) {
			return;
		}
		const colorPatch = ops.set.has(APPLE_CALENDAR_COLOR)
			? { colorOverride: String(ops.set.get(APPLE_CALENDAR_COLOR)) }
			: ops.remove.has(APPLE_CALENDAR_COLOR)
				? { colorOverride: null }
				: {};
		const namePatch =
			newDisplayName !== undefined
				? { displaynameOverride: newDisplayName }
				: {};
		if (
			Object.keys(colorPatch).length > 0 ||
			Object.keys(namePatch).length > 0
		) {
			yield* extRepo.updateClaim(claimOpt.value.id, {
				...colorPatch,
				...namePatch,
			});
		}
	},
);

const proppatchCollection = Effect.fn("dav.proppatch.collection")(function* (
	path: Extract<ResolvedDavPath, { kind: "collection" }>,
	{ actingPrincipalId, origin, ops, allNames }: ProppatchRequest,
) {
	const acl = yield* AclService;
	yield* acl.check(
		actingPrincipalId,
		path.collectionId,
		"collection",
		"DAV:write-properties",
	);

	const collSvc = yield* CollectionService;
	const collRow = yield* collSvc.findById(path.collectionId);
	const plan = classifyCollectionProps(allNames, collRow.collectionType);

	const href = `${origin}/dav/principals/${path.principalSeg}/${path.namespace}/${path.collectionSeg}/`;
	if (plan.failedNames.size > 0) {
		return yield* proppatchResponse(
			href,
			buildFailurePropstats(allNames, plan.failedNames),
		);
	}

	const newDead = applyDeadProps(
		readDeadProperties(collRow.clientProperties),
		plan.deadNames,
		ops,
	);

	let newDisplayName: string | null | undefined;
	let newDescription: string | null | undefined;
	for (const [name, field] of plan.liveFields) {
		if (field === "displayName") {
			newDisplayName = liveValue(ops, name);
		} else {
			newDescription = liveValue(ops, name);
		}
	}

	const newTimezoneTzid =
		collRow.collectionType === "calendar"
			? yield* resolveTimezone(ops)
			: undefined;
	const newScheduleTransp = resolveScheduleTransp(ops);
	const newScheduleDefaultCalendarId = yield* resolveScheduleDefaultCalendar(
		ops,
		path.principalId,
	);

	yield* syncSubscriptionOverrides(path.collectionId, ops, newDisplayName);

	yield* collSvc.updateProperties(path.collectionId, {
		clientProperties: newDead,
		...(newDisplayName !== undefined ? { displayName: newDisplayName } : {}),
		...(newDescription !== undefined ? { description: newDescription } : {}),
		...(newTimezoneTzid !== undefined ? { timezoneTzid: newTimezoneTzid } : {}),
		...(newScheduleTransp !== undefined
			? { scheduleTransp: newScheduleTransp }
			: {}),
		...(newScheduleDefaultCalendarId !== undefined
			? { scheduleDefaultCalendarId: newScheduleDefaultCalendarId }
			: {}),
	});

	return yield* proppatchResponse(href, buildSuccessPropstats(allNames));
});

// ---------------------------------------------------------------------------
// Instance PROPPATCH
// ---------------------------------------------------------------------------

const proppatchInstance = Effect.fn("dav.proppatch.instance")(function* (
	path: Extract<ResolvedDavPath, { kind: "instance" }>,
	{ actingPrincipalId, origin, ops, allNames }: ProppatchRequest,
) {
	const acl = yield* AclService;
	yield* acl.check(
		actingPrincipalId,
		path.instanceId,
		"instance",
		"DAV:write-properties",
	);

	const instSvc = yield* InstanceService;
	const instRow = yield* instSvc.findById(path.instanceId);

	const failedNames = new Set(allNames.filter((n) => PROTECTED_PROPS.has(n)));
	const href = `${origin}/dav/principals/${path.principalSeg}/${path.namespace}/${path.collectionSeg}/${encodeSegment(path.instanceSeg)}`;
	if (failedNames.size > 0) {
		return yield* proppatchResponse(
			href,
			buildFailurePropstats(allNames, failedNames),
		);
	}

	yield* instSvc.updateClientProperties(
		path.instanceId,
		applyDeadProps(readDeadProperties(instRow.clientProperties), allNames, ops),
	);

	return yield* proppatchResponse(href, buildSuccessPropstats(allNames));
});

// ---------------------------------------------------------------------------
// Principal PROPPATCH
// ---------------------------------------------------------------------------

// A collectionHome path carries the same principal identity and is patched as one
const proppatchPrincipal = Effect.fn("dav.proppatch.principal")(function* (
	path: Extract<ResolvedDavPath, { kind: "principal" | "collectionHome" }>,
	{ actingPrincipalId, origin, ops, allNames }: ProppatchRequest,
) {
	const acl = yield* AclService;
	yield* acl.check(
		actingPrincipalId,
		path.principalId,
		"principal",
		"DAV:write-properties",
	);

	const principalSvc = yield* PrincipalService;
	const principalWithUser = yield* principalSvc.findById(path.principalId);
	const principalRow = principalWithUser.principal;

	const failedNames = new Set<ClarkName>();
	const liveNames = new Set<ClarkName>();
	const deadNames = new Set<ClarkName>();
	for (const name of allNames) {
		if (PROTECTED_PROPS.has(name)) {
			failedNames.add(name);
		} else if (PRINCIPAL_LIVE_PROPS.has(name)) {
			liveNames.add(name);
		} else {
			deadNames.add(name);
		}
	}

	const href = `${origin}/dav/principals/${path.principalSeg}/`;
	if (failedNames.size > 0) {
		return yield* proppatchResponse(
			href,
			buildFailurePropstats(allNames, failedNames),
		);
	}

	let newDisplayName: string | null | undefined;
	for (const name of liveNames) {
		newDisplayName = liveValue(ops, name);
	}

	yield* principalSvc.updateProperties(path.principalId, {
		clientProperties: applyDeadProps(
			readDeadProperties(principalRow.clientProperties),
			deadNames,
			ops,
		),
		...(newDisplayName !== undefined ? { displayName: newDisplayName } : {}),
	});

	return yield* proppatchResponse(href, buildSuccessPropstats(allNames));
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const proppatchHandler = (
	path: ResolvedDavPath,
	ctx: HttpRequestContext,
	req: Request,
): Effect.Effect<
	Response,
	DavError | DatabaseError,
	| CollectionService
	| InstanceService
	| AclService
	| PrincipalService
	| ExternalCalendarRepository
	| IanaTimezoneService
	| CalTimezoneRepository
> =>
	Effect.gen(function* () {
		if (
			path.kind === "new-collection" ||
			path.kind === "new-instance" ||
			path.kind === "root" ||
			path.kind === "principalCollection" ||
			path.kind === "wellknown" ||
			path.kind === "userCollection" ||
			path.kind === "user" ||
			path.kind === "newUser" ||
			path.kind === "groupCollection" ||
			path.kind === "group" ||
			path.kind === "newGroup" ||
			path.kind === "groupMembers" ||
			path.kind === "groupMember" ||
			path.kind === "groupMemberNonExistent" ||
			path.kind === "unknownPrincipal"
		) {
			return yield* notFound();
		}

		if (ctx.auth._tag !== "Authenticated") {
			return yield* unauthorized();
		}
		const actingPrincipalId = ctx.auth.principal.principalId;

		const ops = yield* parseProppatchBody(req);
		const origin = ctx.url.origin;

		// All names in request order: set first, then removes not already in set
		const allNames: Array<ClarkName> = [
			...ops.set.keys(),
			...[...ops.remove].filter((n) => !ops.set.has(n)),
		];

		const request: ProppatchRequest = {
			actingPrincipalId,
			origin,
			ops,
			allNames,
		};
		if (path.kind === "collection") {
			return yield* proppatchCollection(path, request);
		}
		if (path.kind === "instance") {
			return yield* proppatchInstance(path, request);
		}
		return yield* proppatchPrincipal(path, request);
	});
