import { Effect, Option } from "effect";
import { makeEtag } from "#src/data/etag.ts";
import { decodeICalendar, encodeICalendar } from "#src/data/icalendar/codec.ts";
import type { IrComponent, IrDocument } from "#src/data/ir.ts";
import { DatabaseClient } from "#src/db/client.ts";
import { withTransaction } from "#src/db/transaction.ts";
import {
	type DatabaseError,
	type DavError,
	InternalError,
	needPrivileges,
} from "#src/domain/errors.ts";
import { type CollectionId, EntityId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { ETag } from "#src/domain/types/strings.ts";
import { isReadOnlyCollection } from "#src/services/collection/read-only-guard.ts";
import type { CollectionRepository } from "#src/services/collection/repository.ts";
import { ComponentRepository } from "#src/services/component/repository.ts";
import { EntityRepository } from "#src/services/entity/repository.ts";
import type { ExternalCalendarRepository } from "#src/services/external-calendar/repository.ts";
import { InstanceService } from "#src/services/instance/service.ts";

// ---------------------------------------------------------------------------
// importIcs — bulk import a multi-VEVENT iCalendar payload into a calendar
// collection.
//
// Modes:
//   * error  — abort if any UID already exists. No writes are performed and
//              the conflicting UIDs are returned.
//   * skip   — silently skip events whose UID already exists.
//   * merge  — replace existing events by UID (soft-delete + re-insert).
//
// Events are grouped by UID: a single VEVENT and its RECURRENCE-ID overrides
// share one entity row. VTIMEZONE components are attached to every group
// whose events reference their TZID; if we can't tell, they're attached to
// all groups to keep the data round-trippable.
// ---------------------------------------------------------------------------

export type ImportMode = "error" | "skip" | "merge";

export interface ImportIcsResult {
	readonly inserted: number;
	readonly skipped: number;
	readonly merged: number;
	/** Populated only when mode === "error" and at least one conflict was hit. */
	readonly conflicts: ReadonlyArray<string>;
}

const SLUG_MAX_BODY = 120;
const slugFromUid = (uid: string): Slug => {
	const safe = uid.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, SLUG_MAX_BODY);
	return Slug(`${safe || "event"}.ics`);
};

const uidOf = (component: IrComponent): Option.Option<string> => {
	const uid = component.properties.find((p) => p.name.toUpperCase() === "UID");
	if (!uid || uid.value.type !== "TEXT") {
		return Option.none();
	}
	return Option.some(uid.value.value);
};

const wrap = (subs: ReadonlyArray<IrComponent>): IrDocument => ({
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
				value: { type: "TEXT", value: "-//shuriken//import//EN" },
				isKnown: true,
			},
		],
		components: subs,
	},
});

interface EventGroup {
	readonly uid: string;
	readonly components: Array<IrComponent>;
}

const groupByUid = (
	root: IrComponent,
): {
	readonly groups: ReadonlyArray<EventGroup>;
	readonly timezones: ReadonlyArray<IrComponent>;
} => {
	const groups = new Map<string, EventGroup>();
	const timezones: Array<IrComponent> = [];
	for (const sub of root.components) {
		if (sub.name === "VTIMEZONE") {
			timezones.push(sub);
			continue;
		}
		const uidOpt = uidOf(sub);
		if (Option.isNone(uidOpt)) {
			continue;
		}
		const uid = uidOpt.value;
		const existing = groups.get(uid);
		if (existing) {
			existing.components.push(sub);
		} else {
			groups.set(uid, { uid, components: [sub] });
		}
	}
	return { groups: Array.from(groups.values()), timezones };
};

export const importIcs = (
	calendarId: CollectionId,
	body: string,
	mode: ImportMode,
): Effect.Effect<
	ImportIcsResult,
	DatabaseError | DavError | InternalError,
	| CollectionRepository
	| ComponentRepository
	| DatabaseClient
	| EntityRepository
	| ExternalCalendarRepository
	| InstanceService
> =>
	Effect.gen(function* () {
		const componentRepo = yield* ComponentRepository;
		const entityRepo = yield* EntityRepository;
		const instanceSvc = yield* InstanceService;
		const db = yield* DatabaseClient;

		// The birthdays generator / subscription sync own these collections'
		// event sets and would clobber a manually-imported .ics on their next
		// run — mirrors the same check DAV PUT/DELETE/MOVE/COPY enforce.
		if (yield* isReadOnlyCollection(calendarId)) {
			return yield* Effect.fail(
				needPrivileges("collection is server-managed and accepts no writes"),
			);
		}

		const doc = yield* decodeICalendar(body);
		if (doc.kind !== "icalendar" || doc.root.name !== "VCALENDAR") {
			return yield* Effect.fail(
				new InternalError({ cause: new Error("expected VCALENDAR root") }),
			);
		}

		const { groups, timezones } = groupByUid(doc.root);

		// Conflict detection up-front so error-mode can abort cleanly.
		const conflicts: Array<string> = [];
		for (const g of groups) {
			const exists = yield* entityRepo.existsByUid(calendarId, g.uid);
			if (exists) {
				conflicts.push(g.uid);
			}
		}

		if (mode === "error" && conflicts.length > 0) {
			return {
				inserted: 0,
				skipped: 0,
				merged: 0,
				conflicts,
			};
		}

		const conflictSet = new Set(conflicts);

		let inserted = 0;
		let skipped = 0;
		let merged = 0;

		const writeGroup = (g: EventGroup, replaceExisting: boolean) =>
			withTransaction(
				Effect.gen(function* () {
					if (replaceExisting) {
						const existingInstances =
							yield* entityRepo.listActiveInstancesWithUid(calendarId);
						for (const ex of existingInstances) {
							if (ex.logicalUid === g.uid) {
								yield* instanceSvc.delete(ex.instanceId);
								yield* entityRepo.softDelete(ex.entityId);
							}
						}
					}
					const subDoc = wrap([...timezones, ...g.components]);
					const canonical = yield* encodeICalendar(subDoc);
					const etag = ETag(yield* makeEtag(canonical));
					const contentLength = new TextEncoder().encode(canonical).byteLength;
					const slug = slugFromUid(g.uid);
					const entityRow = yield* entityRepo.insert({
						entityType: "icalendar",
						logicalUid: g.uid,
					});
					const eid = EntityId(entityRow.id);
					yield* componentRepo.insertTree(eid, subDoc.root);
					yield* instanceSvc.put({
						collectionId: calendarId,
						entityId: eid,
						contentType: "text/calendar",
						etag,
						slug,
						contentLength,
					});
				}),
			).pipe(Effect.provideService(DatabaseClient, db));

		for (const g of groups) {
			const conflict = conflictSet.has(g.uid);
			if (conflict && mode === "skip") {
				skipped += 1;
				continue;
			}
			if (conflict && mode === "merge") {
				yield* writeGroup(g, true);
				merged += 1;
				continue;
			}
			// New row in all remaining cases (no conflict, or error-mode with no conflicts).
			yield* writeGroup(g, false);
			inserted += 1;
		}

		return { inserted, skipped, merged, conflicts: [] };
	});

export type { InstanceId } from "#src/domain/ids.ts";
