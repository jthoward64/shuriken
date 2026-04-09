// ---------------------------------------------------------------------------
// CALDAV:free-busy-query REPORT — RFC 4791 §7.10
//
// Generates a VFREEBUSY component for all VEVENTs (OPAQUE/default TRANSP)
// and VFREEBUSY components in the collection that overlap the requested
// time range.
//
// Response: raw iCalendar text (not multistatus), Content-Type: text/calendar.
// ---------------------------------------------------------------------------

import { Effect, Option } from "effect";
import { Temporal } from "temporal-polyfill";
import {
	effectiveDtend,
	getDtstartInstant,
} from "#src/data/icalendar/ir-helpers.ts";
import type { IrComponent } from "#src/data/ir.ts";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import {
	badRequest,
	methodNotAllowed,
	unauthorized,
} from "#src/domain/errors.ts";
import { EntityId } from "#src/domain/ids.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_OK } from "#src/http/status.ts";
import { AclService } from "#src/services/acl/index.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { InstanceService } from "#src/services/instance/index.ts";

const CALDAV_NS = "urn:ietf:params:xml:ns:caldav";

// RFC 5545 §3.1: fold threshold and continuation indent
const FOLD_LIMIT = 75;
const FOLD_CONTINUATION_LIMIT = 74;
const PAD2 = 2;
const PAD4 = 4;

// ---------------------------------------------------------------------------
// Free-busy period type — derived from TRANSP + STATUS
// ---------------------------------------------------------------------------

type FbType = "BUSY" | "BUSY-TENTATIVE";

/** Returns null if the VEVENT should be considered FREE (transparent or cancelled). */
const deriveFbType = (comp: IrComponent): FbType | null => {
	const transpProp = comp.properties.find((p) => p.name === "TRANSP");
	const transp =
		transpProp?.value.type === "TEXT" ? transpProp.value.value : "OPAQUE";

	if (transp === "TRANSPARENT") {
		return null;
	}

	const statusProp = comp.properties.find((p) => p.name === "STATUS");
	const status =
		statusProp?.value.type === "TEXT" ? statusProp.value.value : "CONFIRMED";

	if (status === "CANCELLED") {
		return null;
	}
	if (status === "TENTATIVE") {
		return "BUSY-TENTATIVE";
	}
	return "BUSY";
};

// ---------------------------------------------------------------------------
// Coalesce overlapping periods of the same FBTYPE
// ---------------------------------------------------------------------------

interface Period {
	start: Temporal.Instant;
	end: Temporal.Instant;
	fbType: FbType;
}

const coalescePeriods = (periods: ReadonlyArray<Period>): Array<Period> => {
	const groups = new Map<
		FbType,
		Array<{ start: Temporal.Instant; end: Temporal.Instant }>
	>();
	for (const p of periods) {
		const group = groups.get(p.fbType) ?? [];
		group.push({ start: p.start, end: p.end });
		groups.set(p.fbType, group);
	}
	const result: Array<Period> = [];
	for (const [fbType, intervals] of groups) {
		intervals.sort(
			(a, b) => a.start.epochMilliseconds - b.start.epochMilliseconds,
		);
		let current: { start: Temporal.Instant; end: Temporal.Instant } | undefined;
		for (const iv of intervals) {
			if (!current) {
				current = { start: iv.start, end: iv.end };
			} else if (iv.start.epochMilliseconds <= current.end.epochMilliseconds) {
				if (iv.end.epochMilliseconds > current.end.epochMilliseconds) {
					current = { start: current.start, end: iv.end };
				}
			} else {
				result.push({ ...current, fbType });
				current = { start: iv.start, end: iv.end };
			}
		}
		if (current) {
			result.push({ ...current, fbType });
		}
	}
	result.sort((a, b) => a.start.epochMilliseconds - b.start.epochMilliseconds);
	return result;
};

// ---------------------------------------------------------------------------
// Format Instant as iCalendar UTC datetime string (e.g. 20060102T150405Z)
// ---------------------------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(PAD2, "0");
const pad4 = (n: number) => String(n).padStart(PAD4, "0");

const formatUtcDt = (instant: Temporal.Instant): string => {
	const d = new Date(instant.epochMilliseconds);
	return `${pad4(d.getUTCFullYear())}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`;
};

// ---------------------------------------------------------------------------
// RFC 5545 §3.1: fold lines > 75 octets with CRLF + SP
// ---------------------------------------------------------------------------

const foldLine = (line: string): string => {
	if (line.length <= FOLD_LIMIT) {
		return line;
	}
	let result = "";
	let remaining = line;
	let first = true;
	while (remaining.length > 0) {
		const limit = first ? FOLD_LIMIT : FOLD_CONTINUATION_LIMIT;
		result += `${first ? "" : "\r\n "}${remaining.slice(0, limit)}`;
		remaining = remaining.slice(limit);
		first = false;
	}
	return result;
};

// ---------------------------------------------------------------------------
// Build VFREEBUSY iCalendar text
// ---------------------------------------------------------------------------

const buildVfreebusyText = (
	queryStart: Temporal.Instant,
	queryEnd: Temporal.Instant,
	periods: ReadonlyArray<Period>,
): string => {
	const now = new Date();
	const dtstamp = `${pad4(now.getUTCFullYear())}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}T${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}${pad2(now.getUTCSeconds())}Z`;

	const lines: Array<string> = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//shuriken-ts//CalDAV//EN",
		"BEGIN:VFREEBUSY",
		`DTSTAMP:${dtstamp}`,
		`DTSTART:${formatUtcDt(queryStart)}`,
		`DTEND:${formatUtcDt(queryEnd)}`,
	];

	for (const p of periods) {
		const period = `${formatUtcDt(p.start)}/${formatUtcDt(p.end)}`;
		if (p.fbType === "BUSY") {
			lines.push(`FREEBUSY:${period}`);
		} else {
			lines.push(`FREEBUSY;FBTYPE=${p.fbType}:${period}`);
		}
	}

	lines.push("END:VFREEBUSY", "END:VCALENDAR");
	return `${lines.map(foldLine).join("\r\n")}\r\n`;
};

// ---------------------------------------------------------------------------
// Parse a PERIOD string (RFC 5545 §3.3.9) to { start, end } Instants.
// Format: <date-time>/<date-time>  OR  <date-time>/<duration>
// Returns undefined for floating times or parse failures.
// ---------------------------------------------------------------------------

const parsePeriodString = (
	s: string,
): { start: Temporal.Instant; end: Temporal.Instant } | undefined => {
	const slash = s.indexOf("/");
	if (slash === -1) {
		return undefined;
	}
	const startStr = s.slice(0, slash);
	const endStr = s.slice(slash + 1);
	try {
		const start = Temporal.Instant.from(startStr);
		if (endStr.startsWith("P") || endStr.startsWith("-P")) {
			const end = start.add(Temporal.Duration.from(endStr));
			return { start, end };
		}
		const end = Temporal.Instant.from(endStr);
		return { start, end };
	} catch {
		return undefined;
	}
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const freeBusyQueryHandler = (
	path: ResolvedDavPath,
	ctx: HttpRequestContext,
	tree: unknown,
): Effect.Effect<
	Response,
	DavError | DatabaseError,
	InstanceService | ComponentRepository | AclService
> =>
	Effect.gen(function* () {
		if (path.kind !== "collection") {
			return yield* methodNotAllowed(
				"CALDAV:free-busy-query REPORT requires a collection URL",
			);
		}

		if (ctx.auth._tag !== "Authenticated") {
			return yield* unauthorized();
		}
		const actingPrincipalId = ctx.auth.principal.principalId;

		const acl = yield* AclService;
		yield* acl.check(
			actingPrincipalId,
			path.collectionId,
			"collection",
			"DAV:read",
		);

		// Parse time-range from request body
		const obj =
			typeof tree === "object" && tree !== null
				? (tree as Record<string, unknown>)
				: {};
		const trKey = `{${CALDAV_NS}}time-range`;
		const trEl = obj[trKey];
		if (typeof trEl !== "object" || trEl === null) {
			return yield* badRequest(
				"CALDAV:free-busy-query requires a time-range element",
			);
		}
		const trObj = trEl as Record<string, unknown>;
		const startStr =
			typeof trObj["@_start"] === "string" ? trObj["@_start"] : null;
		const endStr = typeof trObj["@_end"] === "string" ? trObj["@_end"] : null;
		if (!startStr || !endStr) {
			return yield* badRequest(
				"CALDAV:free-busy-query time-range requires start and end attributes",
			);
		}

		let queryStart: Temporal.Instant;
		let queryEnd: Temporal.Instant;
		try {
			queryStart = Temporal.Instant.from(startStr);
			queryEnd = Temporal.Instant.from(endStr);
		} catch {
			return yield* badRequest("Invalid time-range instant format");
		}

		// Load all instances and compute free-busy periods
		const instSvc = yield* InstanceService;
		const instances = yield* instSvc.listByCollection(path.collectionId);

		const componentRepo = yield* ComponentRepository;
		const periods: Array<Period> = [];

		for (const inst of instances) {
			const treeOpt = yield* componentRepo.loadTree(
				EntityId(inst.entityId),
				"icalendar",
			);
			if (Option.isNone(treeOpt)) {
				continue;
			}
			const root = treeOpt.value;

			for (const comp of root.components) {
				if (comp.name === "VEVENT") {
					const fbType = deriveFbType(comp);
					if (fbType === null) {
						continue;
					}
					const dtstart = getDtstartInstant(comp);
					if (!dtstart) {
						continue; // Floating time — no timezone context, skip
					}
					const dtend = effectiveDtend(comp, dtstart);

					// Skip if outside query range
					if (
						dtstart.epochMilliseconds >= queryEnd.epochMilliseconds ||
						dtend.epochMilliseconds <= queryStart.epochMilliseconds
					) {
						continue;
					}

					// Clamp to query range
					const periodStart =
						dtstart.epochMilliseconds < queryStart.epochMilliseconds
							? queryStart
							: dtstart;
					const periodEnd =
						dtend.epochMilliseconds > queryEnd.epochMilliseconds
							? queryEnd
							: dtend;

					periods.push({ start: periodStart, end: periodEnd, fbType });
				} else if (comp.name === "VFREEBUSY") {
					for (const prop of comp.properties) {
						if (prop.name !== "FREEBUSY") {
							continue;
						}
						const fbtypeParam = prop.parameters.find(
							(pa) => pa.name === "FBTYPE",
						);
						const fbType: FbType =
							fbtypeParam?.value === "BUSY-TENTATIVE"
								? "BUSY-TENTATIVE"
								: "BUSY";

						// Value may be PERIOD (single string) or PERIOD_LIST (array of strings)
						const periodStrings: Array<string> =
							prop.value.type === "PERIOD"
								? [prop.value.value]
								: prop.value.type === "PERIOD_LIST"
									? (prop.value.value as ReadonlyArray<string>).slice()
									: [];

						for (const ps of periodStrings) {
							const parsed = parsePeriodString(ps);
							if (!parsed) {
								continue;
							}
							const { start: pStart, end: pEnd } = parsed;
							if (
								pStart.epochMilliseconds >= queryEnd.epochMilliseconds ||
								pEnd.epochMilliseconds <= queryStart.epochMilliseconds
							) {
								continue;
							}
							const clampStart =
								pStart.epochMilliseconds < queryStart.epochMilliseconds
									? queryStart
									: pStart;
							const clampEnd =
								pEnd.epochMilliseconds > queryEnd.epochMilliseconds
									? queryEnd
									: pEnd;
							periods.push({ start: clampStart, end: clampEnd, fbType });
						}
					}
				}
			}
		}

		const coalesced = coalescePeriods(periods);
		const body = buildVfreebusyText(queryStart, queryEnd, coalesced);
		const bodyBytes = new TextEncoder().encode(body);

		return new Response(bodyBytes, {
			status: HTTP_OK,
			headers: {
				"Content-Type": "text/calendar; charset=utf-8",
				"Content-Length": String(bodyBytes.byteLength),
			},
		});
	});
