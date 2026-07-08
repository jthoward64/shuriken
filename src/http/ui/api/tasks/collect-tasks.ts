import { Effect } from "effect";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import {
	type CollectionId,
	EntityId,
	InstanceId,
	type UuidString,
} from "#src/domain/ids.ts";
import { CalIndexRepository } from "#src/services/cal-index/index.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { InstanceRepository } from "#src/services/instance/repository.ts";
import { parseVtodoToForm } from "#src/services/task-edit/parse-vtodo.ts";

// ---------------------------------------------------------------------------
// Shared task collection — the data path behind the tasks list page
// (handlers/tasks/list.tsx). VTODO instances have no natural time window (a
// task with neither DTSTART nor DUE is valid — RFC 5545 §3.6.2), so unlike
// collect-events.ts this loads every VTODO in the collection rather than
// narrowing by range; the list page paginates in memory.
// ---------------------------------------------------------------------------

/** Projected view of a VTODO, engine-agnostic. */
export interface TaskView {
	readonly id: string;
	readonly collectionId: string;
	readonly title: string;
	readonly allDay: boolean;
	/** ISO local (`YYYY-MM-DD` all-day / `YYYY-MM-DDTHH:mm`), or null. */
	readonly due: string | null;
	readonly status: string;
	/** 0-9, or null when unset. */
	readonly priority: number | null;
	/** 0-100, or null when unset. */
	readonly percentComplete: number | null;
	readonly description: string;
	readonly location: string;
	readonly categoriesCsv: string;
	readonly recurring: boolean;
}

const toNumberOrNull = (raw: string): number | null => {
	if (raw === "") {
		return null;
	}
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) ? n : null;
};

export const collectTasks = (
	collectionId: CollectionId,
): Effect.Effect<
	ReadonlyArray<TaskView>,
	DavError | DatabaseError | InternalError,
	CalIndexRepository | ComponentRepository | InstanceRepository
> =>
	Effect.gen(function* () {
		const instRepo = yield* InstanceRepository;
		const calIdx = yield* CalIndexRepository;
		const componentRepo = yield* ComponentRepository;

		const candidateIds = yield* calIdx.findByComponentType(
			collectionId,
			"VTODO",
		);
		const instances = yield* instRepo.findByIds(
			candidateIds.map((id) => InstanceId(id as UuidString)),
		);

		const trees = yield* componentRepo.loadTreesByIds(
			instances.map((inst) => EntityId(inst.entityId)),
			"icalendar",
		);

		const tasks: Array<TaskView> = [];
		for (const inst of instances) {
			const tree = trees.get(EntityId(inst.entityId));
			if (tree === undefined) {
				continue;
			}
			const vtodo = tree.components.find((c) => c.name === "VTODO");
			if (!vtodo) {
				continue;
			}
			const form = parseVtodoToForm(vtodo);
			tasks.push({
				id: inst.id,
				collectionId: inst.collectionId,
				title: form.summary || "(no title)",
				allDay: form.allDay,
				due: form.due !== "" ? form.due : null,
				status: form.status,
				priority: toNumberOrNull(form.priority),
				percentComplete: toNumberOrNull(form.percentComplete),
				description: form.description,
				location: form.location,
				categoriesCsv: form.categoriesCsv,
				recurring: vtodo.properties.some((p) => p.name === "RRULE"),
			});
		}
		return tasks;
	});
