import { Effect, Option } from "effect";
import { encodeICalendar } from "#src/data/icalendar/codec.ts";
import type { IrComponent } from "#src/data/ir.ts";
import type { DatabaseError, InternalError } from "#src/domain/errors.ts";
import { CollectionId, EntityId, type UuidString } from "#src/domain/ids.ts";
import { ComponentRepository } from "#src/services/component/repository.ts";
import { InstanceRepository } from "#src/services/instance/repository.ts";

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
	if (!tzid || tzid.value.type !== "TEXT") {
		return Option.none();
	}
	return Option.some(tzid.value.value);
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
		const componentRepo = yield* ComponentRepository;

		const events: Array<IrComponent> = [];
		const timezones = new Map<string, IrComponent>();

		const instances = yield* instanceRepo.listByCollection(
			CollectionId(collectionId),
		);
		for (const instance of instances) {
			if (instance.deletedAt !== null) {
				continue;
			}
			if (
				instance.contentType.split(";")[0]?.trim().toLowerCase() !==
				"text/calendar"
			) {
				continue;
			}
			const treeOpt = yield* componentRepo.loadTree(
				EntityId(instance.entityId),
				"icalendar",
			);
			if (Option.isNone(treeOpt)) {
				continue;
			}
			const root = treeOpt.value;
			if (root.name !== "VCALENDAR") {
				continue;
			}
			for (const sub of root.components) {
				if (sub.name === "VTIMEZONE") {
					const tzid = tzidOf(sub);
					if (Option.isSome(tzid) && !timezones.has(tzid.value)) {
						timezones.set(tzid.value, sub);
					}
					continue;
				}
				events.push(sub);
			}
		}

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
				components: [...timezones.values(), ...events],
			},
		});
	});
