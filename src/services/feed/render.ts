import { Effect, Option } from "effect";
import { encodeICalendar } from "#src/data/icalendar/codec.ts";
import { applyFieldVisibility } from "#src/data/icalendar/visibility.ts";
import type { IrComponent, IrDocument, IrProperty } from "#src/data/ir.ts";
import type { DatabaseError, InternalError } from "#src/domain/errors.ts";
import { CollectionId, EntityId } from "#src/domain/ids.ts";
import { ComponentRepository } from "#src/services/component/repository.ts";
import {
	InstanceRepository,
	type InstanceRow,
} from "#src/services/instance/repository.ts";
import type { ShareLinkSummary } from "#src/services/share-link/service.ts";
import { toFieldVisibility } from "#src/services/share-link/visibility-policy.ts";

// ---------------------------------------------------------------------------
// renderFeed — assemble a public .ics from a ShareLinkSummary.
//
// For each share_link_calendars row:
//   * load every active VEVENT/VTODO/VJOURNAL instance in the calendar
//   * apply the visibility transform to non-VTIMEZONE sub-components
//   * collect VTIMEZONE sub-components for global dedup
// Output is a single VCALENDAR containing every transformed sub-component
// followed by the deduped VTIMEZONEs.
//
// Visibility rules:
//   * all       — verbatim
//   * limited   — keep SUMMARY, strip DESCRIPTION/LOCATION/ATTENDEE/ORGANIZER
//   * free_busy — replace SUMMARY with "Busy" and strip the same private fields
// ---------------------------------------------------------------------------

const tzidOf = (vtimezone: IrComponent): Option.Option<string> => {
	const tzid = vtimezone.properties.find(
		(p) => p.name.toUpperCase() === "TZID",
	);
	if (tzid?.value.type !== "TEXT") {
		return Option.none();
	}
	return Option.some(tzid.value.value);
};

const FEED_PRODID = "-//shuriken//share-link feed//EN";

const buildVcalendar = (
	subComponents: ReadonlyArray<IrComponent>,
	displayName: string | null,
): IrDocument => {
	const properties: Array<IrProperty> = [
		{
			name: "VERSION",
			parameters: [],
			value: { type: "TEXT", value: "2.0" },
			isKnown: true,
		},
		{
			name: "PRODID",
			parameters: [],
			value: { type: "TEXT", value: FEED_PRODID },
			isKnown: true,
		},
	];
	if (displayName !== null && displayName.length > 0) {
		properties.push({
			name: "X-WR-CALNAME",
			parameters: [],
			value: { type: "TEXT", value: displayName },
			isKnown: false,
		});
	}
	return {
		kind: "icalendar",
		root: {
			name: "VCALENDAR",
			properties,
			components: subComponents,
		},
	};
};

/** True when the instance body is iCalendar rather than, say, a vCard. */
const isCalendarInstance = (instance: InstanceRow): boolean =>
	instance.deletedAt === null &&
	instance.contentType.split(";")[0]?.trim().toLowerCase() === "text/calendar";

/** The VCALENDAR children of one instance, empty when it stores anything else. */
const instanceComponents = Effect.fn("feed.render.instanceComponents")(
	function* (instance: InstanceRow) {
		if (!isCalendarInstance(instance)) {
			return [] as ReadonlyArray<IrComponent>;
		}
		const componentRepo = yield* ComponentRepository;
		const treeOpt = yield* componentRepo.loadTree(
			EntityId(instance.entityId),
			"icalendar",
		);
		return Option.match(treeOpt, {
			onNone: (): ReadonlyArray<IrComponent> => [],
			onSome: (root) => (root.name === "VCALENDAR" ? root.components : []),
		});
	},
);

/**
 * One shared calendar's visible event components. VTIMEZONEs are not returned:
 * they are deduped by TZID into the shared `timezoneByTzid` map instead.
 */
const collectCalendar = Effect.fn("feed.render.collectCalendar")(function* (
	cal: ShareLinkSummary["calendars"][number],
	timezoneByTzid: Map<string, IrComponent>,
) {
	const instanceRepo = yield* InstanceRepository;
	const visibility = toFieldVisibility(cal.visibility);
	const events: Array<IrComponent> = [];
	const instances = yield* instanceRepo.listByCollection(
		CollectionId(cal.calendarId),
	);
	for (const instance of instances) {
		for (const sub of yield* instanceComponents(instance)) {
			if (sub.name !== "VTIMEZONE") {
				events.push(applyFieldVisibility(sub, visibility));
				continue;
			}
			const tzid = tzidOf(sub);
			if (Option.isSome(tzid) && !timezoneByTzid.has(tzid.value)) {
				timezoneByTzid.set(tzid.value, sub);
			}
		}
	}
	return events as ReadonlyArray<IrComponent>;
});

export const renderFeed = (
	summary: ShareLinkSummary,
): Effect.Effect<
	string,
	DatabaseError | InternalError,
	ComponentRepository | InstanceRepository
> =>
	Effect.gen(function* () {
		const timezoneByTzid = new Map<string, IrComponent>();
		const eventComponents: Array<IrComponent> = [];
		for (const cal of summary.calendars) {
			eventComponents.push(...(yield* collectCalendar(cal, timezoneByTzid)));
		}
		const subComponents = [...timezoneByTzid.values(), ...eventComponents];
		const doc = buildVcalendar(subComponents, summary.link.displayName);
		return yield* encodeICalendar(doc);
	});
