// ---------------------------------------------------------------------------
// CALDAV:calendar-query REPORT — RFC 4791 §7.8
//
// Filter-based calendar search. Evaluates a <CALDAV:filter> against every
// candidate instance in the collection, optionally pre-filtered by the
// cal_index for time-range queries.
// ---------------------------------------------------------------------------

import { Effect, Option } from "effect";
import { encodeICalendar } from "#src/data/icalendar/codec.ts";
import type { ClarkName, IrDocument } from "#src/data/ir.ts";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import { forbidden, methodNotAllowed } from "#src/domain/errors.ts";
import type { EntityId, UuidString } from "#src/domain/ids.ts";
import { InstanceId } from "#src/domain/ids.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
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
import { ComponentRepository } from "#src/services/component/index.ts";
import {
	InstanceRepository,
	InstanceService,
} from "#src/services/instance/index.ts";
import { parseCalendarDataSpec, subsetIrDocument } from "./calendar-data.ts";
import { evaluateCalFilter, parseCalFilter } from "./filter-cal.ts";
import { extractPropNames } from "./parse.ts";

const CALDAV_NS = "urn:ietf:params:xml:ns:caldav";
const cn = (local: string): ClarkName => `{${CALDAV_NS}}${local}` as ClarkName;

const CALENDAR_DATA = cn("calendar-data");

// ---------------------------------------------------------------------------
// Extract top-level component type from filter (e.g. VEVENT, VTODO)
// ---------------------------------------------------------------------------

/**
 * Walk the comp-filter tree to find the first non-VCALENDAR component name.
 * This is used to pre-filter candidates from cal_index by component type.
 */
const extractComponentType = (
	filter: import("./filter-cal.ts").CalFilter,
): CalComponentType | null => {
	const vcal = filter.compFilter;
	if (vcal.name !== "VCALENDAR") {
		return null;
	}
	for (const cf of vcal.compFilters) {
		const name = cf.name as CalComponentType;
		if (
			name === "VEVENT" ||
			name === "VTODO" ||
			name === "VJOURNAL" ||
			name === "VFREEBUSY"
		) {
			return name;
		}
	}
	return null;
};

/**
 * Extract the time range from a VEVENT/VTODO/VJOURNAL comp-filter nested
 * inside VCALENDAR, if any.
 */
const extractTimeRange = (
	filter: import("./filter-cal.ts").CalFilter,
	componentType: CalComponentType,
): {
	start: import("temporal-polyfill").Temporal.Instant | null;
	end: import("temporal-polyfill").Temporal.Instant | null;
} | null => {
	const vcal = filter.compFilter;
	const cf = vcal.compFilters.find((c) => c.name === componentType);
	if (!cf?.timeRange) {
		return null;
	}
	return {
		start: cf.timeRange.start ?? null,
		end: cf.timeRange.end ?? null,
	};
};

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
> =>
	Effect.gen(function* () {
		if (path.kind !== "collection") {
			return yield* methodNotAllowed(
				"CALDAV:calendar-query REPORT requires a collection URL",
			);
		}

		if (ctx.auth._tag !== "Authenticated") {
			return yield* forbidden("DAV:need-privileges");
		}
		const actingPrincipalId = ctx.auth.principal.principalId;

		const acl = yield* AclService;
		yield* acl.check(
			actingPrincipalId,
			path.collectionId,
			"collection",
			"DAV:read",
		);

		// Parse filter
		const obj =
			typeof tree === "object" && tree !== null
				? (tree as Record<string, unknown>)
				: {};
		const filterTree = obj[cn("filter")];
		const filter = yield* parseCalFilter({ [cn("filter")]: filterTree });

		// Parse optional calendar-data subsetting spec
		const dataTree = obj[CALENDAR_DATA];
		const spec = parseCalendarDataSpec(dataTree);

		// Determine prop names
		const propNames = extractPropNames(tree);
		const propfind: PropfindKind =
			propNames.size > 0
				? { type: "prop", names: propNames }
				: { type: "allprop" };

		// Determine component type for pre-filtering
		const componentType = extractComponentType(filter);
		const timeRange = componentType
			? extractTimeRange(filter, componentType)
			: null;

		// Retrieve candidate instances via SQL pre-filter or full scan
		const instSvc = yield* InstanceService;
		const instRepo = yield* InstanceRepository;
		const calIdx = yield* CalIndexRepository;

		const instances = yield* (() => {
			if (componentType && timeRange) {
				// Compute calendar week [weekStart, weekEnd) containing timeRange.start
				// for the RRULE week-bucket SQL pre-filter.
				const { weekStart, weekEnd } = (() => {
					if (timeRange.start === null) {
						return { weekStart: null, weekEnd: null };
					}
					const zdt = timeRange.start.toZonedDateTimeISO("UTC");
					const startOfWeek = zdt
						.subtract({ days: zdt.dayOfWeek - 1 })
						.with({ hour: 0, minute: 0, second: 0, millisecond: 0, microsecond: 0, nanosecond: 0 });
					return {
						weekStart: startOfWeek.toInstant(),
						weekEnd: startOfWeek.add({ weeks: 1 }).toInstant(),
					};
				})();

				// Time-range pre-filter via cal_index
				return calIdx
					.findByTimeRange(
						path.collectionId,
						componentType,
						timeRange.start,
						timeRange.end,
						weekStart,
						weekEnd,
					)
					.pipe(
						Effect.flatMap((entityIds) =>
							instRepo.findByIds(
								entityIds.map((id) => InstanceId(id as UuidString)),
							),
						),
					);
			}
			if (componentType) {
				// Component-type pre-filter via cal_index (no time range)
				return calIdx
					.findByComponentType(path.collectionId, componentType)
					.pipe(
						Effect.flatMap((entityIds) =>
							instRepo.findByIds(
								entityIds.map((id) => InstanceId(id as UuidString)),
							),
						),
					);
			}
			// No structural hint — scan all instances
			return instSvc.listByCollection(path.collectionId);
		})();

		// Load, evaluate, serialize
		const compRepo = yield* ComponentRepository;
		const origin = ctx.url.origin;
		const responses: Array<DavResponse> = [];

		for (const inst of instances) {
			const treeOpt = yield* compRepo.loadTree(
				inst.entityId as unknown as EntityId,
				"icalendar",
			);
			if (Option.isNone(treeOpt)) {
				continue;
			}
			const irDoc: IrDocument = { kind: "icalendar", root: treeOpt.value };

			if (!evaluateCalFilter(irDoc, filter)) {
				continue;
			}

			const dataStr = yield* encodeICalendar(subsetIrDocument(irDoc, spec));

			const href = `${origin}/dav/principals/${path.principalSeg}/${path.namespace}/${path.collectionSeg}/${inst.id}`;
			const allProps: Record<ClarkName, unknown> = {
				...buildInstanceProps(inst),
				[CALENDAR_DATA]: dataStr,
			};
			responses.push({
				href,
				propstats: splitPropstats(allProps, propfind),
			});
		}

		return yield* multistatusResponse(responses);
	});
