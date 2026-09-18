import { Effect, Option } from "effect";
import { Temporal } from "temporal-polyfill";
import type {
	InstanceRepositoryShape,
	InstanceRow,
	NewInstance,
} from "#src/services/instance/repository.ts";
import { allInstances, type TestStores } from "./stores.ts";

// ---------------------------------------------------------------------------
// In-memory InstanceRepository
// ---------------------------------------------------------------------------

// The instance with this id, only while it is not soft-deleted
const findLive = (stores: TestStores, id: string): InstanceRow | undefined => {
	const row = stores.instances.get(id);
	return row && row.deletedAt === null ? row : undefined;
};

// The instance with this id, only once it has been soft-deleted
const findDeleted = (
	stores: TestStores,
	id: string,
): InstanceRow | undefined => {
	const row = stores.instances.get(id);
	return row && row.deletedAt !== null ? row : undefined;
};

// Live instances in collections owned by someone else that grant one of these
// privileges to one of these principals
const sharedInstances = (
	stores: TestStores,
	principalIds: ReadonlyArray<string>,
	privileges: ReadonlyArray<string>,
): ReadonlyArray<InstanceRow> => {
	const idSet = new Set<string>(principalIds);
	const privSet = new Set<string>(privileges);
	return allInstances(stores).filter((i) => {
		const coll = stores.collections.get(i.collectionId);
		if (
			i.deletedAt !== null ||
			!coll ||
			coll.deletedAt !== null ||
			idSet.has(coll.ownerPrincipalId)
		) {
			return false;
		}
		return (stores.acl.get(i.id) ?? []).some(
			(a) =>
				a.resourceType === "instance" &&
				a.principalType === "principal" &&
				a.grantDeny === "grant" &&
				a.principalId !== null &&
				idSet.has(a.principalId) &&
				privSet.has(a.privilege),
		);
	});
};

export const makeInstanceRepo = (
	stores: TestStores,
): InstanceRepositoryShape => ({
	findById: (id) => Effect.succeed(Option.fromNullishOr(findLive(stores, id))),

	findDeletedById: (id) =>
		Effect.succeed(Option.fromNullishOr(findDeleted(stores, id))),

	findBySlug: (collectionId, slug) =>
		Effect.succeed(
			Option.fromNullishOr(
				allInstances(stores).find(
					(i) =>
						i.collectionId === collectionId &&
						i.slug === slug &&
						i.deletedAt === null,
				),
			),
		),

	listByCollection: (collectionId) =>
		Effect.succeed(
			allInstances(stores).filter(
				(i) => i.collectionId === collectionId && i.deletedAt === null,
			),
		),

	listDeletedByCollection: (collectionId) =>
		Effect.succeed(
			allInstances(stores).filter(
				(i) => i.collectionId === collectionId && i.deletedAt !== null,
			),
		),

	listDeletedOlderThan: (cutoff) =>
		Effect.succeed(
			allInstances(stores).filter(
				(i) =>
					i.deletedAt !== null &&
					Temporal.Instant.compare(i.deletedAt, cutoff) < 0,
			),
		),

	listSharedWithPrincipals: (principalIds, privileges) =>
		Effect.succeed(sharedInstances(stores, principalIds, privileges)),

	findChangedSince: (collectionId, sinceSyncRevision) =>
		Effect.succeed(
			allInstances(stores).filter(
				(i) =>
					i.collectionId === collectionId &&
					i.syncRevision > sinceSyncRevision &&
					i.deletedAt === null,
			),
		),

	findByIds: (ids) =>
		Effect.succeed(
			ids
				.map((id) => stores.instances.get(id))
				.filter(
					(i): i is InstanceRow => i !== undefined && i.deletedAt === null,
				),
		),

	insert: (input: NewInstance) =>
		Effect.sync(() => {
			const now = Temporal.Now.instant();
			// Simulate DB trigger: syncRevision = 1 on first insert
			const row: InstanceRow = {
				id: crypto.randomUUID(),
				collectionId: input.collectionId,
				entityId: input.entityId,
				contentType: input.contentType,
				etag: input.etag,
				syncRevision: 1,
				lastModified: now,
				updatedAt: now,
				deletedAt: null,
				scheduleTag: input.scheduleTag ?? null,
				slug: input.slug,
				clientProperties: {},
				contentLength: input.contentLength ?? null,
			};
			stores.instances.set(row.id, row);
			return row;
		}),

	updateEtag: (id, etag, contentLength) =>
		Effect.sync(() => {
			const row = stores.instances.get(id);
			if (row) {
				// Simulate DB trigger: increment syncRevision on each update
				stores.instances.set(id, {
					...row,
					etag,
					syncRevision: row.syncRevision + 1,
					updatedAt: Temporal.Now.instant(),
					...(contentLength !== undefined ? { contentLength } : {}),
				});
			}
		}),

	softDelete: (id) =>
		Effect.sync(() => {
			const row = stores.instances.get(id);
			if (row) {
				stores.instances.set(id, {
					...row,
					deletedAt: Temporal.Now.instant(),
				});
			}
		}),

	restore: (id) =>
		Effect.sync(() => {
			const row = stores.instances.get(id);
			if (!row || row.deletedAt === null) {
				throw new Error(`Instance not found for restore: ${id}`);
			}
			const restored = { ...row, deletedAt: null };
			stores.instances.set(id, restored);
			return restored;
		}),

	hardDelete: (id) =>
		Effect.sync(() => {
			stores.instances.delete(id);
		}),

	relocate: (id, targetCollectionId, targetSlug) =>
		Effect.sync(() => {
			const row = stores.instances.get(id);
			if (!row || row.deletedAt !== null) {
				throw new Error(`Instance not found for relocation: ${id}`);
			}
			const updated = {
				...row,
				collectionId: targetCollectionId,
				slug: targetSlug,
				updatedAt: Temporal.Now.instant(),
			};
			stores.instances.set(id, updated);
			return updated;
		}),

	updateClientProperties: (id, clientProperties) =>
		Effect.sync(() => {
			const row = stores.instances.get(id);
			if (!row || row.deletedAt !== null) {
				throw new Error(`Instance not found for property update: ${id}`);
			}
			const updated: InstanceRow = {
				...row,
				clientProperties,
				updatedAt: Temporal.Now.instant(),
			};
			stores.instances.set(id, updated);
			return updated;
		}),
});
