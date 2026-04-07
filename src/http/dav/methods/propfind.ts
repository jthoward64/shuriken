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

import { Effect } from "effect";
import { type ClarkName, cn, type IrDeadProperties } from "#src/data/ir.ts";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import { forbidden, notFound } from "#src/domain/errors.ts";
import { COLLECTION_TYPE_TO_NAMESPACE } from "#src/domain/types/collection-namespace.ts";
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
import { CollectionService } from "#src/services/collection/index.ts";
import type { CollectionRow } from "#src/services/collection/repository.ts";
import { InstanceService } from "#src/services/instance/index.ts";
import type { InstanceRow } from "#src/services/instance/repository.ts";
import { PrincipalService } from "#src/services/principal/service.ts";

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
const CAL_DESCRIPTION = cn(CALDAV_NS, "calendar-description");
const CAL_SUPPORTED_COMPONENTS = cn(
	CALDAV_NS,
	"supported-calendar-component-set",
);
const CARD_DESCRIPTION = cn(CARDDAV_NS, "addressbook-description");

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
		const comps: Record<string, unknown> = {};
		for (const comp of row.supportedComponents) {
			comps[`{${CALDAV_NS}}comp`] = { "@_name": comp };
		}
		props[CAL_SUPPORTED_COMPONENTS] = comps;
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

const instanceResponse = (
	href: string,
	row: InstanceRow,
	request: PropfindKind,
): DavResponse => ({
	href,
	propstats: splitPropstats(buildInstanceProps(row), request),
});

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
	CollectionService | InstanceService | AclService | PrincipalService
> =>
	Effect.gen(function* () {
		// Reject Depth: infinity (RFC 4918 §9.1 + DAV:propfind-finite-depth)
		const depthHeader = req.headers.get("Depth") ?? "0";
		if (depthHeader === "infinity") {
			return yield* forbidden("DAV:propfind-finite-depth");
		}
		const depth = depthHeader === "1" ? 1 : 0;

		// 404 for path kinds we don't serve yet
		if (
			path.kind === "new-collection" ||
			path.kind === "new-instance" ||
			path.kind === "root" ||
			path.kind === "principalCollection" ||
			path.kind === "wellknown"
		) {
			return yield* notFound();
		}

		// Extract acting principal — all remaining path kinds carry principalId
		const actingPrincipalId =
			ctx.auth._tag === "Authenticated"
				? ctx.auth.principal.principalId
				: path.principalId;

		const propfind = yield* parsePropfindBody(req);
		const acl = yield* AclService;
		const collSvc = yield* CollectionService;
		const instSvc = yield* InstanceService;

		const origin = ctx.url.origin;
		const responses: Array<DavResponse> = [];

		if (path.kind === "principal") {
			// Minimal principal response — display name and resource type
			yield* acl.check(
				actingPrincipalId,
				path.principalId,
				"principal",
				"DAV:read",
			);
			const principalSvc = yield* PrincipalService;
			const principalRow = yield* principalSvc.findById(path.principalId);
			const displayName =
				principalRow.principal.displayName ?? principalRow.user.name;
			const principalHref = `${origin}/dav/principals/${path.principalSeg}/`;
			const allProps: Record<ClarkName, unknown> = {
				[RESOURCETYPE]: { "{DAV:}principal": "" },
				[DISPLAYNAME]: displayName,
			};
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
			const collRow = yield* collSvc.findById(path.collectionId);
			const href = collectionHref(
				origin,
				path.principalSeg,
				path.namespace,
				path.collectionSeg,
			);
			responses.push(collectionResponse(href, collRow, propfind));

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
					responses.push(instanceResponse(iHref, inst, propfind));
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
			const instRow = yield* instSvc.findById(path.instanceId);
			const href = instanceHref(
				origin,
				path.principalSeg,
				path.namespace,
				path.collectionSeg,
				path.instanceSeg,
			);
			responses.push(instanceResponse(href, instRow, propfind));
		}

		return yield* multistatusResponse(responses);
	});
