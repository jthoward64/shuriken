// ---------------------------------------------------------------------------
// PROPFIND handler — RFC 4918 §9.1
//
// Supported path kinds:
//   collection  → collection properties + (Depth:1) instance members
//   instance    → instance properties only
//   principal   → minimal home-set properties
//   new-collection / new-instance → 404
//   principalCollection / wellknown → 404 (router handles well-known redirect before PROPFIND)
//
// Depth: infinity is rejected with 403 DAV:propfind-finite-depth (RFC 4918 §9.1).
// Missing Depth header defaults to 0 per RFC 4918 §9.1.
// ---------------------------------------------------------------------------

import { Effect, Option } from "effect";
import { Temporal } from "temporal-polyfill";
import { type ClarkName, cn, type IrDeadProperties } from "#src/data/ir.ts";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import { forbidden, notFound, unauthorized } from "#src/domain/errors.ts";
import { GroupId, InstanceId, PrincipalId, UserId } from "#src/domain/ids.ts";
import { COLLECTION_TYPE_TO_NAMESPACE } from "#src/domain/types/collection-namespace.ts";
import type { DavPrivilege } from "#src/domain/types/dav.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import {
	buildInstanceProps,
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
import type { CollectionRow } from "#src/services/collection/repository.ts";
import { GroupService } from "#src/services/group/index.ts";
import { InstanceService } from "#src/services/instance/index.ts";
import type { InstanceRow } from "#src/services/instance/repository.ts";
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
const SYNC_TOKEN = cn(DAV_NS, "sync-token");
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
// RFC 4791 §5.2.10 / RFC 6352 §6.2.3.
const SUPPORTED_COLLATIONS: ReadonlyArray<Record<ClarkName, unknown>> = [
	{ [cn(CALDAV_NS, "collation")]: "i;ascii-casemap" } as Record<
		ClarkName,
		unknown
	>,
	{ [cn(CALDAV_NS, "collation")]: "i;unicode-casemap" } as Record<
		ClarkName,
		unknown
	>,
];

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

/** Build the DAV:current-user-privilege-set value from a privilege list. */
const buildPrivilegeSet = (
	privileges: ReadonlyArray<DavPrivilege>,
): Array<Record<ClarkName, unknown>> =>
	privileges.map(
		(p) =>
			({
				[cn(DAV_NS, "privilege")]: { [privilegeToClark(p)]: "" },
			}) as Record<ClarkName, unknown>,
	);

/** Build the DAV:supported-report-set value for a given collection type. */
const buildSupportedReportSet = (
	collectionType: string,
): ReadonlyArray<Record<ClarkName, unknown>> => {
	const makeEntry = (name: ClarkName): Record<ClarkName, unknown> =>
		({
			[cn(DAV_NS, "supported-report")]: {
				[cn(DAV_NS, "report")]: { [name]: "" },
			},
		}) as Record<ClarkName, unknown>;

	if (collectionType === "calendar") {
		return [
			makeEntry(cn(CALDAV_NS, "calendar-query")),
			makeEntry(cn(CALDAV_NS, "calendar-multiget")),
			makeEntry(cn(DAV_NS, "sync-collection")),
		];
	}
	if (collectionType === "addressbook") {
		return [
			makeEntry(cn(CARDDAV_NS, "addressbook-query")),
			makeEntry(cn(CARDDAV_NS, "addressbook-multiget")),
			makeEntry(cn(DAV_NS, "sync-collection")),
		];
	}
	// RFC 6638 §2.3: inbox and outbox MUST support calendar-query and calendar-multiget
	if (collectionType === "inbox" || collectionType === "outbox") {
		return [
			makeEntry(cn(CALDAV_NS, "calendar-query")),
			makeEntry(cn(CALDAV_NS, "calendar-multiget")),
			makeEntry(cn(DAV_NS, "sync-collection")),
		];
	}
	return [makeEntry(cn(DAV_NS, "sync-collection"))];
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
): ReadonlyArray<Record<ClarkName, unknown>> =>
	aces.map((ace) => {
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
		return { [cn(DAV_NS, "ace")]: aceObj } as Record<ClarkName, unknown>;
	});

// ---------------------------------------------------------------------------
// PROPFIND body parsing
// ---------------------------------------------------------------------------

const parsePropfindBody = (
	req: Request,
): Effect.Effect<PropfindKind, DavError> =>
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
				Effect.catchTag("XmlParseError", () =>
					Effect.succeed({ type: "allprop" } satisfies PropfindKind),
				),
			);
		}),
	);

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

/**
 * Href for a directly-accessed instance: mirrors the URL segments the client used.
 */
const instanceHref = (
	origin: string,
	principalSeg: string,
	ns: string,
	collectionSeg: string,
	instanceSeg: string,
): string =>
	`${origin}/dav/principals/${principalSeg}/${ns}/${collectionSeg}/${instanceSeg}`;

/**
 * Href for a depth:1 member instance that the client did not directly address.
 * Uses UUIDs, which are stable identifiers the client can use for subsequent requests.
 */
const memberInstanceHref = (
	origin: string,
	principalSeg: string,
	ns: string,
	collectionSeg: string,
	instanceRow: InstanceRow,
): string =>
	`${origin}/dav/principals/${principalSeg}/${ns}/${collectionSeg}/${instanceRow.id}`;

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
		[LOCK_DISCOVERY]: "",
		[SUPPORTED_LOCK]: "",
		[ACL_RESTRICTIONS]: ACL_RESTRICTIONS_VALUE,
		[SUPPORTED_REPORT_SET]: buildSupportedReportSet(row.collectionType),
	};

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
	origin = "",
): DavResponse => ({
	href,
	propstats: splitPropstats(buildCollectionProps(row, origin), request),
});

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
	DavError | DatabaseError,
	| CollectionService
	| InstanceService
	| AclService
	| PrincipalService
	| CalTimezoneRepository
	| GroupService
> =>
	Effect.gen(function* () {
		// Reject Depth: infinity (RFC 4918 §9.1 + DAV:propfind-finite-depth)
		const depthHeader = req.headers.get("Depth") ?? "0";
		if (depthHeader === "infinity") {
			return yield* forbidden("DAV:propfind-finite-depth");
		}
		const depth = depthHeader === "1" ? 1 : 0;

		// 404 for path kinds we don't serve yet (user/group paths handled by dedicated handlers)
		if (
			path.kind === "new-collection" ||
			path.kind === "new-instance" ||
			path.kind === "principalCollection" ||
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
			// RFC 6638 §2.2: scheduling inbox/outbox URLs for this principal.
			const inboxHref = `${origin}/dav/principals/${path.principalSeg}/cal/inbox/`;
			const outboxHref = `${origin}/dav/principals/${path.principalSeg}/cal/outbox/`;
			// RFC 3744 §4.4: list the groups this principal belongs to.
			const groupSvc = yield* GroupService;
			const memberOfGroups = yield* groupSvc.listByMember(
				UserId(principalRow.user.id),
			);
			const allProps: Record<ClarkName, unknown> = {
				[RESOURCETYPE]: { "{DAV:}principal": "" },
				...(displayName ? { [DISPLAYNAME]: displayName } : {}),
				// RFC 5397 §3: the acting user's principal URL
				[CURRENT_USER_PRINCIPAL]: { [cn(DAV_NS, "href")]: actingPrincipalHref },
				// RFC 3744 §4.2: canonical URL for this principal resource
				[PRINCIPAL_URL]: { [cn(DAV_NS, "href")]: principalHref },
				// RFC 4791 §6.2.1: home URL for calendar discovery
				[CAL_HOME_SET]: { [cn(DAV_NS, "href")]: principalHref },
				// RFC 6352 §6.2.1: home URL for addressbook discovery
				[CARD_HOME_SET]: { [cn(DAV_NS, "href")]: principalHref },
				// RFC 6638 §2.4.1: email addresses for attendee lookup
				[CAL_USER_ADDRESS_SET]: {
					[cn(DAV_NS, "href")]: `mailto:${principalRow.user.email}`,
				},
				// RFC 3744 §4.1: alternate URIs for this principal (e.g. mailto:)
				[DAV_ALTERNATE_URI_SET]: {
					[cn(DAV_NS, "href")]: `mailto:${principalRow.user.email}`,
				},
				// RFC 6638 §2.2: scheduling collection URLs
				[SCHEDULE_INBOX_URL]: { [cn(DAV_NS, "href")]: inboxHref },
				[SCHEDULE_OUTBOX_URL]: { [cn(DAV_NS, "href")]: outboxHref },
				// RFC 7809 §5.1: timezone distribution service used by this server.
				// SHOULD NOT be returned in allprop per spec, but included here for
				// consistency with other live properties. Clients that request it
				// explicitly will always receive it.
				[TIMEZONE_SERVICE_SET]: { [cn(DAV_NS, "href")]: `${origin}/timezones` },
				// RFC 3744 §4.4: groups this user belongs to
				[DAV_GROUP_MEMBERSHIP]: memberOfGroups.map((g) => ({
					[cn(DAV_NS, "href")]: `${origin}/dav/groups/${g.principal.id}/`,
				})),
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
				const [ownCollections, groupCollectionSets] = yield* Effect.all([
					collSvc.listByOwner(path.principalId),
					Effect.all(
						memberOfGroups.map((g) =>
							collSvc.listByOwner(PrincipalId(g.principal.id)),
						),
					),
				]);
				for (const coll of ownCollections) {
					const ns =
						(COLLECTION_TYPE_TO_NAMESPACE as Record<string, string>)[
							coll.collectionType
						] ?? "col";
					const href = collectionHref(origin, path.principalSeg, ns, coll.id);
					responses.push(collectionResponse(href, coll, propfind, origin));
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
						const href = collectionHref(origin, groupPrincipalSeg, ns, coll.id);
						responses.push(collectionResponse(href, coll, propfind, origin));
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
				[CURRENT_USER_PRIVILEGE_SET]: buildPrivilegeSet(collectionPrivileges),
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
				collProps[CAL_SUPPORTED_COLLATION_SET] = SUPPORTED_COLLATIONS;
			} else if (collRow.collectionType === "addressbook") {
				collProps[CARD_SUPPORTED_COLLATION_SET] = SUPPORTED_COLLATIONS;
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
				for (const inst of instances) {
					const iHref = memberInstanceHref(
						origin,
						path.principalSeg,
						path.namespace,
						path.collectionSeg,
						inst,
					);
					const instPrivileges = yield* acl.currentUserPrivileges(
						actingPrincipalId,
						InstanceId(inst.id),
						"instance",
					);
					const instProps: Record<ClarkName, unknown> = {
						...buildInstanceProps(inst),
						[CURRENT_USER_PRINCIPAL]: {
							[cn(DAV_NS, "href")]: actingPrincipalHref,
						},
						[CURRENT_USER_PRIVILEGE_SET]: buildPrivilegeSet(instPrivileges),
						// RFC 3744 §5.1: owner inherited from the parent collection
						[DAV_OWNER]: { [cn(DAV_NS, "href")]: ownerHref },
					};
					// DAV:acl — RFC 3744 §5.5: only when the caller holds read-acl.
					if (
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
		} else if (path.kind === "root") {
			// RFC 6764 §6.1 / RFC 5397 §3: root resource exposes DAV:current-user-principal
			// so auto-discovery clients can bootstrap without knowing any principal URL.
			responses.push({
				href: `${origin}/dav/`,
				propstats: splitPropstats(
					{
						[RESOURCETYPE]: { [cn(DAV_NS, "collection")]: "" },
						[CURRENT_USER_PRINCIPAL]: {
							[cn(DAV_NS, "href")]: actingPrincipalHref,
						},
					},
					propfind,
				),
			});
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
				[CURRENT_USER_PRIVILEGE_SET]: buildPrivilegeSet(instancePrivileges),
				// RFC 3744 §5.1: owner inherited from the parent collection
				[DAV_OWNER]: { [cn(DAV_NS, "href")]: ownerHref },
			};
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
