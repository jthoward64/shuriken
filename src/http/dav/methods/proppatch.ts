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
import { type ClarkName, cn, type IrDeadProperties } from "#src/data/ir.ts";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import {
	badRequest,
	forbidden,
	notFound,
	unauthorized,
} from "#src/domain/errors.ts";
import { CollectionId, isUuid } from "#src/domain/ids.ts";
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
import { IanaTimezoneService } from "#src/services/timezone/iana.ts";
import { CalTimezoneRepository } from "#src/services/timezone/index.ts";

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

/**
 * Extract the TZID from a raw VTIMEZONE/VCALENDAR iCalendar text string.
 * Returns null if no TZID line is found.
 */
const extractTzidFromVtimezone = (raw: string): string | null => {
	const match = /^TZID[;:]([^\r\n]+)/m.exec(raw);
	return match?.[1]?.trim() ?? null;
};

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
					Effect.fail(badRequest("Invalid PROPPATCH XML")),
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
	| CollectionService
	| InstanceService
	| AclService
	| PrincipalService
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
				} else if (
					name === CALENDAR_TIMEZONE_PROP ||
					name === CALENDAR_TIMEZONE_ID_PROP
				) {
					// calendar-timezone and calendar-timezone-id are live properties for
					// calendar collections only. Both are handled separately below.
					if (collRow.collectionType !== "calendar") {
						failedNames.add(name);
					}
				} else if (name === SCHEDULE_CALENDAR_TRANSP_PROP) {
					// Valid on calendar, inbox, and outbox collections only.
					if (
						collRow.collectionType !== "calendar" &&
						collRow.collectionType !== "inbox" &&
						collRow.collectionType !== "outbox"
					) {
						failedNames.add(name);
					}
				} else if (name === SCHEDULE_DEFAULT_CAL_URL_PROP) {
					// Valid on inbox collections only.
					if (collRow.collectionType !== "inbox") {
						failedNames.add(name);
					}
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

			// CALDAV:calendar-timezone — RFC 4791 §5.2.2
			// CALDAV:calendar-timezone-id — RFC 7809 §5.2
			//
			// Both properties control the same underlying timezoneTzid field.
			// calendar-timezone wins if both are present (it carries full VTIMEZONE data).
			// When either is set, we also upsert the VTIMEZONE data into cal_timezone so
			// the cache is populated from PROPPATCH (not only from PUT).
			let newTimezoneTzid: string | null | undefined;
			if (collRow.collectionType === "calendar") {
				if (set.has(CALENDAR_TIMEZONE_PROP)) {
					const rawVal = set.get(CALENDAR_TIMEZONE_PROP);
					const valStr = typeof rawVal === "string" ? rawVal : "";
					const tzid = extractTzidFromVtimezone(valStr);
					if (tzid !== null && valStr) {
						// Upsert the client-provided VTIMEZONE into the cache.
						const tzRepo = yield* CalTimezoneRepository;
						yield* tzRepo.upsert(tzid, valStr, Option.none(), Option.none());
					}
					newTimezoneTzid = tzid;
				} else if (set.has(CALENDAR_TIMEZONE_ID_PROP)) {
					// calendar-timezone-id: validate TZID against known IANA timezones.
					const rawVal = set.get(CALENDAR_TIMEZONE_ID_PROP);
					const tzid =
						typeof rawVal === "string"
							? rawVal.trim()
							: typeof rawVal === "object" &&
									rawVal !== null &&
									"#text" in (rawVal as Record<string, unknown>)
								? String((rawVal as Record<string, unknown>)["#text"]).trim()
								: null;
					if (tzid) {
						const ianaSvc = yield* IanaTimezoneService;
						if (!ianaSvc.isKnownTzid(tzid)) {
							return yield* forbidden("CALDAV:valid-calendar-timezone");
						}
						// Upsert the IANA VTIMEZONE into the cache.
						const vtOpt = ianaSvc.getVtimezone(tzid);
						if (Option.isSome(vtOpt)) {
							const tzRepo = yield* CalTimezoneRepository;
							yield* tzRepo.upsert(
								tzid,
								vtOpt.value,
								Option.none(),
								Option.none(),
							);
						}
						newTimezoneTzid = tzid;
					}
				} else if (
					remove.has(CALENDAR_TIMEZONE_PROP) ||
					remove.has(CALENDAR_TIMEZONE_ID_PROP)
				) {
					newTimezoneTzid = null;
				}
			}

			// RFC 6638 §9.1: schedule-calendar-transp
			let newScheduleTransp: "opaque" | "transparent" | null | undefined;
			if (set.has(SCHEDULE_CALENDAR_TRANSP_PROP)) {
				const rawVal = set.get(SCHEDULE_CALENDAR_TRANSP_PROP);
				// Value is an element like <C:opaque/> or <C:transparent/>
				if (
					typeof rawVal === "object" &&
					rawVal !== null &&
					`{${CALDAV_NS}}opaque` in (rawVal as Record<string, unknown>)
				) {
					newScheduleTransp = "opaque";
				} else if (
					typeof rawVal === "object" &&
					rawVal !== null &&
					`{${CALDAV_NS}}transparent` in (rawVal as Record<string, unknown>)
				) {
					newScheduleTransp = "transparent";
				}
			} else if (remove.has(SCHEDULE_CALENDAR_TRANSP_PROP)) {
				newScheduleTransp = null; // reset to default "opaque"
			}

			// RFC 6638 §9.2: schedule-default-calendar-URL
			let newScheduleDefaultCalendarId: CollectionId | null | undefined;
			if (set.has(SCHEDULE_DEFAULT_CAL_URL_PROP)) {
				const rawVal = set.get(SCHEDULE_DEFAULT_CAL_URL_PROP);
				// Value is an element containing a <D:href>
				const hrefObj =
					typeof rawVal === "object" && rawVal !== null
						? (rawVal as Record<string, unknown>)
						: null;
				const hrefStr = hrefObj ? String(hrefObj[`{${DAV_NS}}href`] ?? "") : "";
				// Extract the last non-empty path segment as the collection UUID/slug.
				const segments = hrefStr.replace(/\/$/, "").split("/");
				const lastSeg = segments.at(-1) ?? "";
				if (isUuid(lastSeg)) {
					// Look up the collection to validate it exists and belongs to this principal.
					const targetOpt = yield* collSvc
						.findById(CollectionId(lastSeg))
						.pipe(Effect.option);
					const target = Option.getOrNull(targetOpt);
					if (
						target !== null &&
						target.collectionType === "calendar" &&
						target.ownerPrincipalId === path.principalId
					) {
						newScheduleDefaultCalendarId = CollectionId(lastSeg);
					}
				}
			} else if (remove.has(SCHEDULE_DEFAULT_CAL_URL_PROP)) {
				newScheduleDefaultCalendarId = null;
			}

			yield* collSvc.updateProperties(path.collectionId, {
				clientProperties: newDead as IrDeadProperties,
				...(newDisplayName !== undefined
					? { displayName: newDisplayName }
					: {}),
				...(newDescription !== undefined
					? { description: newDescription }
					: {}),
				...(newTimezoneTzid !== undefined
					? { timezoneTzid: newTimezoneTzid }
					: {}),
				...(newScheduleTransp !== undefined
					? { scheduleTransp: newScheduleTransp }
					: {}),
				...(newScheduleDefaultCalendarId !== undefined
					? { scheduleDefaultCalendarId: newScheduleDefaultCalendarId }
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
