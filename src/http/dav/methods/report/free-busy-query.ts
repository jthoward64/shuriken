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
	buildVfreebusyText,
	coalescePeriods,
	deriveFbType,
	type FbType,
	type Period,
	parsePeriodString,
} from "#src/data/icalendar/freebusy.ts";
import {
	effectiveDtend,
	getDtstartInstant,
} from "#src/data/icalendar/ir-helpers.ts";
import { getOccurrenceInstantsInRange } from "#src/data/icalendar/recurrence/recurrence-check.ts";
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

					const hasRrule = comp.properties.some((p) => p.name === "RRULE");

					// Recurrence-ID overrides are handled by their master's RRULE expansion;
					// skip them here unless they are themselves the master (no RECURRENCE-ID).
					const isOverride = comp.properties.some(
						(p) => p.name === "RECURRENCE-ID",
					);
					if (isOverride) {
						continue;
					}

					// Collect (dtstart, dtend) pairs — one per occurrence for recurring events,
					// or just the single instance for non-recurring events.
					const occurrencePairs: Array<{
						start: Temporal.Instant;
						end: Temporal.Instant;
					}> = [];

					if (hasRrule) {
						const masterDtstart = getDtstartInstant(comp);
						if (!masterDtstart) {
							continue; // Floating — no timezone context, skip
						}
						const duration =
							effectiveDtend(comp, masterDtstart).epochMilliseconds -
							masterDtstart.epochMilliseconds;

						const starts = getOccurrenceInstantsInRange(
							root,
							comp,
							queryStart,
							queryEnd,
						);
						for (const start of starts) {
							occurrencePairs.push({
								start,
								end: Temporal.Instant.fromEpochMilliseconds(
									start.epochMilliseconds + duration,
								),
							});
						}
					} else {
						const dtstart = getDtstartInstant(comp);
						if (!dtstart) {
							continue; // Floating time — no timezone context, skip
						}
						const dtend = effectiveDtend(comp, dtstart);
						// Skip if entirely outside query range
						if (
							dtstart.epochMilliseconds >= queryEnd.epochMilliseconds ||
							dtend.epochMilliseconds <= queryStart.epochMilliseconds
						) {
							continue;
						}
						occurrencePairs.push({ start: dtstart, end: dtend });
					}

					for (const { start: occStart, end: occEnd } of occurrencePairs) {
						// Clamp to query range
						const periodStart =
							occStart.epochMilliseconds < queryStart.epochMilliseconds
								? queryStart
								: occStart;
						const periodEnd =
							occEnd.epochMilliseconds > queryEnd.epochMilliseconds
								? queryEnd
								: occEnd;
						periods.push({ start: periodStart, end: periodEnd, fbType });
					}
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
