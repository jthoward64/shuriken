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
import { AppConfigService } from "#src/config.ts";
import { resolveCalendarZone } from "#src/data/icalendar/calendar-zone.ts";
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
import {
	getOccurrenceInstantsInRange,
	type RruleExpansionLimits,
} from "#src/data/icalendar/recurrence/recurrence-check.ts";
import type { ResolutionZone } from "#src/data/icalendar/resolve-floating.ts";
import type { IrComponent, IrProperty } from "#src/data/ir.ts";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import {
	badRequest,
	methodNotAllowed,
	unauthorized,
} from "#src/domain/errors.ts";
import { EntityId, InstanceId, type UuidString } from "#src/domain/ids.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_OK } from "#src/http/status.ts";
import { AclService } from "#src/services/acl/index.ts";
import { CalIndexRepository } from "#src/services/cal-index/index.ts";
import { CollectionRepository } from "#src/services/collection/index.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { InstanceRepository } from "#src/services/instance/repository.ts";

const CALDAV_NS = "urn:ietf:params:xml:ns:caldav";

// ---------------------------------------------------------------------------
// Request time-range
// ---------------------------------------------------------------------------

/** The window a free-busy report is generated for */
interface QueryRange {
	readonly start: Temporal.Instant;
	readonly end: Temporal.Instant;
}

/** True when an unknown value is a plain (non-null) object */
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

/** A non-empty string attribute value */
const stringAttr = (raw: unknown): Option.Option<string> =>
	typeof raw === "string" && raw !== "" ? Option.some(raw) : Option.none();

/** Parse an ISO instant, yielding none for an unparseable value */
const parseInstant = Option.liftThrowable((iso: string) =>
	Temporal.Instant.from(iso),
);

/** Parse a time-range's two bounds, failing 400 when either is malformed */
const instantRange = (
	startStr: string,
	endStr: string,
): Effect.Effect<QueryRange, DavError> =>
	Option.match(Option.all([parseInstant(startStr), parseInstant(endStr)]), {
		onNone: () => Effect.fail(badRequest("Invalid time-range instant format")),
		onSome: ([start, end]) => Effect.succeed({ start, end }),
	});

/** Read the required `<C:time-range>` element from the report body */
const parseQueryRange = (
	tree: unknown,
): Effect.Effect<QueryRange, DavError> => {
	const obj: Record<string, unknown> = isRecord(tree) ? tree : {};
	const trEl = obj[`{${CALDAV_NS}}time-range`];
	if (!isRecord(trEl)) {
		return Effect.fail(
			badRequest("CALDAV:free-busy-query requires a time-range element"),
		);
	}
	return Option.match(
		Option.all([stringAttr(trEl["@_start"]), stringAttr(trEl["@_end"])]),
		{
			onNone: () =>
				Effect.fail(
					badRequest(
						"CALDAV:free-busy-query time-range requires start and end attributes",
					),
				),
			onSome: ([startStr, endStr]) => instantRange(startStr, endStr),
		},
	);
};

// ---------------------------------------------------------------------------
// Busy period collection
// ---------------------------------------------------------------------------

/** The query window plus how floating values and recurrences are resolved in it */
interface FreeBusyContext {
	readonly range: QueryRange;
	readonly zone: ResolutionZone;
	readonly limits: RruleExpansionLimits;
}

/** True when a period overlaps the query window */
const overlapsRange = (
	start: Temporal.Instant,
	end: Temporal.Instant,
	range: QueryRange,
): boolean =>
	start.epochMilliseconds < range.end.epochMilliseconds &&
	end.epochMilliseconds > range.start.epochMilliseconds;

/** Clip a period to the query window */
const clampToRange = (
	start: Temporal.Instant,
	end: Temporal.Instant,
	range: QueryRange,
): QueryRange => ({
	start:
		start.epochMilliseconds < range.start.epochMilliseconds
			? range.start
			: start,
	end: end.epochMilliseconds > range.end.epochMilliseconds ? range.end : end,
});

/**
 * Occurrences of one VEVENT that overlap the query window. A recurring master
 * is expanded; anything else - including an RFC 5545 §3.8.4.4 override, whose
 * rescheduled slot the master's expansion leaves out - contributes its own
 * DTSTART/effective DTEND.
 */
const veventOccurrences = (
	root: IrComponent,
	comp: IrComponent,
	ctx: FreeBusyContext,
): ReadonlyArray<QueryRange> => {
	if (comp.properties.some((p) => p.name === "RRULE")) {
		const masterDtstart = getDtstartInstant(comp, ctx.zone);
		if (!masterDtstart) {
			return []; // DTSTART absent or not a date value
		}
		const duration =
			effectiveDtend(comp, masterDtstart, ctx.zone).epochMilliseconds -
			masterDtstart.epochMilliseconds;
		return getOccurrenceInstantsInRange(root, comp, {
			queryStart: ctx.range.start,
			queryEnd: ctx.range.end,
			zone: ctx.zone,
			limits: ctx.limits,
		}).map((start) => ({
			start,
			end: Temporal.Instant.fromEpochMilliseconds(
				start.epochMilliseconds + duration,
			),
		}));
	}
	const dtstart = getDtstartInstant(comp, ctx.zone);
	if (!dtstart) {
		return []; // DTSTART absent or not a date value
	}
	const dtend = effectiveDtend(comp, dtstart, ctx.zone);
	return overlapsRange(dtstart, dtend, ctx.range)
		? [{ start: dtstart, end: dtend }]
		: [];
};

/** Busy periods contributed by one VEVENT, clipped to the query window */
const veventPeriods = (
	root: IrComponent,
	comp: IrComponent,
	ctx: FreeBusyContext,
): ReadonlyArray<Period> => {
	const fbType = deriveFbType(comp);
	if (fbType === null) {
		return [];
	}
	return veventOccurrences(root, comp, ctx).map((occ) => {
		const clamped = clampToRange(occ.start, occ.end, ctx.range);
		return { start: clamped.start, end: clamped.end, fbType };
	});
};

/** The PERIOD value(s) carried by a FREEBUSY property */
const periodValues = (prop: IrProperty): ReadonlyArray<string> =>
	prop.value.type === "PERIOD"
		? [prop.value.value]
		: prop.value.type === "PERIOD_LIST"
			? (prop.value.value as ReadonlyArray<string>)
			: [];

/** Busy periods from one FREEBUSY property, clipped to the query window */
const freebusyPropPeriods = (
	prop: IrProperty,
	range: QueryRange,
): ReadonlyArray<Period> => {
	const fbtypeParam = prop.parameters.find((pa) => pa.name === "FBTYPE");
	const fbType: FbType =
		fbtypeParam?.value === "BUSY-TENTATIVE" ? "BUSY-TENTATIVE" : "BUSY";
	return periodValues(prop)
		.flatMap((ps) => {
			const parsed = parsePeriodString(ps);
			return parsed === undefined ? [] : [parsed];
		})
		.filter((p) => overlapsRange(p.start, p.end, range))
		.map((p) => {
			const clamped = clampToRange(p.start, p.end, range);
			return { start: clamped.start, end: clamped.end, fbType };
		});
};

/** Busy periods contributed by every component of one calendar object */
const instancePeriods = (
	root: IrComponent,
	ctx: FreeBusyContext,
): ReadonlyArray<Period> =>
	root.components.flatMap((comp) => {
		if (comp.name === "VEVENT") {
			return veventPeriods(root, comp, ctx);
		}
		return comp.name === "VFREEBUSY"
			? comp.properties
					.filter((prop) => prop.name === "FREEBUSY")
					.flatMap((prop) => freebusyPropPeriods(prop, ctx.range))
			: [];
	});

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
	| InstanceRepository
	| CalIndexRepository
	| ComponentRepository
	| AclService
	| AppConfigService
	| CollectionRepository
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

		const config = yield* AppConfigService;
		const acl = yield* AclService;
		yield* acl.check(
			actingPrincipalId,
			path.collectionId,
			"collection",
			"CALDAV:read-free-busy",
		);

		// Parse time-range from request body
		const queryRange = yield* parseQueryRange(tree);
		const queryStart = queryRange.start;
		const queryEnd = queryRange.end;

		// RFC 4791 §5.2.2: free-busy reads floating and DATE values in the
		// collection's CALDAV:calendar-timezone. The report body carries no
		// timezone of its own, so the collection is the only named source.
		const collRepo = yield* CollectionRepository;
		const collOpt = yield* collRepo.findById(path.collectionId);
		const zone = resolveCalendarZone({
			collectionTzid: Option.getOrUndefined(collOpt)?.timezoneTzid,
		});

		// Narrow the candidate set in SQL: VEVENTs whose series could overlap the
		// query window, plus every VFREEBUSY (rare, unfiltered — its busy periods
		// aren't always bounded by DTSTART/DTEND, so we never drop one). This is a
		// correct superset; the per-occurrence expansion below does the exact pass.
		const instRepo = yield* InstanceRepository;
		const calIdx = yield* CalIndexRepository;
		const [veventIds, vfreebusyIds] = yield* Effect.all(
			[
				calIdx.findOverlappingRange(path.collectionId, "VEVENT", {
					start: queryStart,
					end: queryEnd,
					zone,
				}),
				calIdx.findByComponentType(path.collectionId, "VFREEBUSY"),
			],
			{ concurrency: "unbounded" },
		);
		const candidateIds = [...new Set([...veventIds, ...vfreebusyIds])];
		const instances = yield* instRepo.findByIds(
			candidateIds.map((id) => InstanceId(id as UuidString)),
		);

		const componentRepo = yield* ComponentRepository;

		// Batch-load every instance's tree in 3 queries instead of 3 per instance.
		const trees = yield* componentRepo.loadTreesByIds(
			instances.map((inst) => EntityId(inst.entityId)),
			"icalendar",
		);

		const fbCtx: FreeBusyContext = {
			range: queryRange,
			zone,
			limits: {
				maxOccurrencesChecked: config.recurrence.rruleMaxOccurrences,
				timeBudgetMs: config.recurrence.rruleTimeBudgetMs,
			},
		};
		const periods = instances.flatMap((inst) => {
			const root = trees.get(EntityId(inst.entityId));
			return root === undefined ? [] : instancePeriods(root, fbCtx);
		});

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
