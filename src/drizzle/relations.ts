import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
	authUser: {
		user: r.one.user({
			from: r.authUser.userId,
			to: r.user.id,
		}),
	},
	user: {
		authUsers: r.many.authUser(),
		groups: r.many.group(),
		principal: r.one.principal({
			from: r.user.principalId,
			to: r.principal.id,
		}),
	},
	davComponent: {
		davEntitiesViaCalIndex: r.many.davEntity({
			from: r.davComponent.id.through(r.calIndex.componentId),
			to: r.davEntity.id.through(r.calIndex.entityId),
			alias: "davComponent_id_davEntity_id_via_calIndex",
		}),
		davEntitiesViaDavComponent: r.many.davEntity({
			alias: "davEntity_id_davComponent_id_via_davComponent",
		}),
		davProperties: r.many.davProperty(),
	},
	davEntity: {
		davComponentsViaCalIndex: r.many.davComponent({
			alias: "davComponent_id_davEntity_id_via_calIndex",
		}),
		cardIndices: r.many.cardIndex(),
		davComponentsViaDavComponent: r.many.davComponent({
			from: r.davEntity.id.through(r.davComponent.entityId),
			to: r.davComponent.id.through(r.davComponent.parentComponentId),
			alias: "davEntity_id_davComponent_id_via_davComponent",
		}),
		davCollectionsViaDavInstance: r.many.davCollection({
			alias: "davCollection_id_davEntity_id_via_davInstance",
		}),
		davInstances: r.many.davInstance({
			from: r.davEntity.id.through(r.davShadow.entityId),
			to: r.davInstance.id.through(r.davShadow.instanceId),
		}),
		davCollectionsViaDavTombstone: r.many.davCollection({
			alias: "davCollection_id_davEntity_id_via_davTombstone",
		}),
	},
	cardIndex: {
		davEntity: r.one.davEntity({
			from: r.cardIndex.entityId,
			to: r.davEntity.id,
		}),
	},
	principal: {
		davCollections: r.many.davCollection({
			from: r.principal.id.through(r.davCollection.ownerPrincipalId),
			to: r.davCollection.id.through(r.davCollection.parentCollectionId),
		}),
		groupNames: r.many.groupName({
			from: r.principal.id.through(r.group.principalId),
			to: r.groupName.id.through(r.group.primaryName),
		}),
		users: r.many.user(),
	},
	davCollection: {
		principals: r.many.principal(),
		davEntitiesViaDavInstance: r.many.davEntity({
			from: r.davCollection.id.through(r.davInstance.collectionId),
			to: r.davEntity.id.through(r.davInstance.entityId),
			alias: "davCollection_id_davEntity_id_via_davInstance",
		}),
		davScheduleMessages: r.many.davScheduleMessage(),
		davEntitiesViaDavTombstone: r.many.davEntity({
			from: r.davCollection.id.through(r.davTombstone.collectionId),
			to: r.davEntity.id.through(r.davTombstone.entityId),
			alias: "davCollection_id_davEntity_id_via_davTombstone",
		}),
	},
	davParameter: {
		davProperty: r.one.davProperty({
			from: r.davParameter.propertyId,
			to: r.davProperty.id,
		}),
	},
	davProperty: {
		davParameters: r.many.davParameter(),
		davComponent: r.one.davComponent({
			from: r.davProperty.componentId,
			to: r.davComponent.id,
		}),
	},
	davScheduleMessage: {
		davCollection: r.one.davCollection({
			from: r.davScheduleMessage.collectionId,
			to: r.davCollection.id,
		}),
	},
	davInstance: {
		davEntities: r.many.davEntity(),
	},
	groupName: {
		principals: r.many.principal(),
		group: r.one.group({
			from: r.groupName.groupId,
			to: r.group.id,
		}),
	},
	group: {
		groupNames: r.many.groupName(),
		users: r.many.user({
			from: r.group.id.through(r.membership.groupId),
			to: r.user.id.through(r.membership.userId),
		}),
	},
}));
