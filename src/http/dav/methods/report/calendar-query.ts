// ---------------------------------------------------------------------------
// CALDAV:calendar-query REPORT — RFC 4791 §7.8
//
// Filter-based calendar search. Evaluates a <CALDAV:filter> against every
// candidate instance in the collection, optionally pre-filtered by the
// cal_index for time-range queries.
// ---------------------------------------------------------------------------

import { Effect, Option } from "effect";
import type { Temporal } from "temporal-polyfill";
import { AppConfigService } from "#src/config.ts";
import { resolveCalendarZone } from "#src/data/icalendar/calendar-zone.ts";
import { encodeICalendar } from "#src/data/icalendar/codec.ts";
import type { RruleExpansionLimits } from "#src/data/icalendar/recurrence/recurrence-check.ts";
import type { ResolutionZone } from "#src/data/icalendar/resolve-floating.ts";
import { redactDocumentToBusyOnly } from "#src/data/icalendar/visibility.ts";
import type { ClarkName, IrComponent, IrDocument } from "#src/data/ir.ts";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import {
	forbidden,
	methodNotAllowed,
	unauthorized,
} from "#src/domain/errors.ts";
import type { EntityId, UuidString } from "#src/domain/ids.ts";
import { InstanceId } from "#src/domain/ids.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { encodeSegment } from "#src/http/dav/encode-segment.ts";
import {
	buildInstanceProps,
	type PropfindKind,
	splitPropstats,
} from "#src/http/dav/methods/instance-props.ts";
import type { DavResponse } from "#src/http/dav/xml/multistatus.ts";
import { multistatusResponse } from "#src/http/dav/xml/multistatus.ts";
import { AclService } from "#src/services/acl/index.ts";
import { CalIndexRepository } from "#src/services/cal-index/index.ts";
import type { CalComponentType } from "#src/services/cal-index/repository.ts";
import { CollectionRepository } from "#src/services/collection/index.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import {
	InstanceRepository,
	InstanceService,
} from "#src/services/instance/index.ts";
import type { InstanceRow } from "#src/services/instance/repository.ts";
import { IanaTimezoneService } from "#src/services/timezone/iana.ts";
import {
	type CalendarDataSpec,
	parseCalendarDataSpec,
	stripKnownVtimezones,
	subsetIrDocument,
} from "./calendar-data.ts";
import {
	type CalFilter,
	evaluateCalFilter,
	parseCalFilter,
} from "./filter-cal.ts";
import { extractPropNames } from "./parse.ts";

const CALDAV_NS = "urn:ietf:params:xml:ns:caldav";
const cn = (local: string): ClarkName => `{${CALDAV_NS}}${local}` as ClarkName;

const CALENDAR_DATA = cn("calendar-data");

// ---------------------------------------------------------------------------
// Extract top-level component type from filter
// ---------------------------------------------------------------------------

/** Component names cal_index can pre-filter candidates on */
const CAL_COMPONENT_TYPES: ReadonlySet<string> = new Set([
	"VEVENT",
	"VTODO",
	"VJOURNAL",
	"VFREEBUSY",
]);

const isCalComponentType = (name: string): name is CalComponentType =>
	CAL_COMPONENT_TYPES.has(name);

/** A cal_index time-range pre-filter; an open-ended bound stays null */
interface IndexTimeRange {
	readonly start: Temporal.Instant | null;
	readonly end: Temporal.Instant | null;
}

/**
 * Walk the comp-filter tree to find the first non-VCALENDAR component name.
 * This is used to pre-filter candidates from cal_index by component type.
 */
const extractComponentType = (
	filter: CalFilter,
): Option.Option<CalComponentType> => {
	const vcal = filter.compFilter;
	if (vcal.name !== "VCALENDAR") {
		return Option.none();
	}
	return Option.fromNullishOr(
		vcal.compFilters.map((cf) => cf.name).find(isCalComponentType),
	);
};

/**
 * Extract the time range from a VEVENT/VTODO/VJOURNAL comp-filter nested
 * inside VCALENDAR, if any.
 */
const extractTimeRange = (
	filter: CalFilter,
	componentType: CalComponentType,
): Option.Option<IndexTimeRange> => {
	const cf = filter.compFilter.compFilters.find(
		(c) => c.name === componentType,
	);
	return cf?.timeRange === undefined
		? Option.none()
		: Option.some({
				start: cf.timeRange.start ?? null,
				end: cf.timeRange.end ?? null,
			});
};

// ---------------------------------------------------------------------------
// Request-body accessors
// ---------------------------------------------------------------------------

/** True when an unknown value is a plain (non-null) object */
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

/** Text of an element that fast-xml-parser may have collapsed to a bare string */
const elementText = (el: unknown): string | null => {
	if (typeof el === "string") {
		return el.trim();
	}
	return isRecord(el) && "#text" in el ? String(el["#text"]).trim() : null;
};

/** The `<C:calendar-data>` subsetting element inside `<D:prop>`, if present */
const calendarDataTree = (tree: unknown): unknown => {
	if (!isRecord(tree)) {
		return undefined;
	}
	const propEl = tree["{DAV:}prop"];
	return isRecord(propEl) ? propEl[CALENDAR_DATA] : undefined;
};

// ---------------------------------------------------------------------------
// Per-instance response
// ---------------------------------------------------------------------------

/** What building one matching instance's response needs besides the instance */
interface QueryResponseContext {
	readonly filter: CalFilter;
	readonly zone: ResolutionZone;
	readonly limits: RruleExpansionLimits;
	readonly spec: CalendarDataSpec;
	readonly propfind: PropfindKind;
	readonly hasFullRead: boolean;
	readonly hrefBase: string;
	readonly stripTimezones: (doc: IrDocument) => IrDocument;
}

/**
 * Multistatus entry for one candidate instance, or none when its tree is
 * missing or the filter rejects it.
 */
const buildQueryResponse = Effect.fn("calendar-query.buildResponse")(function* (
	inst: InstanceRow,
	root: IrComponent | undefined,
	ctx: QueryResponseContext,
) {
	if (root === undefined) {
		return Option.none<DavResponse>();
	}
	const irDoc: IrDocument = { kind: "icalendar", root };
	if (!evaluateCalFilter(irDoc, ctx.filter, ctx.zone, ctx.limits)) {
		return Option.none<DavResponse>();
	}
	const redactedDoc = ctx.hasFullRead ? irDoc : redactDocumentToBusyOnly(irDoc);
	const dataStr = yield* encodeICalendar(
		ctx.stripTimezones(subsetIrDocument(redactedDoc, ctx.spec, ctx.zone)),
	);
	const instanceProps = buildInstanceProps(inst);
	const allProps: Record<ClarkName, unknown> = {
		...instanceProps,
		[CALENDAR_DATA]: dataStr,
	};
	return Option.some<DavResponse>({
		href: `${ctx.hrefBase}/${encodeSegment(inst.slug || inst.id)}`,
		propstats: splitPropstats(allProps, ctx.propfind),
	});
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const calendarQueryHandler = (
	path: ResolvedDavPath,
	ctx: HttpRequestContext,
	tree: unknown,
): Effect.Effect<
	Response,
	DavError | DatabaseError,
	| InstanceService
	| InstanceRepository
	| ComponentRepository
	| CalIndexRepository
	| AclService
	| IanaTimezoneService
	| AppConfigService
	| CollectionRepository
> =>
	Effect.gen(function* () {
		if (path.kind !== "collection") {
			return yield* methodNotAllowed(
				"CALDAV:calendar-query REPORT requires a collection URL",
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
		const collectionPrivileges = yield* acl.currentUserPrivileges(
			actingPrincipalId,
			path.collectionId,
			"collection",
		);
		const hasFullRead = (
			collectionPrivileges as ReadonlyArray<string>
		).includes("DAV:read");

		// Parse filter
		const obj: Record<string, unknown> = isRecord(tree) ? tree : {};
		const filterTree = obj[cn("filter")];
		const filter = yield* parseCalFilter({ [cn("filter")]: filterTree });

		// RFC 7809 §6.2: parse optional <C:timezone-id> for floating-datetime context.
		// Validate against known IANA timezones; fail with CALDAV:valid-timezone if unknown.
		const ianaSvc = yield* IanaTimezoneService;
		const timezoneIdStr = elementText(obj[cn("timezone-id")]);
		if (
			timezoneIdStr !== null &&
			timezoneIdStr !== "" &&
			!ianaSvc.isKnownTzid(timezoneIdStr)
		) {
			return yield* forbidden("CALDAV:valid-timezone");
		}

		// RFC 4791 §7.3: floating and DATE values in this collection are read in
		// the request's CALDAV:timezone / timezone-id, else the collection's
		// CALDAV:calendar-timezone, else UTC.
		const timezoneEl = obj[cn("timezone")];
		const collRepo = yield* CollectionRepository;
		const collOpt = yield* collRepo.findById(path.collectionId);
		const zone = resolveCalendarZone({
			requestTimezone: typeof timezoneEl === "string" ? timezoneEl : null,
			requestTzid: timezoneIdStr,
			collectionTzid: Option.getOrUndefined(collOpt)?.timezoneTzid,
		});

		// Parse optional calendar-data subsetting spec (<C:calendar-data> is inside <D:prop>)
		const spec = parseCalendarDataSpec(calendarDataTree(tree));

		// Determine prop names
		const propNames = extractPropNames(tree);
		const propfind: PropfindKind =
			propNames.size > 0
				? { type: "prop", names: propNames }
				: { type: "allprop" };

		// Determine component type for pre-filtering
		const componentType = extractComponentType(filter);
		const timeRange = Option.flatMap(componentType, (type) =>
			extractTimeRange(filter, type),
		);

		// Retrieve candidate instances via SQL pre-filter or full scan
		const instSvc = yield* InstanceService;
		const instRepo = yield* InstanceRepository;
		const calIdx = yield* CalIndexRepository;

		// A structural hint lets cal_index narrow the candidates. The repository
		// derives its own bucket narrowing from the range; an open-ended range
		// (RFC 4791 §9.9) must not be narrowed to a window, so it stays null.
		const indexed = Option.map(componentType, (type) =>
			Effect.flatMap(
				Option.match(timeRange, {
					onNone: () => calIdx.findByComponentType(path.collectionId, type),
					onSome: (range) =>
						calIdx.findByTimeRange(path.collectionId, type, {
							start: range.start,
							end: range.end,
							zone,
						}),
				}),
				(ids) =>
					instRepo.findByIds(ids.map((id) => InstanceId(id as UuidString))),
			),
		);

		// No structural hint — scan all instances
		const instances = yield* Option.getOrElse(indexed, () =>
			instSvc.listByCollection(path.collectionId),
		);

		// Load, evaluate, serialize
		const compRepo = yield* ComponentRepository;

		const responseCtx: QueryResponseContext = {
			filter,
			zone,
			limits: {
				maxOccurrencesChecked: config.recurrence.rruleMaxOccurrences,
				timeBudgetMs: config.recurrence.rruleTimeBudgetMs,
			},
			spec,
			propfind,
			hasFullRead,
			hrefBase: `${ctx.url.origin}/dav/principals/${path.principalSeg}/${path.namespace}/${path.collectionSeg}`,
			// RFC 7809 §3.1.3: resolve the VTIMEZONE stripping function once per request
			stripTimezones:
				ctx.caldavTimezones === "F"
					? (doc: IrDocument) => stripKnownVtimezones(doc, ianaSvc.isKnownTzid)
					: (doc: IrDocument) => doc,
		};

		// Batch-load all candidate trees in 3 queries instead of 3 per instance.
		const trees = yield* compRepo.loadTreesByIds(
			instances.map((inst) => inst.entityId as unknown as EntityId),
			"icalendar",
		);

		const built = yield* Effect.forEach(instances, (inst) =>
			buildQueryResponse(
				inst,
				trees.get(inst.entityId as unknown as EntityId),
				responseCtx,
			),
		);

		return yield* multistatusResponse(built.flatMap(Option.toArray));
	});
