import { Effect, Option } from "effect";
import { encodeICalendar } from "#src/data/icalendar/codec.ts";
import type { IrComponent } from "#src/data/ir.ts";
import type { DatabaseError, InternalError } from "#src/domain/errors.ts";
import { CollectionId, EntityId, type UuidString } from "#src/domain/ids.ts";
import { ComponentRepository } from "#src/services/component/repository.ts";
import {
	InstanceRepository,
	type InstanceRow,
} from "#src/services/instance/repository.ts";

// ---------------------------------------------------------------------------
// exportCalendar — serialize every active instance in a calendar collection
// into a single VCALENDAR. VTIMEZONE components are deduped across instances
// by TZID so the output stays compact and re-importable.
// ---------------------------------------------------------------------------

const FEED_PRODID = "-//shuriken//export//EN";

const tzidOf = (vtimezone: IrComponent): Option.Option<string> => {
	const tzid = vtimezone.properties.find(
		(p) => p.name.toUpperCase() === "TZID",
	);
	if (tzid?.value.type !== "TEXT") {
		return Option.none();
	}
	return Option.some(tzid.value.value);
};

/** True when the instance body is iCalendar rather than, say, a vCard. */
const isCalendarInstance = (instance: InstanceRow): boolean =>
	instance.deletedAt === null &&
	instance.contentType.split(";")[0]?.trim().toLowerCase() === "text/calendar";

/** The VCALENDAR children of one instance, empty when it stores anything else. */
const instanceComponents = Effect.fn("cal-edit.export.instanceComponents")(
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

/** Separates VTIMEZONE components, deduped by TZID, from everything else. */
const partitionByTimezone = (
	components: ReadonlyArray<IrComponent>,
): {
	readonly timezones: ReadonlyMap<string, IrComponent>;
	readonly events: ReadonlyArray<IrComponent>;
} => {
	const timezones = new Map<string, IrComponent>();
	const events: Array<IrComponent> = [];
	for (const sub of components) {
		if (sub.name !== "VTIMEZONE") {
			events.push(sub);
			continue;
		}
		const tzid = tzidOf(sub);
		if (Option.isSome(tzid) && !timezones.has(tzid.value)) {
			timezones.set(tzid.value, sub);
		}
	}
	return { timezones, events };
};

export const exportCalendarToIcs = (
	collectionId: UuidString,
): Effect.Effect<
	string,
	DatabaseError | InternalError,
	ComponentRepository | InstanceRepository
> =>
	Effect.gen(function* () {
		const instanceRepo = yield* InstanceRepository;

		const instances = yield* instanceRepo.listByCollection(
			CollectionId(collectionId),
		);
		const all: Array<IrComponent> = [];
		for (const instance of instances) {
			all.push(...(yield* instanceComponents(instance)));
		}
		const { timezones, events } = partitionByTimezone(all);
		const components = [...timezones.values(), ...events];

		return yield* encodeICalendar({
			kind: "icalendar",
			root: {
				name: "VCALENDAR",
				properties: [
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
				],
				components,
			},
		});
	});
