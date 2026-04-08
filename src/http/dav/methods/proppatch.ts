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

import { Effect } from "effect";
import { type ClarkName, cn, type IrDeadProperties } from "#src/data/ir.ts";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import { forbidden, notFound } from "#src/domain/errors.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { normalizeClarkNames } from "#src/http/dav/xml/clark.ts";
import type { DavResponse, Propstat } from "#src/http/dav/xml/multistatus.ts";
import { multistatusResponse } from "#src/http/dav/xml/multistatus.ts";
import { parseXml, readXmlBody } from "#src/http/dav/xml/parser.ts";
import { AclService } from "#src/services/acl/index.ts";
import { CollectionService } from "#src/services/collection/index.ts";
import { InstanceService } from "#src/services/instance/index.ts";
import { PrincipalService } from "#src/services/principal/service.ts";

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

const parseProppatchBody = (req: Request): Effect.Effect<PropOp, DavError> =>
	readXmlBody(req).pipe(
		Effect.flatMap((body) => {
			if (body.trim() === "") {
				return Effect.fail(forbidden(undefined, "Empty PROPPATCH body"));
			}
			return parseXml(body).pipe(
				Effect.map((raw) => {
					const tree = normalizeClarkNames(raw) as Record<string, unknown>;
					const update = tree[cn(DAV_NS, "propertyupdate")] as
						| Record<string, unknown>
						| undefined;

					const set = new Map<ClarkName, unknown>();
					const remove = new Set<ClarkName>();

					if (update) {
						for (const setEl of toArray(update[cn(DAV_NS, "set")])) {
							if (typeof setEl !== "object" || setEl === null) {
								continue;
							}
							const prop = (setEl as Record<string, unknown>)[
								cn(DAV_NS, "prop")
							];
							if (typeof prop !== "object" || prop === null) {
								continue;
							}
							for (const [k, v] of Object.entries(
								prop as Record<string, unknown>,
							)) {
								if (!k.startsWith("@_")) {
									set.set(k as ClarkName, v);
								}
							}
						}

						for (const removeEl of toArray(update[cn(DAV_NS, "remove")])) {
							if (typeof removeEl !== "object" || removeEl === null) {
								continue;
							}
							const prop = (removeEl as Record<string, unknown>)[
								cn(DAV_NS, "prop")
							];
							if (typeof prop !== "object" || prop === null) {
								continue;
							}
							for (const k of Object.keys(prop as Record<string, unknown>)) {
								if (!k.startsWith("@_")) {
									remove.add(k as ClarkName);
								}
							}
						}
					}

					return { set, remove } satisfies PropOp;
				}),
				Effect.catchTag("XmlParseError", () =>
					Effect.fail(forbidden(undefined, "Invalid PROPPATCH XML")),
				),
			);
		}),
	);

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
	CollectionService | InstanceService | AclService | PrincipalService
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
			path.kind === "newGroupMember"
		) {
			return yield* notFound();
		}

		const actingPrincipalId =
			ctx.auth._tag === "Authenticated"
				? ctx.auth.principal.principalId
				: path.principalId;

		const { set, remove } = yield* parseProppatchBody(req);
		const acl = yield* AclService;
		const origin = ctx.url.origin;

		// All names in request order: set first, then removes not already in set
		const allNames: Array<ClarkName> = [
			...set.keys(),
			...[...remove].filter((n) => !set.has(n)),
		];

		// -----------------------------------------------------------------------
		// Collection
		// -----------------------------------------------------------------------
		if (path.kind === "collection") {
			yield* acl.check(
				actingPrincipalId,
				path.collectionId,
				"collection",
				"DAV:write-properties",
			);

			const collSvc = yield* CollectionService;
			const collRow = yield* collSvc.findById(path.collectionId);

			const failedNames = new Set<ClarkName>();
			type LiveField = "displayName" | "description";
			const liveFields = new Map<ClarkName, LiveField>();
			const deadNames = new Set<ClarkName>();

			for (const name of allNames) {
				if (PROTECTED_PROPS.has(name)) {
					failedNames.add(name);
				} else {
					const live = COLLECTION_LIVE_PROPS.get(name);
					if (live) {
						if (
							live.collectionType !== "any" &&
							collRow.collectionType !== live.collectionType
						) {
							// Property is valid but not for this collection type
							failedNames.add(name);
						} else {
							liveFields.set(name, live.field);
						}
					} else {
						deadNames.add(name);
					}
				}
			}

			const href = `${origin}/dav/principals/${path.principalSeg}/${path.namespace}/${path.collectionSeg}/`;

			if (failedNames.size > 0) {
				return yield* multistatusResponse([
					{
						href,
						propstats: buildFailurePropstats(allNames, failedNames),
					} satisfies DavResponse,
				]);
			}

			// Compute new clientProperties (dead props only)
			const currentDead = (collRow.clientProperties ?? {}) as IrDeadProperties;
			const newDead: Record<ClarkName, unknown> = { ...currentDead };
			for (const name of deadNames) {
				if (set.has(name)) {
					newDead[name] = set.get(name);
				} else {
					delete newDead[name];
				}
			}

			// Compute live field changes
			let newDisplayName: string | null | undefined;
			let newDescription: string | null | undefined;
			for (const [name, field] of liveFields) {
				const value = set.has(name) ? (set.get(name) ?? null) : null;
				const strValue = value !== null ? String(value) : null;
				if (field === "displayName") {
					newDisplayName = strValue;
				} else if (field === "description") {
					newDescription = strValue;
				}
			}

			yield* collSvc.updateProperties(path.collectionId, {
				clientProperties: newDead as IrDeadProperties,
				...(newDisplayName !== undefined
					? { displayName: newDisplayName }
					: {}),
				...(newDescription !== undefined
					? { description: newDescription }
					: {}),
			});

			return yield* multistatusResponse([
				{
					href,
					propstats: buildSuccessPropstats(allNames),
				} satisfies DavResponse,
			]);
		}

		// -----------------------------------------------------------------------
		// Instance
		// -----------------------------------------------------------------------
		if (path.kind === "instance") {
			yield* acl.check(
				actingPrincipalId,
				path.instanceId,
				"instance",
				"DAV:write-properties",
			);

			const instSvc = yield* InstanceService;
			const instRow = yield* instSvc.findById(path.instanceId);

			const failedNames = new Set<ClarkName>();
			for (const name of allNames) {
				if (PROTECTED_PROPS.has(name)) {
					failedNames.add(name);
				}
			}

			const href = `${origin}/dav/principals/${path.principalSeg}/${path.namespace}/${path.collectionSeg}/${path.instanceSeg}`;

			if (failedNames.size > 0) {
				return yield* multistatusResponse([
					{
						href,
						propstats: buildFailurePropstats(allNames, failedNames),
					} satisfies DavResponse,
				]);
			}

			const currentDead = (instRow.clientProperties ?? {}) as IrDeadProperties;
			const newDead: Record<ClarkName, unknown> = { ...currentDead };
			for (const name of allNames) {
				if (set.has(name)) {
					newDead[name] = set.get(name);
				} else {
					delete newDead[name];
				}
			}

			yield* instSvc.updateClientProperties(
				path.instanceId,
				newDead as IrDeadProperties,
			);

			return yield* multistatusResponse([
				{
					href,
					propstats: buildSuccessPropstats(allNames),
				} satisfies DavResponse,
			]);
		}

		// -----------------------------------------------------------------------
		// Principal
		// -----------------------------------------------------------------------

		// path.kind === "principal"
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
		const liveFields = new Map<ClarkName, "displayName">();
		const deadNames = new Set<ClarkName>();

		for (const name of allNames) {
			if (PROTECTED_PROPS.has(name)) {
				failedNames.add(name);
			} else {
				const field = PRINCIPAL_LIVE_PROPS.get(name);
				if (field) {
					liveFields.set(name, field);
				} else {
					deadNames.add(name);
				}
			}
		}

		const principalHref = `${origin}/dav/principals/${path.principalSeg}/`;

		if (failedNames.size > 0) {
			return yield* multistatusResponse([
				{
					href: principalHref,
					propstats: buildFailurePropstats(allNames, failedNames),
				} satisfies DavResponse,
			]);
		}

		const currentDead = (principalRow.clientProperties ??
			{}) as IrDeadProperties;
		const newDead: Record<ClarkName, unknown> = { ...currentDead };
		for (const name of deadNames) {
			if (set.has(name)) {
				newDead[name] = set.get(name);
			} else {
				delete newDead[name];
			}
		}

		let newDisplayName: string | null | undefined;
		for (const [name] of liveFields) {
			const value = set.has(name) ? (set.get(name) ?? null) : null;
			newDisplayName = value !== null ? String(value) : null;
		}

		yield* principalSvc.updateProperties(path.principalId, {
			clientProperties: newDead as IrDeadProperties,
			...(newDisplayName !== undefined ? { displayName: newDisplayName } : {}),
		});

		return yield* multistatusResponse([
			{
				href: principalHref,
				propstats: buildSuccessPropstats(allNames),
			} satisfies DavResponse,
		]);
	});
