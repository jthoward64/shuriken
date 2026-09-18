import { Effect, Option } from "effect";
import { Temporal } from "temporal-polyfill";
import type { CollectionId } from "#src/domain/ids.ts";
import type {
	CollectionPropertyChanges,
	CollectionRepositoryShape,
	CollectionRow,
	NewCollection,
} from "#src/services/collection/repository.ts";
import { DEFAULT_SORT_ORDER } from "#src/services/collection/sort-order.ts";
import { allCollections, type TestStores } from "./stores.ts";

// ---------------------------------------------------------------------------
// In-memory CollectionRepository
// ---------------------------------------------------------------------------

// The collection with this id, only while it is not soft-deleted
const findLive = (
	stores: TestStores,
	id: string,
): CollectionRow | undefined => {
	const row = stores.collections.get(id);
	return row && row.deletedAt === null ? row : undefined;
};

// The collection with this id, only once it has been soft-deleted
const findDeleted = (
	stores: TestStores,
	id: string,
): CollectionRow | undefined => {
	const row = stores.collections.get(id);
	return row && row.deletedAt !== null ? row : undefined;
};

// Live collections owned by someone else that grant one of these privileges to
// one of these principals
const sharedCollections = (
	stores: TestStores,
	principalIds: ReadonlyArray<string>,
	privileges: ReadonlyArray<string>,
): ReadonlyArray<CollectionRow> => {
	const idSet = new Set<string>(principalIds);
	const privSet = new Set<string>(privileges);
	return allCollections(stores).filter(
		(c) =>
			c.deletedAt === null &&
			!idSet.has(c.ownerPrincipalId) &&
			(stores.acl.get(c.id) ?? []).some(
				(a) =>
					a.resourceType === "collection" &&
					a.principalType === "principal" &&
					a.grantDeny === "grant" &&
					a.principalId !== null &&
					idSet.has(a.principalId) &&
					privSet.has(a.privilege),
			),
	);
};

export const makeCollectionRepo = (
	stores: TestStores,
): CollectionRepositoryShape => ({
	findById: (id) => Effect.succeed(Option.fromNullishOr(findLive(stores, id))),

	findByIds: (ids) =>
		Effect.sync(() => {
			const map = new Map<CollectionId, CollectionRow>();
			for (const id of ids) {
				const row = stores.collections.get(id);
				if (row !== undefined && row.deletedAt === null) {
					map.set(id, row);
				}
			}
			return map;
		}),

	findDeletedById: (id) =>
		Effect.succeed(Option.fromNullishOr(findDeleted(stores, id))),

	findBySlug: (ownerPrincipalId, collectionType, slug) =>
		Effect.succeed(
			Option.fromNullishOr(
				allCollections(stores).find(
					(c) =>
						c.ownerPrincipalId === ownerPrincipalId &&
						c.collectionType === collectionType &&
						c.slug === slug &&
						c.deletedAt === null,
				),
			),
		),

	listByOwner: (ownerPrincipalId) =>
		Effect.succeed(
			allCollections(stores)
				.filter(
					(c) =>
						c.ownerPrincipalId === ownerPrincipalId && c.deletedAt === null,
				)
				.sort((a, b) =>
					a.sortOrder !== b.sortOrder
						? a.sortOrder - b.sortOrder
						: a.id < b.id
							? -1
							: a.id > b.id
								? 1
								: 0,
				),
		),

	listDeletedByOwner: (ownerPrincipalId) =>
		Effect.succeed(
			allCollections(stores).filter(
				(c) => c.ownerPrincipalId === ownerPrincipalId && c.deletedAt !== null,
			),
		),

	listDeletedOlderThan: (cutoff) =>
		Effect.succeed(
			allCollections(stores).filter(
				(c) =>
					c.deletedAt !== null &&
					Temporal.Instant.compare(c.deletedAt, cutoff) < 0,
			),
		),

	listByAutoManagedKind: (kind) =>
		Effect.succeed(
			allCollections(stores).filter(
				(c) => c.autoManagedKind === kind && c.deletedAt === null,
			),
		),

	listSharedWithPrincipals: (principalIds, privileges) =>
		Effect.succeed(sharedCollections(stores, principalIds, privileges)),

	insert: (input: NewCollection) =>
		Effect.sync(() => {
			const now = Temporal.Now.instant();
			const row: CollectionRow = {
				id: crypto.randomUUID(),
				ownerPrincipalId: input.ownerPrincipalId,
				collectionType: input.collectionType,
				displayName: input.displayName ?? null,
				description: input.description ?? null,
				timezoneTzid: input.timezoneTzid ?? null,
				synctoken: 0,
				updatedAt: now,
				deletedAt: null,
				supportedComponents: input.supportedComponents ?? null,
				slug: input.slug,
				parentCollectionId: input.parentCollectionId ?? null,
				clientProperties: {},
				maxResourceSize: null,
				minDateTime: null,
				maxDateTime: null,
				maxInstances: null,
				maxAttendeesPerInstance: null,
				scheduleTransp: "opaque",
				scheduleDefaultCalendarId: null,
				autoManagedKind: input.autoManagedKind ?? null,
				sortOrder:
					input.sortOrder ??
					(input.autoManagedKind != null
						? DEFAULT_SORT_ORDER.generated
						: DEFAULT_SORT_ORDER.normal),
			};
			stores.collections.set(row.id, row);
			return row;
		}),

	softDelete: (id) =>
		Effect.sync(() => {
			const row = stores.collections.get(id);
			if (!row) {
				throw new Error(`Collection not found for deletion: ${id}`);
			}
			const deleted = { ...row, deletedAt: Temporal.Now.instant() };
			stores.collections.set(id, deleted);
			return deleted;
		}),

	restore: (id) =>
		Effect.sync(() => {
			const row = stores.collections.get(id);
			if (!row || row.deletedAt === null) {
				throw new Error(`Collection not found for restore: ${id}`);
			}
			const restored = { ...row, deletedAt: null };
			stores.collections.set(id, restored);
			return restored;
		}),

	hardDelete: (id) =>
		Effect.sync(() => {
			for (const [instanceId, instance] of stores.instances) {
				if (instance.collectionId === id) {
					stores.instances.delete(instanceId);
				}
			}
			stores.collections.delete(id);
		}),

	relocate: (id, targetOwnerPrincipalId, targetSlug) =>
		Effect.sync(() => {
			const row = stores.collections.get(id);
			if (!row || row.deletedAt !== null) {
				throw new Error(`Collection not found for relocation: ${id}`);
			}
			const updated = {
				...row,
				ownerPrincipalId: targetOwnerPrincipalId,
				slug: targetSlug,
				updatedAt: Temporal.Now.instant(),
			};
			stores.collections.set(id, updated);
			return updated;
		}),

	updateProperties: (id, changes: CollectionPropertyChanges) =>
		Effect.sync(() => {
			const row = stores.collections.get(id);
			if (!row || row.deletedAt !== null) {
				throw new Error(`Collection not found for property update: ${id}`);
			}
			const updated: CollectionRow = {
				...row,
				clientProperties: changes.clientProperties,
				...(changes.displayName !== undefined
					? { displayName: changes.displayName }
					: {}),
				...(changes.description !== undefined
					? { description: changes.description }
					: {}),
				...(changes.sortOrder !== undefined
					? { sortOrder: changes.sortOrder }
					: {}),
				updatedAt: Temporal.Now.instant(),
			};
			stores.collections.set(id, updated);
			return updated;
		}),

	reorder: (changes) =>
		Effect.sync(() => {
			for (const [id, sortOrder] of changes) {
				const row = stores.collections.get(id);
				if (row && row.deletedAt === null) {
					stores.collections.set(id, {
						...row,
						sortOrder,
						updatedAt: Temporal.Now.instant(),
					});
				}
			}
		}),
});
