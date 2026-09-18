import { Effect, Option } from "effect";
import type { IrComponent } from "#src/data/ir.ts";
import { ComponentId, EntityId, InstanceId } from "#src/domain/ids.ts";
import type { ComponentRepositoryShape } from "#src/services/component/repository.ts";
import type {
	EntityRepositoryShape,
	EntityRow,
} from "#src/services/entity/repository.ts";
import { allInstances, type TestStores } from "./stores.ts";

// ---------------------------------------------------------------------------
// In-memory EntityRepository and ComponentRepository
// ---------------------------------------------------------------------------

export const makeEntityRepo = (stores: TestStores): EntityRepositoryShape => ({
	insert: ({ entityType, logicalUid }) =>
		Effect.sync(() => {
			const id = crypto.randomUUID();
			const row: EntityRow = {
				id,
				entityType,
				logicalUid: logicalUid ?? null,
				updatedAt: null as unknown as EntityRow["updatedAt"],
				deletedAt: null,
			};
			stores.entities.set(id, row);
			return row;
		}),

	findById: (id) =>
		Effect.succeed(Option.fromNullishOr(stores.entities.get(id))),

	updateLogicalUid: (id, uid) =>
		Effect.sync(() => {
			const row = stores.entities.get(id);
			if (row) {
				stores.entities.set(id, { ...row, logicalUid: uid });
			}
		}),

	softDelete: (id) =>
		Effect.sync(() => {
			stores.entities.delete(id);
		}),

	existsByUid: (collectionId, logicalUid) =>
		Effect.sync(() =>
			allInstances(stores).some(
				(inst) =>
					inst.collectionId === collectionId &&
					inst.deletedAt === null &&
					stores.entities.get(inst.entityId)?.logicalUid === logicalUid,
			),
		),

	existsByUidForPrincipal: (_principalId, _logicalUid) => Effect.succeed(false),

	listActiveInstancesWithUid: (collectionId) =>
		Effect.succeed(
			allInstances(stores)
				.filter(
					(inst) =>
						inst.collectionId === collectionId && inst.deletedAt === null,
				)
				.map((inst) => ({
					instanceId: InstanceId(inst.id),
					entityId: EntityId(inst.entityId),
					logicalUid: stores.entities.get(inst.entityId)?.logicalUid ?? null,
					etag: inst.etag,
					slug: inst.slug,
				})),
		),
});

export const makeComponentRepo = (
	stores: TestStores,
): ComponentRepositoryShape => ({
	insertTree: (entityId, root) =>
		Effect.sync(() => {
			stores.components.set(entityId, root);
			return ComponentId(crypto.randomUUID());
		}),

	loadTree: (entityId, _entityType) =>
		Effect.succeed(Option.fromNullishOr(stores.components.get(entityId))),

	loadTreesByIds: (entityIds, _entityType) =>
		Effect.sync(() => {
			const map = new Map<EntityId, IrComponent>();
			for (const id of entityIds) {
				const tree = stores.components.get(id);
				if (tree !== undefined) {
					map.set(id, tree);
				}
			}
			return map;
		}),

	deleteByEntity: (entityId) =>
		Effect.sync(() => {
			stores.components.delete(entityId);
		}),
});
