// ---------------------------------------------------------------------------
// PROPFIND handler — RFC 4918 §9.1
//
// Supported path kinds:
//   collection      → collection properties + (Depth:1) instance members
//   collectionHome  → per-type home (e.g. /cal/) + (Depth:1) typed collections
//   instance        → instance properties only
//   principal       → minimal home-set properties
//   new-collection / new-instance → 404
//   principalCollection / wellknown → 404 (router handles well-known redirect before PROPFIND)
//
// Depth: infinity is rejected with 403 DAV:propfind-finite-depth (RFC 4918 §9.1).
// Missing Depth header is treated as "infinity" per RFC 4918 §9.1 → also 403.
// (Clients that want a single-level response must send Depth: 0 or Depth: 1.)
// ---------------------------------------------------------------------------

import { Effect, Option } from "effect";
import { Temporal } from "temporal-polyfill";
import { encodeICalendar } from "#src/data/icalendar/codec.ts";
import {
	type ClarkName,
	cn,
	type IrDeadProperties,
	type IrDocument,
} from "#src/data/ir.ts";
import { encodeVCard } from "#src/data/vcard/codec.ts";
import type {
	DatabaseError,
	DavError,
	XmlParseError,
} from "#src/domain/errors.ts";
import {
	badRequest,
	forbidden,
	notFound,
	unauthorized,
} from "#src/domain/errors.ts";
import {
	CollectionId,
	type EntityId,
	GroupId,
	InstanceId,
	PrincipalId,
	UserId,
} from "#src/domain/ids.ts";
import {
	COLLECTION_TYPE_TO_NAMESPACE,
	type CollectionNamespace,
} from "#src/domain/types/collection-namespace.ts";
import type { DavPrivilege } from "#src/domain/types/dav.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { encodeSegment } from "#src/http/dav/encode-segment.ts";
import {
	buildInstanceProps,
	creationDateFromId,
	type PropfindKind,
	splitPropstats,
	toRfc1123,
} from "#src/http/dav/methods/instance-props.ts";
import { normalizeClarkNames } from "#src/http/dav/xml/clark.ts";
import type { DavResponse } from "#src/http/dav/xml/multistatus.ts";
import { multistatusResponse } from "#src/http/dav/xml/multistatus.ts";
import { parseXml, readXmlBody } from "#src/http/dav/xml/parser.ts";
import { AclService } from "#src/services/acl/index.ts";
import type { AceRow } from "#src/services/acl/repository.ts";
import { CollectionService } from "#src/services/collection/index.ts";
import {
	applyReadOnlyPrivileges,
	isReadOnlyCollectionRow,
} from "#src/services/collection/read-only-guard.ts";
import type { CollectionRow } from "#src/services/collection/repository.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import type { ExternalCalendarRepository } from "#src/services/external-calendar/repository.ts";
import { GroupService } from "#src/services/group/index.ts";
import { InstanceService } from "#src/services/instance/index.ts";
import type { InstanceRow } from "#src/services/instance/repository.ts";
import { PrincipalRepository } from "#src/services/principal/index.ts";
import { PrincipalService } from "#src/services/principal/service.ts";
import { CalTimezoneRepository } from "#src/services/timezone/index.ts";

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

const DAV_NS = "DAV:";
const CALDAV_NS = "urn:ietf:params:xml:ns:caldav";
const CARDDAV_NS = "urn:ietf:params:xml:ns:carddav";

// Well-known Clark keys
const RESOURCETYPE = cn(DAV_NS, "resourcetype");
const DISPLAYNAME = cn(DAV_NS, "displayname");
const GETLASTMODIFIED = cn(DAV_NS, "getlastmodified");
const GETETAG = cn(DAV_NS, "getetag");
const CREATIONDATE = cn(DAV_NS, "creationdate");
const SYNC_TOKEN = cn(DAV_NS, "sync-token");
// calendarserver-org `getctag` — older change-detection token, equivalent to
// sync-token but widely required by Apple/Thunderbird/DAVx5 clients.
const CALENDARSERVER_NS = "http://calendarserver.org/ns/";
const GETCTAG = cn(CALENDARSERVER_NS, "getctag");
// Apple's `{http://apple.com/ns/ical/}calendar-color` — widely used dead prop
// for picking the calendar's tile colour in client UIs.
const APPLE_ICAL_NS = "http://apple.com/ns/ical/";
const CALENDAR_COLOR = cn(APPLE_ICAL_NS, "calendar-color");

// Default-color palette (12 entries). When a calendar collection has no
// client-supplied calendar-color dead property, we emit a deterministic pick
// from this palette so client UIs render distinct tiles instead of "no
// colour" placeholders. Values are RGB with full alpha (#RRGGBBAA per Apple's
// convention).
const DEFAULT_CALENDAR_COLORS: ReadonlyArray<string> = [
	"#F44336FF",
	"#FF9800FF",
	"#FFC107FF",
	"#4CAF50FF",
	"#009688FF",
	"#03A9F4FF",
	"#3F51B5FF",
	"#9C27B0FF",
	"#E91E63FF",
	"#795548FF",
	"#607D8BFF",
	"#FF5722FF",
];

/**
 * Pick a deterministic default colour for a calendar collection. Hashes the
 * collection UUID's hex digits into the palette index so the same calendar
 * always renders with the same colour, but different calendars get spread
 * across the palette.
 */
const defaultCalendarColor = (id: string): string => {
	let sum = 0;
	const hexRadix = 16;
	for (const ch of id.replaceAll("-", "")) {
		const n = Number.parseInt(ch, hexRadix);
		if (Number.isFinite(n)) {
			sum += n;
		}
	}
	return DEFAULT_CALENDAR_COLORS[
		sum % DEFAULT_CALENDAR_COLORS.length
	] as string;
};
const CURRENT_USER_PRINCIPAL = cn(DAV_NS, "current-user-principal");
const CAL_DESCRIPTION = cn(CALDAV_NS, "calendar-description");
const CAL_HOME_SET = cn(CALDAV_NS, "calendar-home-set");
const CAL_SUPPORTED_COMPONENTS = cn(
	CALDAV_NS,
	"supported-calendar-component-set",
);
const CAL_USER_ADDRESS_SET = cn(CALDAV_NS, "calendar-user-address-set");
const CARD_DESCRIPTION = cn(CARDDAV_NS, "addressbook-description");
const CARD_HOME_SET = cn(CARDDAV_NS, "addressbook-home-set");
const LOCK_DISCOVERY = cn(DAV_NS, "lockdiscovery");
const SUPPORTED_LOCK = cn(DAV_NS, "supportedlock");
const ACL_RESTRICTIONS = cn(DAV_NS, "acl-restrictions");
const SUPPORTED_REPORT_SET = cn(DAV_NS, "supported-report-set");
const PRINCIPAL_URL = cn(DAV_NS, "principal-URL");
const CURRENT_USER_PRIVILEGE_SET = cn(DAV_NS, "current-user-privilege-set");
const DAV_ACL = cn(DAV_NS, "acl");
const DAV_OWNER = cn(DAV_NS, "owner");
const CALENDAR_TIMEZONE = cn(CALDAV_NS, "calendar-timezone");
// RFC 7809 §5.1 — timezone service URLs (on calendar home / principal)
const TIMEZONE_SERVICE_SET = cn(CALDAV_NS, "timezone-service-set");
// RFC 7809 §5.2 — TZID shorthand for calendar-timezone (on calendar collection)
const CALENDAR_TIMEZONE_ID = cn(CALDAV_NS, "calendar-timezone-id");
const SCHEDULE_INBOX_URL = cn(CALDAV_NS, "schedule-inbox-URL");
const SCHEDULE_OUTBOX_URL = cn(CALDAV_NS, "schedule-outbox-URL");
const CAL_SUPPORTED_COLLATION_SET = cn(CALDAV_NS, "supported-collation-set");
const CARD_SUPPORTED_COLLATION_SET = cn(CARDDAV_NS, "supported-collation-set");
// RFC 4791 §9.6 / RFC 6352 §10.4 — body-data live properties on instances
const CALENDAR_DATA = cn(CALDAV_NS, "calendar-data");
const ADDRESS_DATA = cn(CARDDAV_NS, "address-data");
const DAV_GROUP_MEMBER_SET = cn(DAV_NS, "group-member-set");
const DAV_GROUP_MEMBERSHIP = cn(DAV_NS, "group-membership");
const DAV_ALTERNATE_URI_SET = cn(DAV_NS, "alternate-URI-set");
// RFC 6638 §9.1 — schedule-calendar-transp (opaque|transparent)
const SCHEDULE_CALENDAR_TRANSP = cn(CALDAV_NS, "schedule-calendar-transp");
// RFC 6638 §9.2 — schedule-default-calendar-URL (inbox only)
const SCHEDULE_DEFAULT_CAL_URL = cn(CALDAV_NS, "schedule-default-calendar-URL");
// RFC 6638 §2.4.2 — calendar-user-type (on principal resources)
const CAL_USER_TYPE = cn(CALDAV_NS, "calendar-user-type");

// The two collation URIs the server supports for <text-match> filters.
// RFC 4791 §5.2.10 / RFC 6352 §6.2.3 — the property is a single element with
// one <collation> child per supported collation; on calendar collections the
// child is in the CalDAV namespace, on address-books it is in the CardDAV
// namespace (each spec defines its own child element).
const COLLATION_NAMES: ReadonlyArray<string> = [
	"i;ascii-casemap",
	"i;octet",
	"i;unicode-casemap",
];
const CAL_SUPPORTED_COLLATIONS: Record<ClarkName, unknown> = {
	[cn(CALDAV_NS, "collation")]: COLLATION_NAMES,
};
const CARD_SUPPORTED_COLLATIONS: Record<ClarkName, unknown> = {
	[cn(CARDDAV_NS, "collation")]: COLLATION_NAMES,
};

// ---------------------------------------------------------------------------
// ACL helpers
// ---------------------------------------------------------------------------

/**
 * Convert a DavPrivilege string ("DAV:read", "CALDAV:schedule-deliver", …)
 * to Clark notation so the multistatus builder can translate it to a prefix.
 */
const DAV_PREFIX = "DAV:";
const CALDAV_PREFIX = "CALDAV:";
const CARDDAV_PREFIX = "CARDDAV:";

const privilegeToClark = (p: DavPrivilege): ClarkName => {
	if (p.startsWith(DAV_PREFIX)) {
		return cn(DAV_NS, p.slice(DAV_PREFIX.length));
	}
	if (p.startsWith(CALDAV_PREFIX)) {
		return cn(CALDAV_NS, p.slice(CALDAV_PREFIX.length));
	}
	if (p.startsWith(CARDDAV_PREFIX)) {
		return cn(CARDDAV_NS, p.slice(CARDDAV_PREFIX.length));
	}
	return cn(DAV_NS, p);
};

/**
 * Build the DAV:current-user-privilege-set value from a privilege list.
 * RFC 3744 §5.4: a single property with one <D:privilege> child per privilege.
 * Returning an array of `{ "{DAV:}privilege": ... }` objects would cause
 * fast-xml-builder to emit one wrapper per element, so we return a single
 * object whose `"{DAV:}privilege"` value is an array — that lets the builder
 * render a single wrapper containing repeated <D:privilege> children.
 */
const buildPrivilegeSet = (
	privileges: ReadonlyArray<DavPrivilege>,
): Record<ClarkName, unknown> => ({
	[cn(DAV_NS, "privilege")]: privileges.map((p) => ({
		[privilegeToClark(p)]: "",
	})),
});

/**
 * Build the DAV:supported-report-set value for a given collection type.
 * RFC 3253 §3.1.5: single property with one <D:supported-report> child per
 * supported report. Returns an object whose `"{DAV:}supported-report"` value
 * is an array so fast-xml-builder emits a single wrapper containing repeated
 * <D:supported-report> children.
 */
const buildSupportedReportSet = (
	collectionType: string,
): Record<ClarkName, unknown> => {
	const makeEntry = (name: ClarkName): Record<ClarkName, unknown> => ({
		[cn(DAV_NS, "report")]: { [name]: "" },
	});

	const names: ReadonlyArray<ClarkName> =
		collectionType === "calendar"
			? [
					cn(CALDAV_NS, "calendar-query"),
					cn(CALDAV_NS, "calendar-multiget"),
					cn(DAV_NS, "sync-collection"),
				]
			: collectionType === "addressbook"
				? [
						cn(CARDDAV_NS, "addressbook-query"),
						cn(CARDDAV_NS, "addressbook-multiget"),
						cn(DAV_NS, "sync-collection"),
					]
				: collectionType === "inbox" || collectionType === "outbox"
					? [
							// RFC 6638 §2.3: inbox/outbox MUST support calendar-query and calendar-multiget
							cn(CALDAV_NS, "calendar-query"),
							cn(CALDAV_NS, "calendar-multiget"),
							cn(DAV_NS, "sync-collection"),
						]
					: [cn(DAV_NS, "sync-collection")];

	return {
		[cn(DAV_NS, "supported-report")]: names.map(makeEntry),
	};
};

/** Shared ACL restrictions value (grant-only, no-invert per RFC 3744 §5.6). */
const ACL_RESTRICTIONS_VALUE: Readonly<Record<ClarkName, unknown>> = {
	[cn(DAV_NS, "grant-only")]: "",
	[cn(DAV_NS, "no-invert")]: "",
};

/**
 * Build the DAV:acl property value from a list of ACE rows.
 *
 * RFC 3744 §5.5 — each ACE specifies a principal, a grant/deny, and
 * optionally the protected marker. We surface the full ACL to any
 * caller that holds DAV:read-acl (callers must gate on that privilege).
 */
const buildAclValue = (
	aces: ReadonlyArray<AceRow>,
	origin: string,
): Record<ClarkName, unknown> => ({
	[cn(DAV_NS, "ace")]: aces.map((ace) => {
		const principal: Record<ClarkName, unknown> =
			ace.principalType === "all"
				? { [cn(DAV_NS, "all")]: "" }
				: ace.principalType === "authenticated"
					? { [cn(DAV_NS, "authenticated")]: "" }
					: ace.principalType === "unauthenticated"
						? { [cn(DAV_NS, "unauthenticated")]: "" }
						: ace.principalType === "self"
							? { [cn(DAV_NS, "self")]: "" }
							: ({
									[cn(DAV_NS, "href")]:
										`${origin}/dav/principals/${ace.principalId}/`,
								} as Record<ClarkName, unknown>);

		const aceObj: Record<ClarkName, unknown> = {
			[cn(DAV_NS, "principal")]: principal,
		};
		if (ace.grantDeny === "grant") {
			aceObj[cn(DAV_NS, "grant")] = {
				[cn(DAV_NS, "privilege")]: {
					[privilegeToClark(ace.privilege as DavPrivilege)]: "",
				},
			};
		} else {
			aceObj[cn(DAV_NS, "deny")] = {
				[cn(DAV_NS, "privilege")]: {
					[privilegeToClark(ace.privilege as DavPrivilege)]: "",
				},
			};
		}
		if (ace.protected) {
			aceObj[cn(DAV_NS, "protected")] = "";
		}
		return aceObj;
	}),
});

// ---------------------------------------------------------------------------
// PROPFIND body parsing
// ---------------------------------------------------------------------------

const parsePropfindBody = (
	req: Request,
): Effect.Effect<PropfindKind, DavError | XmlParseError> =>
	readXmlBody(req).pipe(
		Effect.flatMap((body) => {
			if (body.trim() === "") {
				return Effect.succeed<PropfindKind>({ type: "allprop" });
			}
			return parseXml(body).pipe(
				Effect.map((raw) => {
					const tree = normalizeClarkNames(raw) as Record<string, unknown>;
					const propfind = tree[cn(DAV_NS, "propfind")] as
						| Record<string, unknown>
						| undefined;
					if (!propfind) {
						return { type: "allprop" } satisfies PropfindKind;
					}
					if (cn(DAV_NS, "allprop") in propfind) {
						// RFC 4918 §9.1: allprop MAY be combined with <include> to
						// request properties not returned by default.
						const includeEl = propfind[cn(DAV_NS, "include")];
						if (typeof includeEl === "object" && includeEl !== null) {
							const extra = new Set<ClarkName>(
								Object.keys(includeEl).filter(
									(k) => !k.startsWith("@_"),
								) as Array<ClarkName>,
							);
							return { type: "allprop", extra } satisfies PropfindKind;
						}
						return { type: "allprop" } satisfies PropfindKind;
					}
					if (cn(DAV_NS, "propname") in propfind) {
						return { type: "propname" } satisfies PropfindKind;
					}
					const propEl = propfind[cn(DAV_NS, "prop")];
					if (typeof propEl === "object" && propEl !== null) {
						const names = new Set<ClarkName>(
							Object.keys(propEl).filter(
								(k) => !k.startsWith("@_"),
							) as Array<ClarkName>,
						);
						return { type: "prop", names } satisfies PropfindKind;
					}
					return { type: "allprop" } satisfies PropfindKind;
				}),
				// RFC 4918 §9.1: PROPFIND body MUST be well-formed XML.
				// XmlParseError propagates → HTTP edge maps it to 400.
			);
		}),
	);

/**
 * Returns the data property's Clark name for an instance under the given
 * namespace, or `null` when the namespace doesn't carry body-data.
 *
 * RFC 4791 §9.6 — calendar collections (and inbox/outbox per RFC 6638 §2.3)
 * expose `{caldav}calendar-data`; RFC 6352 §10.4 — address-books expose
 * `{carddav}address-data`.
 */
const dataClarkForNamespace = (namespace: string): ClarkName | null => {
	if (namespace === "cal" || namespace === "inbox" || namespace === "outbox") {
		return CALENDAR_DATA;
	}
	if (namespace === "card") {
		return ADDRESS_DATA;
	}
	return null;
};

/**
 * If the PROPFIND request explicitly asks for the body-data property
 * (`<C:calendar-data/>` or `<CR:address-data/>`), load the instance's
 * component tree and emit the serialized body. RFC 4791 §9.6 / RFC 6352 §10.4
 * state these properties are NOT included in `allprop` responses — clients
 * must request them explicitly — so we skip the load entirely for `allprop`
 * to avoid a per-instance fetch on a collection-wide enumeration.
 */
const loadInstanceData = (
	row: InstanceRow,
	namespace: string,
	propfind: PropfindKind,
): Effect.Effect<Option.Option<string>, DatabaseError, ComponentRepository> =>
	Effect.gen(function* () {
		const dataClark = dataClarkForNamespace(namespace);
		if (dataClark === null) {
			return Option.none<string>();
		}
		if (propfind.type !== "prop" || !propfind.names.has(dataClark)) {
			return Option.none<string>();
		}
		const compRepo = yield* ComponentRepository;
		const entityType = dataClark === ADDRESS_DATA ? "vcard" : "icalendar";
		const treeOpt = yield* compRepo.loadTree(
			row.entityId as unknown as EntityId,
			entityType,
		);
		if (Option.isNone(treeOpt)) {
			return Option.none<string>();
		}
		const doc: IrDocument =
			entityType === "icalendar"
				? { kind: "icalendar", root: treeOpt.value }
				: { kind: "vcard", root: treeOpt.value };
		const body = yield* entityType === "icalendar"
			? encodeICalendar(doc)
			: encodeVCard(doc);
		return Option.some(body);
	});

// ---------------------------------------------------------------------------
// Resource URL builders
// ---------------------------------------------------------------------------

/**
 * Href for a directly-accessed collection: mirrors the URL segments the client
 * used (slug or UUID) so that response hrefs match the request URL.
 */
const collectionHref = (
	origin: string,
	principalSeg: string,
	ns: string,
	collectionSeg: string,
): string => `${origin}/dav/principals/${principalSeg}/${ns}/${collectionSeg}/`;

/** Human-readable DAV:displayname for each per-type home collection. */
const COLLECTION_HOME_DISPLAYNAME: Record<CollectionNamespace, string> = {
	cal: "Calendars",
	card: "Address Books",
	inbox: "Scheduling Inbox",
	outbox: "Scheduling Outbox",
	col: "Collections",
};

/**
 * Href for a directly-accessed instance: mirrors the URL segments the client
 * used. The instance segment is percent-encoded because object names may now
 * contain `@` and other UID characters (see isValidInstanceSlug); the parent
 * segments use the tighter collection-slug charset and need no encoding.
 */
const instanceHref = (
	origin: string,
	principalSeg: string,
	ns: string,
	collectionSeg: string,
	instanceSeg: string,
): string =>
	`${origin}/dav/principals/${principalSeg}/${ns}/${collectionSeg}/${encodeSegment(instanceSeg)}`;

/**
 * Href for a depth:1 member instance. Uses the instance's stored slug so the
 * href matches the URL the client created the object at (clients such as
 * python-caldav match list/search/sync results against that URL). The slug is
 * percent-encoded because object names may contain `@` etc.; it falls back to
 * the UUID only if the slug is somehow empty. Both forms resolve on input.
 */
const memberInstanceHref = (
	origin: string,
	principalSeg: string,
	ns: string,
	collectionSeg: string,
	instanceRow: InstanceRow,
): string =>
	`${origin}/dav/principals/${principalSeg}/${ns}/${collectionSeg}/${encodeSegment(instanceRow.slug || instanceRow.id)}`;

// ---------------------------------------------------------------------------
// Property builders
// ---------------------------------------------------------------------------

/**
 * Convert a Temporal.Instant (from the DB) to an iCalendar DATETIME string
 * (e.g. "20240115T120000Z").
 */
const toICalDatetime = (instant: { epochMilliseconds: number }): string => {
	const d = Temporal.Instant.fromEpochMilliseconds(
		instant.epochMilliseconds,
	).toZonedDateTimeISO("UTC");
	const pad = (n: number, len = 2): string => String(n).padStart(len, "0");
	return (
		`${d.year}${pad(d.month)}${pad(d.day)}` +
		`T${pad(d.hour)}${pad(d.minute)}${pad(d.second)}Z`
	);
};

// ---------------------------------------------------------------------------
// Collection → DavResponse
// ---------------------------------------------------------------------------

const buildCollectionProps = (
	row: CollectionRow,
	origin = "",
): Readonly<Record<ClarkName, unknown>> => {
	const resourcetype: Record<string, unknown> = {
		"{DAV:}collection": "",
	};
	if (row.collectionType === "calendar") {
		resourcetype[`{${CALDAV_NS}}calendar`] = "";
	} else if (row.collectionType === "addressbook") {
		resourcetype[`{${CARDDAV_NS}}addressbook`] = "";
	} else if (row.collectionType === "inbox") {
		// RFC 6638 §2.2: scheduling inbox resourcetype
		resourcetype[`{${CALDAV_NS}}schedule-inbox`] = "";
	} else if (row.collectionType === "outbox") {
		// RFC 6638 §2.1: scheduling outbox resourcetype
		resourcetype[`{${CALDAV_NS}}schedule-outbox`] = "";
	}

	const props: Record<ClarkName, unknown> = {
		[RESOURCETYPE]: resourcetype,
		[GETLASTMODIFIED]: toRfc1123(row.updatedAt),
		[SYNC_TOKEN]: `urn:ietf:params:xml:ns:sync:${row.synctoken}`,
		// CalendarServer `getctag` — alias for sync-token, kept for compatibility
		// with clients that pre-date RFC 6578 (Apple/Thunderbird/DAVx5).
		[GETCTAG]: String(row.synctoken),
		// RFC 4918 §15.7 DAV:getetag on a collection — represents the collection
		// resource itself. We surface the sync_token as a weak etag: it changes
		// whenever any member is added/modified/removed, which is the practical
		// "has this collection changed?" signal clients care about.
		[GETETAG]: `W/"${row.synctoken}"`,
		[LOCK_DISCOVERY]: "",
		[SUPPORTED_LOCK]: "",
		[ACL_RESTRICTIONS]: ACL_RESTRICTIONS_VALUE,
		[SUPPORTED_REPORT_SET]: buildSupportedReportSet(row.collectionType),
	};

	// RFC 4918 §15.1 DAV:creationdate — derive from the UUIDv7 row id.
	const createdAt = creationDateFromId(row.id);
	if (createdAt !== undefined) {
		props[CREATIONDATE] = createdAt;
	}

	if (row.displayName !== null) {
		props[DISPLAYNAME] = row.displayName;
	}
	if (row.collectionType === "calendar" && row.description !== null) {
		props[CAL_DESCRIPTION] = row.description;
	}
	if (row.collectionType === "addressbook" && row.description !== null) {
		props[CARD_DESCRIPTION] = row.description;
	}
	if (
		row.collectionType === "calendar" &&
		row.supportedComponents !== null &&
		row.supportedComponents.length > 0
	) {
		props[CAL_SUPPORTED_COMPONENTS] = {
			[`{${CALDAV_NS}}comp`]: row.supportedComponents.map((c) => ({
				"@_name": c,
			})),
		};
	}

	// RFC 6638 §2.3 — scheduling inbox/outbox MUST advertise the set of
	// scheduling components they accept. Inbox/Outbox carry VEVENT/VTODO
	// requests and VFREEBUSY for free-busy lookups; expose those so clients
	// know to route invitations and free-busy POSTs here.
	if (row.collectionType === "inbox" || row.collectionType === "outbox") {
		props[CAL_SUPPORTED_COMPONENTS] = {
			[`{${CALDAV_NS}}comp`]: ["VEVENT", "VTODO", "VFREEBUSY"].map((c) => ({
				"@_name": c,
			})),
		};
	}

	// RFC 4791 §5.2.5–5.2.9: capacity / limit properties (calendar only).
	// RFC 6352 §6.2.3: CARDDAV:max-resource-size (addressbook only).
	if (row.collectionType === "calendar") {
		if (row.maxResourceSize !== null) {
			props[cn(CALDAV_NS, "max-resource-size")] = String(row.maxResourceSize);
		}
		if (row.minDateTime !== null) {
			props[cn(CALDAV_NS, "min-date-time")] = toICalDatetime(row.minDateTime);
		}
		if (row.maxDateTime !== null) {
			props[cn(CALDAV_NS, "max-date-time")] = toICalDatetime(row.maxDateTime);
		}
		if (row.maxInstances !== null) {
			props[cn(CALDAV_NS, "max-instances")] = String(row.maxInstances);
		}
		if (row.maxAttendeesPerInstance !== null) {
			props[cn(CALDAV_NS, "max-attendees-per-instance")] = String(
				row.maxAttendeesPerInstance,
			);
		}
	} else if (
		row.collectionType === "addressbook" &&
		row.maxResourceSize !== null
	) {
		props[cn(CARDDAV_NS, "max-resource-size")] = String(row.maxResourceSize);
	}

	// RFC 6638 §9.1: schedule-calendar-transp (calendar, inbox, outbox only)
	if (
		row.collectionType === "calendar" ||
		row.collectionType === "inbox" ||
		row.collectionType === "outbox"
	) {
		const transp = row.scheduleTransp ?? "opaque";
		props[SCHEDULE_CALENDAR_TRANSP] = {
			[cn(CALDAV_NS, transp)]: "",
		};
	}

	// RFC 6638 §9.2: schedule-default-calendar-URL (inbox only, when set)
	if (
		origin !== "" &&
		row.collectionType === "inbox" &&
		row.scheduleDefaultCalendarId !== null
	) {
		props[SCHEDULE_DEFAULT_CAL_URL] = {
			[cn(DAV_NS, "href")]:
				`${origin}/dav/principals/${row.ownerPrincipalId}/cal/${row.scheduleDefaultCalendarId}/`,
		};
	}

	// Default calendar-color (Apple ns) for calendar collections — picked
	// deterministically from the row id so the same calendar always renders
	// with the same colour. Set BEFORE the dead-props loop so a value the
	// client persisted via PROPPATCH/MKCALENDAR overrides the default.
	if (row.collectionType === "calendar") {
		props[CALENDAR_COLOR] = defaultCalendarColor(row.id);
	}

	// Dead properties
	const dead = row.clientProperties as IrDeadProperties | null;
	if (dead) {
		for (const [clark, xmlValue] of Object.entries(dead)) {
			props[clark as ClarkName] = xmlValue;
		}
	}

	return props;
};

const collectionResponse = (
	href: string,
	row: CollectionRow,
	request: PropfindKind,
	origin: string,
	// Member enumerations (depth:1) need the same live, per-caller properties a
	// direct depth:0 request returns — most importantly current-user-privilege-set,
	// which clients like iOS read on each calendar/addressbook to decide whether
	// it's usable. buildCollectionProps is synchronous and can't run the ACL
	// query, so privileges are computed by the caller and threaded in here.
	privileges: ReadonlyArray<DavPrivilege>,
	actingPrincipalHref: string,
): DavResponse => {
	const props: Record<ClarkName, unknown> = {
		...buildCollectionProps(row, origin),
		[CURRENT_USER_PRINCIPAL]: { [cn(DAV_NS, "href")]: actingPrincipalHref },
		[CURRENT_USER_PRIVILEGE_SET]: buildPrivilegeSet(privileges),
	};
	if (origin !== "") {
		props[DAV_OWNER] = {
			[cn(DAV_NS, "href")]: `${origin}/dav/principals/${row.ownerPrincipalId}/`,
		};
	}
	return { href, propstats: splitPropstats(props, request) };
};

// ---------------------------------------------------------------------------
// Instance → DavResponse
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const propfindHandler = (
	path: ResolvedDavPath,
	ctx: HttpRequestContext,
	req: Request,
): Effect.Effect<
	Response,
	DavError | DatabaseError | XmlParseError,
	| CollectionService
	| InstanceService
	| AclService
	| PrincipalService
	| PrincipalRepository
	| CalTimezoneRepository
	| GroupService
	| ComponentRepository
	| ExternalCalendarRepository
> =>
	Effect.gen(function* () {
		// RFC 4918 §9.1 says missing Depth ≡ infinity; we reject infinity with
		// DAV:propfind-finite-depth, but historically every CalDAV client and
		// every other DAV server (Apple CalendarServer, DAViCal, Radicale,
		// Baikal, …) treats missing Depth as 0. Following the convention so
		// clients that omit Depth see the resource-only response they expect.
		//
		// The spec requires "0", "1", and "infinity"; anything else is an
		// invalid request and per RFC 4918 §10.2 should be rejected with 400
		// rather than silently coerced to 0 — silent coercion masks client
		// bugs (Apache Tomcat made this same fix recently).
		const depthHeader = req.headers.get("Depth") ?? "0";
		if (depthHeader === "infinity") {
			return yield* forbidden("DAV:propfind-finite-depth");
		}
		if (depthHeader !== "0" && depthHeader !== "1") {
			return yield* badRequest(
				`Invalid Depth header "${depthHeader}" — must be 0, 1, or infinity`,
			);
		}
		const depth = depthHeader === "1" ? 1 : 0;

		// 404 for path kinds we don't serve yet (user/group paths handled by dedicated handlers)
		if (
			path.kind === "new-collection" ||
			path.kind === "new-instance" ||
			path.kind === "wellknown" ||
			path.kind === "userCollection" ||
			path.kind === "user" ||
			path.kind === "newUser" ||
			path.kind === "groupCollection" ||
			path.kind === "newGroup" ||
			path.kind === "groupMembers" ||
			path.kind === "groupMember" ||
			path.kind === "groupMemberNonExistent" ||
			path.kind === "unknownPrincipal"
		) {
			return yield* notFound();
		}

		// Require authentication — all non-OPTIONS methods require credentials
		if (ctx.auth._tag !== "Authenticated") {
			return yield* unauthorized();
		}
		const actingPrincipalId = ctx.auth.principal.principalId;

		const propfind = yield* parsePropfindBody(req);
		const acl = yield* AclService;
		const collSvc = yield* CollectionService;
		const instSvc = yield* InstanceService;

		const origin = ctx.url.origin;
		const responses: Array<DavResponse> = [];

		// href pointing to the acting principal — used by current-user-principal
		const actingPrincipalHref = `${origin}/dav/principals/${actingPrincipalId}/`;

		if (path.kind === "principal") {
			// Minimal principal response — display name and resource type
			yield* acl.check(
				actingPrincipalId,
				path.principalId,
				"principal",
				"DAV:read",
			);
			const principalPrivileges = yield* acl.currentUserPrivileges(
				actingPrincipalId,
				path.principalId,
				"principal",
			);
			const principalSvc = yield* PrincipalService;
			const principalRow = yield* principalSvc.findById(path.principalId);
			const displayName = principalRow.principal.displayName;
			const principalHref = `${origin}/dav/principals/${path.principalSeg}/`;

			// Resolve the principal's collections up front so we can build the
			// correct schedule-inbox/outbox URLs (they live at /inbox/<uuid>/ and
			// /outbox/<uuid>/, not under /cal/). The list is reused at depth:1.
			const ownCollections = yield* collSvc.listByOwner(path.principalId);
			const inbox = ownCollections.find((c) => c.collectionType === "inbox");
			const outbox = ownCollections.find((c) => c.collectionType === "outbox");
			// RFC 6638 §2.2: scheduling inbox/outbox URLs for this principal.
			// Use UUIDs because these are indirect references (the client did not
			// directly address them), matching the project's href policy.
			const inboxHref = inbox
				? collectionHref(origin, path.principalSeg, "inbox", inbox.id)
				: undefined;
			const outboxHref = outbox
				? collectionHref(origin, path.principalSeg, "outbox", outbox.id)
				: undefined;
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
				[CURRENT_USER_PRINCIPAL]: { [cn(DAV_NS, "href")]: actingPrincipalHref },
				// RFC 3744 §4.2: canonical URL for this principal resource
				[PRINCIPAL_URL]: { [cn(DAV_NS, "href")]: principalHref },
				// RFC 4791 §6.2.1: calendar home — the collection whose members are
				// the principal's calendars. Points at the `/cal/` namespace level so
				// MKCALENDAR <home>/<name>/ (the universal client convention) lands on
				// a real, addressable collection (RFC 4918 §5.2).
				[CAL_HOME_SET]: {
					[cn(DAV_NS, "href")]: `${principalHref}cal/`,
				},
				// RFC 6352 §7.1.1: addressbook home — analogous, at `/card/`.
				[CARD_HOME_SET]: {
					[cn(DAV_NS, "href")]: `${principalHref}card/`,
				},
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
				[TIMEZONE_SERVICE_SET]: { [cn(DAV_NS, "href")]: `${origin}/timezones` },
				// RFC 3744 §4.4: groups this user belongs to. Single <D:group-membership>
				// element with one <D:href> child per group (not one wrapper per href).
				[DAV_GROUP_MEMBERSHIP]: {
					[cn(DAV_NS, "href")]: memberOfGroups.map(
						(g) => `${origin}/dav/groups/${g.principal.id}/`,
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
				allProps[DAV_ACL] = buildAclValue(aces, origin);
			}
			// Dead properties
			const dead = principalRow.principal
				.clientProperties as IrDeadProperties | null;
			if (dead) {
				for (const [clark, xmlValue] of Object.entries(dead)) {
					allProps[clark as ClarkName] = xmlValue;
				}
			}
			responses.push({
				href: principalHref,
				propstats: splitPropstats(allProps, propfind),
			});

			if (depth === 1) {
				const groupCollectionSets = yield* Effect.all(
					memberOfGroups.map((g) =>
						collSvc.listByOwner(PrincipalId(g.principal.id)),
					),
				);
				for (const coll of ownCollections) {
					const ns =
						(COLLECTION_TYPE_TO_NAMESPACE as Record<string, string>)[
							coll.collectionType
						] ?? "col";
					const href = collectionHref(
						origin,
						path.principalSeg,
						ns,
						coll.slug || coll.id,
					);
					const privileges = applyReadOnlyPrivileges(
						yield* acl.currentUserPrivileges(
							actingPrincipalId,
							CollectionId(coll.id),
							"collection",
						),
						yield* isReadOnlyCollectionRow(coll),
					);
					responses.push(
						collectionResponse(
							href,
							coll,
							propfind,
							origin,
							privileges,
							actingPrincipalHref,
						),
					);
				}
				for (const [group, groupColls] of memberOfGroups.map(
					(g, i) => [g, groupCollectionSets[i] ?? []] as const,
				)) {
					const groupPrincipalSeg = group.principal.id;
					for (const coll of groupColls) {
						const ns =
							(COLLECTION_TYPE_TO_NAMESPACE as Record<string, string>)[
								coll.collectionType
							] ?? "col";
						const href = collectionHref(
							origin,
							groupPrincipalSeg,
							ns,
							coll.slug || coll.id,
						);
						const privileges = applyReadOnlyPrivileges(
							yield* acl.currentUserPrivileges(
								actingPrincipalId,
								CollectionId(coll.id),
								"collection",
							),
							yield* isReadOnlyCollectionRow(coll),
						);
						responses.push(
							collectionResponse(
								href,
								coll,
								propfind,
								origin,
								privileges,
								actingPrincipalHref,
							),
						);
					}
				}
			}
		} else if (path.kind === "collection") {
			yield* acl.check(
				actingPrincipalId,
				path.collectionId,
				"collection",
				"DAV:read",
			);
			const collectionPrivileges = yield* acl.currentUserPrivileges(
				actingPrincipalId,
				path.collectionId,
				"collection",
			);
			const collRow = yield* collSvc.findById(path.collectionId);
			// Subscription (ICS feed) and auto-managed (birthdays) calendars are
			// writable in the ACL — the caller owns them — but the server rejects
			// content writes. Hide the write privileges so clients render them
			// read-only instead of offering an edit that will 403. The same status
			// applies to every member instance below.
			const collReadOnly = yield* isReadOnlyCollectionRow(collRow);
			const href = collectionHref(
				origin,
				path.principalSeg,
				path.namespace,
				path.collectionSeg,
			);
			const ownerHref = `${origin}/dav/principals/${collRow.ownerPrincipalId}/`;
			const collProps: Record<ClarkName, unknown> = {
				...buildCollectionProps(collRow, origin),
				[CURRENT_USER_PRINCIPAL]: { [cn(DAV_NS, "href")]: actingPrincipalHref },
				[CURRENT_USER_PRIVILEGE_SET]: buildPrivilegeSet(
					applyReadOnlyPrivileges(collectionPrivileges, collReadOnly),
				),
				// RFC 3744 §5.1: owner of this resource
				[DAV_OWNER]: { [cn(DAV_NS, "href")]: ownerHref },
			};
			// CALDAV:calendar-timezone — RFC 4791 §5.2.2
			// CALDAV:calendar-timezone-id — RFC 7809 §5.2 (TZID shorthand)
			if (collRow.collectionType === "calendar" && collRow.timezoneTzid) {
				const tzRepo = yield* CalTimezoneRepository;
				const tzOpt = yield* tzRepo.findByTzid(collRow.timezoneTzid);
				const tzData = Option.getOrUndefined(tzOpt);
				if (tzData !== undefined) {
					collProps[CALENDAR_TIMEZONE] = tzData.vtimezoneData;
				}
				// calendar-timezone-id is the TZID string; always present when timezone is set.
				collProps[CALENDAR_TIMEZONE_ID] = collRow.timezoneTzid;
			}
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
				collProps[DAV_ACL] = buildAclValue(aces, origin);
			}
			responses.push({
				href,
				propstats: splitPropstats(collProps, propfind),
			});

			if (depth === 1) {
				const instances = yield* instSvc.listByCollection(path.collectionId);
				const compRepo = yield* ComponentRepository;

				// Every member shares this collection as its ACL parent, so the
				// inherited privilege set is resolved once and unioned with each
				// member's direct ACEs — one ancestor walk + one batched query
				// instead of an ancestor walk per instance.
				const privMap = yield* acl.batchMemberPrivileges(
					actingPrincipalId,
					path.collectionId,
					"collection",
					instances.map((inst) => InstanceId(inst.id)),
					"instance",
				);

				// RFC 4791 §9.6 / RFC 6352 §10.4 — body-data is only emitted for an
				// explicit `prop` request that names it (never allprop/propname). Load
				// every requested tree in 3 queries instead of 3 per instance.
				const dataClark = dataClarkForNamespace(path.namespace);
				const wantsData =
					propfind.type === "prop" &&
					dataClark !== null &&
					propfind.names.has(dataClark);
				const dataEntityType =
					dataClark === ADDRESS_DATA ? "vcard" : "icalendar";
				const dataTrees = wantsData
					? yield* compRepo.loadTreesByIds(
							instances.map((inst) => inst.entityId as unknown as EntityId),
							dataEntityType,
						)
					: undefined;

				// DAV:acl is part of allprop/propname output (when read-acl is held),
				// but for an explicit `prop` request it is only emitted when named —
				// so the getAces fetch can be skipped entirely otherwise.
				const aclMightBeNeeded =
					propfind.type !== "prop" || propfind.names.has(DAV_ACL);

				for (const inst of instances) {
					const iHref = memberInstanceHref(
						origin,
						path.principalSeg,
						path.namespace,
						path.collectionSeg,
						inst,
					);
					const instPrivileges = privMap.get(InstanceId(inst.id)) ?? [];
					const instProps: Record<ClarkName, unknown> = {
						...buildInstanceProps(inst),
						[CURRENT_USER_PRINCIPAL]: {
							[cn(DAV_NS, "href")]: actingPrincipalHref,
						},
						[CURRENT_USER_PRIVILEGE_SET]: buildPrivilegeSet(
							applyReadOnlyPrivileges(instPrivileges, collReadOnly),
						),
						// RFC 3744 §5.1: owner inherited from the parent collection
						[DAV_OWNER]: { [cn(DAV_NS, "href")]: ownerHref },
					};
					if (wantsData && dataTrees !== undefined && dataClark !== null) {
						const tree = dataTrees.get(inst.entityId as unknown as EntityId);
						if (tree !== undefined) {
							const doc: IrDocument =
								dataEntityType === "icalendar"
									? { kind: "icalendar", root: tree }
									: { kind: "vcard", root: tree };
							instProps[dataClark] =
								dataEntityType === "icalendar"
									? yield* encodeICalendar(doc)
									: yield* encodeVCard(doc);
						}
					}
					// DAV:acl — RFC 3744 §5.5: only when the caller holds read-acl.
					if (
						aclMightBeNeeded &&
						(instPrivileges as ReadonlyArray<string>).includes("DAV:read-acl")
					) {
						const instAces = yield* acl.getAces(
							InstanceId(inst.id),
							"instance",
						);
						instProps[DAV_ACL] = buildAclValue(instAces, origin);
					}
					responses.push({
						href: iHref,
						propstats: splitPropstats(instProps, propfind),
					});
				}
			}
		} else if (path.kind === "collectionHome") {
			// RFC 4918 §5.2: the per-type namespace level (e.g. /…/cal/) is a real
			// collection — the calendar/addressbook *home* whose members are the
			// principal's typed collections. Authorized via the owning principal's
			// ACL (the home has no ACL row of its own).
			yield* acl.check(
				actingPrincipalId,
				path.principalId,
				"principal",
				"DAV:read",
			);
			const homePrivileges = yield* acl.currentUserPrivileges(
				actingPrincipalId,
				path.principalId,
				"principal",
			);
			const homeHref = `${origin}/dav/principals/${path.principalSeg}/${path.namespace}/`;
			const ownerHref = `${origin}/dav/principals/${path.principalId}/`;
			responses.push({
				href: homeHref,
				propstats: splitPropstats(
					{
						// An ordinary WebDAV collection, NOT a calendar/addressbook —
						// those resourcetypes belong on the members beneath it.
						[RESOURCETYPE]: { [cn(DAV_NS, "collection")]: "" },
						[DISPLAYNAME]: COLLECTION_HOME_DISPLAYNAME[path.namespace],
						[DAV_OWNER]: { [cn(DAV_NS, "href")]: ownerHref },
						[CURRENT_USER_PRINCIPAL]: {
							[cn(DAV_NS, "href")]: actingPrincipalHref,
						},
						[CURRENT_USER_PRIVILEGE_SET]: buildPrivilegeSet(homePrivileges),
					},
					propfind,
				),
			});

			if (depth === 1) {
				const homeCollections = yield* collSvc.listByOwner(path.principalId);
				for (const coll of homeCollections) {
					const ns =
						(COLLECTION_TYPE_TO_NAMESPACE as Record<string, string>)[
							coll.collectionType
						] ?? "col";
					if (ns !== path.namespace) {
						continue;
					}
					const href = collectionHref(
						origin,
						path.principalSeg,
						ns,
						coll.slug || coll.id,
					);
					const privileges = applyReadOnlyPrivileges(
						yield* acl.currentUserPrivileges(
							actingPrincipalId,
							CollectionId(coll.id),
							"collection",
						),
						yield* isReadOnlyCollectionRow(coll),
					);
					responses.push(
						collectionResponse(
							href,
							coll,
							propfind,
							origin,
							privileges,
							actingPrincipalHref,
						),
					);
				}
			}
		} else if (path.kind === "root") {
			// RFC 6764 §6.1 / RFC 5397 §3: root resource exposes DAV:current-user-principal
			// so auto-discovery clients can bootstrap without knowing any principal URL.
			responses.push({
				href: `${origin}/dav/`,
				propstats: splitPropstats(
					{
						[RESOURCETYPE]: { [cn(DAV_NS, "collection")]: "" },
						[DISPLAYNAME]: "DAV",
						[CURRENT_USER_PRINCIPAL]: {
							[cn(DAV_NS, "href")]: actingPrincipalHref,
						},
					},
					propfind,
				),
			});
		} else if (path.kind === "principalCollection") {
			// RFC 3744 §4.5 — the principal-collection resource. Depth:0 returns
			// just this resource; Depth:1 enumerates every (non-deleted) user
			// principal so client UIs can populate principal pickers.
			responses.push({
				href: `${origin}/dav/principals/`,
				propstats: splitPropstats(
					{
						[RESOURCETYPE]: { [cn(DAV_NS, "collection")]: "" },
						[DISPLAYNAME]: "Principals",
						[CURRENT_USER_PRINCIPAL]: {
							[cn(DAV_NS, "href")]: actingPrincipalHref,
						},
					},
					propfind,
				),
			});
			if (depth === 1) {
				const principalRepo = yield* PrincipalRepository;
				const allPrincipals = yield* principalRepo.listAll();
				for (const p of allPrincipals) {
					const pHref = `${origin}/dav/principals/${p.principal.id}/`;
					responses.push({
						href: pHref,
						propstats: splitPropstats(
							{
								[RESOURCETYPE]: { [cn(DAV_NS, "principal")]: "" },
								[DISPLAYNAME]: p.principal.displayName ?? p.principal.slug,
								[PRINCIPAL_URL]: { [cn(DAV_NS, "href")]: pHref },
							},
							propfind,
						),
					});
				}
			}
		} else if (path.kind === "group") {
			// RFC 3744 §4.3: group principals expose DAV:group-member-set.
			yield* acl.check(
				actingPrincipalId,
				path.principalId,
				"principal",
				"DAV:read",
			);
			const groupSvc = yield* GroupService;
			const groupRow = yield* groupSvc.findById(GroupId(path.groupId));
			const members = yield* groupSvc.listMembers(GroupId(path.groupId));
			const groupHref = `${origin}/dav/groups/${path.groupSeg}/`;
			const memberHrefs = members.map((m) => ({
				[cn(DAV_NS, "href")]: `${origin}/dav/principals/${m.principal.id}/`,
			}));
			responses.push({
				href: groupHref,
				propstats: splitPropstats(
					{
						[RESOURCETYPE]: { [cn(DAV_NS, "principal")]: "" },
						[DISPLAYNAME]:
							groupRow.principal.displayName ?? groupRow.principal.slug,
						[DAV_GROUP_MEMBER_SET]: memberHrefs,
						[CURRENT_USER_PRINCIPAL]: {
							[cn(DAV_NS, "href")]: actingPrincipalHref,
						},
					},
					propfind,
				),
			});
		} else {
			// path.kind === "instance"
			yield* acl.check(
				actingPrincipalId,
				path.instanceId,
				"instance",
				"DAV:read",
			);
			const instancePrivileges = yield* acl.currentUserPrivileges(
				actingPrincipalId,
				path.instanceId,
				"instance",
			);
			const instRow = yield* instSvc.findById(path.instanceId);
			// DAV:owner comes from the parent collection.
			const instCollRow = yield* collSvc.findById(path.collectionId);
			// A member of a read-only calendar is itself read-only to the client.
			const instReadOnly = yield* isReadOnlyCollectionRow(instCollRow);
			const ownerHref = `${origin}/dav/principals/${instCollRow.ownerPrincipalId}/`;
			const href = instanceHref(
				origin,
				path.principalSeg,
				path.namespace,
				path.collectionSeg,
				path.instanceSeg,
			);
			const instProps: Record<ClarkName, unknown> = {
				...buildInstanceProps(instRow),
				[CURRENT_USER_PRINCIPAL]: { [cn(DAV_NS, "href")]: actingPrincipalHref },
				[CURRENT_USER_PRIVILEGE_SET]: buildPrivilegeSet(
					applyReadOnlyPrivileges(instancePrivileges, instReadOnly),
				),
				// RFC 3744 §5.1: owner inherited from the parent collection
				[DAV_OWNER]: { [cn(DAV_NS, "href")]: ownerHref },
			};
			// RFC 4791 §9.6 / RFC 6352 §10.4 — body-data when explicitly requested.
			const dataOpt = yield* loadInstanceData(
				instRow,
				path.namespace,
				propfind,
			);
			if (Option.isSome(dataOpt)) {
				const dataKey = dataClarkForNamespace(path.namespace);
				if (dataKey !== null) {
					instProps[dataKey] = dataOpt.value;
				}
			}
			// DAV:acl — RFC 3744 §5.5: only when the caller holds read-acl.
			if (
				(instancePrivileges as ReadonlyArray<string>).includes("DAV:read-acl")
			) {
				const aces = yield* acl.getAces(path.instanceId, "instance");
				instProps[DAV_ACL] = buildAclValue(aces, origin);
			}
			responses.push({
				href,
				propstats: splitPropstats(instProps, propfind),
			});
		}

		return yield* multistatusResponse(responses);
	});
