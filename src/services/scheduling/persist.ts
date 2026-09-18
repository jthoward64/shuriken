// ---------------------------------------------------------------------------
// Writing scheduling results back to storage
// ---------------------------------------------------------------------------

import { Effect, Option } from "effect";
import { makeEtag } from "#src/data/etag.ts";
import { encodeICalendar } from "#src/data/icalendar/codec.ts";
import type { IrComponent, IrDocument } from "#src/data/ir.ts";
import { DatabaseClient } from "#src/db/client.ts";
import { withTransaction } from "#src/db/transaction.ts";
import { CollectionId, EntityId, InstanceId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { ETag } from "#src/domain/types/strings.ts";
import type { InstanceRow } from "#src/services/instance/repository.ts";
import type { SchedulingDeps } from "./deps.ts";
import { applyScheduleStatus } from "./sor-patch.ts";

/** Swap an entity's whole component tree; the caller supplies the transaction */
const replaceTree = Effect.fn("SchedulingService.replaceTree")(function* (
	deps: SchedulingDeps,
	entityId: EntityId,
	root: IrComponent,
) {
	yield* deps.componentRepo.deleteByEntity(entityId);
	yield* deps.componentRepo.insertTree(entityId, root);
});

/** Write updated SCHEDULE-STATUS params back to the stored tree */
export const persistScheduleStatus = Effect.fn(
	"SchedulingService.persistScheduleStatus",
)(function* (
	deps: SchedulingDeps,
	entityId: EntityId,
	calAddress: string,
	status: string,
) {
	const treeOpt = yield* deps.componentRepo.loadTree(entityId, "icalendar");
	if (Option.isNone(treeOpt)) {
		return;
	}
	yield* withTransaction(
		replaceTree(
			deps,
			entityId,
			applyScheduleStatus(treeOpt.value, calAddress, status),
		),
	).pipe(Effect.provideService(DatabaseClient, deps.db));
});

/** Where an iTIP document is being filed, and under which Schedule-Tag */
export interface ItipPlacement {
	readonly collectionId: CollectionId;
	readonly itipDoc: IrDocument;
	readonly uid: string;
	readonly scheduleTag?: string;
}

/** Write one iTIP document into a collection as a new instance */
export const persistItipToCollection = Effect.fn(
	"SchedulingService.persistItipToCollection",
)(function* (deps: SchedulingDeps, placement: ItipPlacement) {
	const canonical = yield* encodeICalendar(placement.itipDoc);
	const etag = ETag(yield* makeEtag(canonical));
	const entityRow = yield* deps.entityRepo.insert({
		entityType: "icalendar",
		logicalUid: placement.uid,
	});
	yield* deps.componentRepo.insertTree(
		EntityId(entityRow.id),
		placement.itipDoc.root,
	);
	yield* deps.instanceSvc.put({
		collectionId: placement.collectionId,
		entityId: EntityId(entityRow.id),
		contentType: "text/calendar",
		etag,
		slug: Slug(`${placement.uid}-${crypto.randomUUID()}.ics`),
		scheduleTag: placement.scheduleTag,
		contentLength: new TextEncoder().encode(canonical).byteLength,
	});
});

/**
 * Replace an existing SOR's component tree in place. Recomputes the ETag
 * (content changed) and, when `scheduleTag` is given, updates the Schedule-Tag;
 * omit it to keep the tag stable (RFC 6638 §3.2.10).
 */
export const updateExistingSor = Effect.fn(
	"SchedulingService.updateExistingSor",
)(function* (
	deps: SchedulingDeps,
	instance: InstanceRow,
	newRoot: IrComponent,
	scheduleTag?: string,
) {
	const entityId = EntityId(instance.entityId);
	const canonical = yield* encodeICalendar({
		kind: "icalendar",
		root: newRoot,
	});
	const etag = ETag(yield* makeEtag(canonical));
	yield* withTransaction(replaceTree(deps, entityId, newRoot)).pipe(
		Effect.provideService(DatabaseClient, deps.db),
	);
	yield* deps.instanceSvc.put(
		{
			collectionId: CollectionId(instance.collectionId),
			entityId,
			contentType: "text/calendar",
			etag,
			slug: Slug(instance.slug),
			contentLength: new TextEncoder().encode(canonical).byteLength,
		},
		InstanceId(instance.id),
	);
	if (scheduleTag !== undefined) {
		yield* deps.repo.updateScheduleTag(InstanceId(instance.id), scheduleTag);
	}
});
