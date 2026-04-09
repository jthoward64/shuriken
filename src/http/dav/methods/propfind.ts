// ---------------------------------------------------------------------------
// PROPFIND handler — RFC 4918 §9.1
//
// Supported path kinds:
//   collection  → collection properties + (Depth:1) instance members
//   instance    → instance properties only
//   principal   → minimal home-set properties
//   new-collection / new-instance → 404
//   root / principalCollection / wellknown → 404 (not yet implemented)
//
// Depth: infinity is rejected with 403 DAV:propfind-finite-depth (RFC 4918 §9.1).
// Missing Depth header defaults to 0 per RFC 4918 §9.1.
// ---------------------------------------------------------------------------

import { Effect, Option } from "effect";
import { type ClarkName, cn, type IrDeadProperties } from "#src/data/ir.ts";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import { forbidden, notFound, unauthorized } from "#src/domain/errors.ts";
import { InstanceId } from "#src/domain/ids.ts";
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
const SCHEDULE_INBOX_URL = cn(CALDAV_NS, "schedule-inbox-URL");
const SCHEDULE_OUTBOX_URL = cn(CALDAV_NS, "schedule-outbox-URL");

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
									[cn(DAV_NS, "href")]: `${origin}/dav/principals/${ace.principalId}/`,
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

// ---------------------------------------------------------------------------
// Collection → DavResponse
// ---------------------------------------------------------------------------

const buildCollectionProps = (
	row: CollectionRow,
): Readonly<Record<ClarkName, unknown>> => {
	const resourcetype: Record<string, unknown> = {
		"{DAV:}collection": "",
	};
	if (row.collectionType === "calendar") {
		resourcetype[`{${CALDAV_NS}}calendar`] = "";
	} else if (row.collectionType === "addressbook") {
		resourcetype[`{${CARDDAV_NS}}addressbook`] = "";
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
): DavResponse => ({
	href,
	propstats: splitPropstats(buildCollectionProps(row), request),
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
	CollectionService | InstanceService | AclService | PrincipalService | CalTimezoneRepository
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
			const displayName =
				principalRow.principal.displayName ?? principalRow.user.name;
			const principalHref = `${origin}/dav/principals/${path.principalSeg}/`;
			// RFC 6638 §2.2: scheduling inbox/outbox URLs for this principal.
			const inboxHref = `${origin}/dav/principals/${path.principalSeg}/cal/inbox/`;
			const outboxHref = `${origin}/dav/principals/${path.principalSeg}/cal/outbox/`;
			const allProps: Record<ClarkName, unknown> = {
				[RESOURCETYPE]: { "{DAV:}principal": "" },
				[DISPLAYNAME]: displayName,
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
				// RFC 6638 §2.2: scheduling collection URLs
				[SCHEDULE_INBOX_URL]: { [cn(DAV_NS, "href")]: inboxHref },
				[SCHEDULE_OUTBOX_URL]: { [cn(DAV_NS, "href")]: outboxHref },
				// RFC 3744 §5.6: server operates grant-only, no-invert
				[ACL_RESTRICTIONS]: ACL_RESTRICTIONS_VALUE,
				// RFC 3744 §5.4: privileges the acting principal has on this resource
				[CURRENT_USER_PRIVILEGE_SET]: buildPrivilegeSet(principalPrivileges),
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
				const collections = yield* collSvc.listByOwner(path.principalId);
				for (const coll of collections) {
					const ns =
						(COLLECTION_TYPE_TO_NAMESPACE as Record<string, string>)[
							coll.collectionType
						] ?? "col";
					const href = collectionHref(origin, path.principalSeg, ns, coll.slug);
					responses.push(collectionResponse(href, coll, propfind));
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
				...buildCollectionProps(collRow),
				[CURRENT_USER_PRINCIPAL]: { [cn(DAV_NS, "href")]: actingPrincipalHref },
				[CURRENT_USER_PRIVILEGE_SET]: buildPrivilegeSet(collectionPrivileges),
				// RFC 3744 §5.1: owner of this resource
				[DAV_OWNER]: { [cn(DAV_NS, "href")]: ownerHref },
			};
			// CALDAV:calendar-timezone — RFC 4791 §5.2.2
			if (collRow.collectionType === "calendar" && collRow.timezoneTzid) {
				const tzRepo = yield* CalTimezoneRepository;
				const tzOpt = yield* tzRepo.findByTzid(collRow.timezoneTzid);
				const tzData = Option.getOrUndefined(tzOpt);
				if (tzData !== undefined) {
					collProps[CALENDAR_TIMEZONE] = tzData.vtimezoneData;
				}
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
						const instAces = yield* acl.getAces(InstanceId(inst.id), "instance");
						instProps[DAV_ACL] = buildAclValue(instAces, origin);
					}
					responses.push({
						href: iHref,
						propstats: splitPropstats(instProps, propfind),
					});
				}
			}
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
