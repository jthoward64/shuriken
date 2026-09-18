// ---------------------------------------------------------------------------
// processOutboxPost - outbox POST free-busy aggregation (RFC 6638 §5, §6.2)
// ---------------------------------------------------------------------------

import { Effect, Option } from "effect";
import type { Temporal } from "temporal-polyfill";
import { resolveCalendarZone } from "#src/data/icalendar/calendar-zone.ts";
import {
	buildVfreebusyText,
	coalescePeriods,
	type Period,
} from "#src/data/icalendar/freebusy.ts";
import type { IrDocument } from "#src/data/ir.ts";
import { forbidden } from "#src/domain/errors.ts";
import { CollectionId, EntityId, PrincipalId } from "#src/domain/ids.ts";
import type { CollectionRow } from "#src/services/collection/repository.ts";
import type { SchedulingDeps } from "./deps.ts";
import { treePeriods } from "./freebusy-periods.ts";
import type { OutboxFreeBusyResult } from "./service.ts";

/** The VFREEBUSY query window carried by an outbox POST */
interface FreeBusyQuery {
	readonly queryStart: Temporal.Instant;
	readonly queryEnd: Temporal.Instant;
	readonly attendeeAddresses: ReadonlyArray<string>;
}

/** Parse the VFREEBUSY request body, failing with CALDAV:valid-scheduling-message */
const parseFreeBusyQuery = Effect.fn("SchedulingService.parseFreeBusyQuery")(
	function* (doc: IrDocument) {
		if (doc.kind !== "icalendar") {
			return yield* Effect.fail(
				forbidden("CALDAV:valid-scheduling-message", "Expected iCalendar"),
			);
		}
		const vfb = doc.root.components.find((c) => c.name === "VFREEBUSY");
		if (!vfb) {
			return yield* Effect.fail(
				forbidden("CALDAV:valid-scheduling-message", "No VFREEBUSY component"),
			);
		}
		const dtstartProp = vfb.properties.find((p) => p.name === "DTSTART");
		const dtendProp = vfb.properties.find((p) => p.name === "DTEND");
		if (
			!(dtstartProp && dtendProp) ||
			dtstartProp.value.type !== "DATE_TIME" ||
			dtendProp.value.type !== "DATE_TIME"
		) {
			return yield* Effect.fail(
				forbidden(
					"CALDAV:valid-scheduling-message",
					"VFREEBUSY requires UTC DTSTART and DTEND",
				),
			);
		}
		const query: FreeBusyQuery = {
			queryStart: dtstartProp.value.value.toInstant(),
			queryEnd: dtendProp.value.value.toInstant(),
			attendeeAddresses: vfb.properties
				.filter((p) => p.name === "ATTENDEE" && p.value.type === "CAL_ADDRESS")
				.map((p) => String(p.value.value)),
		};
		return query;
	},
);

/** Every busy period one opaque collection contributes to a recipient's free-busy */
const collectionPeriods = Effect.fn("SchedulingService.collectionPeriods")(
	function* (
		deps: SchedulingDeps,
		collection: CollectionRow,
		query: FreeBusyQuery,
	) {
		// RFC 4791 §5.2.2: each calendar's own CALDAV:calendar-timezone fixes how
		// its floating and DATE values are read
		const window = {
			queryStart: query.queryStart,
			queryEnd: query.queryEnd,
			zone: resolveCalendarZone({ collectionTzid: collection.timezoneTzid }),
		};
		const instances = yield* deps.instanceSvc.listByCollection(
			CollectionId(collection.id),
		);
		const periods: Array<Period> = [];
		for (const inst of instances) {
			const treeOpt = yield* deps.componentRepo.loadTree(
				EntityId(inst.entityId),
				"icalendar",
			);
			if (Option.isSome(treeOpt)) {
				periods.push(...treePeriods(treeOpt.value, window));
			}
		}
		return periods;
	},
);

/**
 * Free-busy is aggregated per recipient so each gets its own CALDAV:response
 * entry (RFC 6638 §10.2).
 */
const recipientFreeBusy = Effect.fn("SchedulingService.recipientFreeBusy")(
	function* (deps: SchedulingDeps, calAddress: string, query: FreeBusyQuery) {
		const pwuOpt = yield* deps.repo.findPrincipalByCalAddress(calAddress);
		if (Option.isNone(pwuOpt)) {
			// RFC 6638 §6.2.2: an unresolvable recipient yields a per-recipient
			// request-status (3.7) rather than failing the whole POST. The edge
			// renders this into the schedule-response.
			return { recipient: calAddress, found: false, calendarData: "" };
		}
		const collections = yield* deps.repo.listOpaqueCalendarCollections(
			PrincipalId(pwuOpt.value.principal.id),
		);
		const periods: Array<Period> = [];
		for (const coll of collections) {
			periods.push(...(yield* collectionPeriods(deps, coll, query)));
		}
		return {
			recipient: calAddress,
			found: true,
			calendarData: buildVfreebusyText(
				query.queryStart,
				query.queryEnd,
				coalescePeriods(periods),
			),
		};
	},
);

export const processOutboxPost = Effect.fn(
	"SchedulingService.processOutboxPost",
)(function* (
	deps: SchedulingDeps,
	opts: { actingPrincipalId: PrincipalId; doc: IrDocument },
) {
	yield* Effect.annotateCurrentSpan({
		"scheduling.principal_id": opts.actingPrincipalId,
		"scheduling.doc_kind": opts.doc.kind,
	});
	yield* Effect.logTrace("scheduling.processOutboxPost", {
		actingPrincipalId: opts.actingPrincipalId,
		docKind: opts.doc.kind,
	});

	const query = yield* parseFreeBusyQuery(opts.doc);
	const results: Array<OutboxFreeBusyResult> = [];
	for (const calAddress of query.attendeeAddresses) {
		results.push(yield* recipientFreeBusy(deps, calAddress, query));
	}
	return results;
});
