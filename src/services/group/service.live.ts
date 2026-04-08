import { Effect, Layer } from "effect";
import { someOrNotFound } from "#src/domain/errors.ts";
import type { GroupId, UserId } from "#src/domain/ids.ts";
import { GroupRepository } from "./repository.ts";
import { GroupService, type NewGroup, type UpdateGroup } from "./service.ts";

// ---------------------------------------------------------------------------
// GroupService — live implementation
// ---------------------------------------------------------------------------

export const GroupServiceLive = Layer.effect(
	GroupService,
	Effect.gen(function* () {
		const repo = yield* GroupRepository;

		return GroupService.of({
			create: Effect.fn("GroupService.create")(function* (input: NewGroup) {
				yield* Effect.logTrace("group.create", { slug: input.slug });
				return yield* repo.create(input);
			}),

			findById: Effect.fn("GroupService.findById")(function* (id: GroupId) {
				yield* Effect.logTrace("group.findById", { id });
				return yield* repo
					.findById(id)
					.pipe(Effect.flatMap(someOrNotFound(`Group not found: ${id}`)));
			}),

			list: Effect.fn("GroupService.list")(function* () {
				yield* Effect.logTrace("group.list");
				return yield* repo.list();
			}),

			listMembers: Effect.fn("GroupService.listMembers")(function* (
				groupId: GroupId,
			) {
				yield* Effect.logTrace("group.listMembers", { groupId });
				yield* repo
					.findById(groupId)
					.pipe(Effect.flatMap(someOrNotFound(`Group not found: ${groupId}`)));
				return yield* repo.listMembers(groupId);
			}),

			listByMember: Effect.fn("GroupService.listByMember")(function* (
				userId: UserId,
			) {
				yield* Effect.logTrace("group.listByMember", { userId });
				return yield* repo.listByMember(userId);
			}),

			update: Effect.fn("GroupService.update")(function* (
				id: GroupId,
				input: UpdateGroup,
			) {
				yield* Effect.logTrace("group.update", { id });
				yield* repo
					.findById(id)
					.pipe(Effect.flatMap(someOrNotFound(`Group not found: ${id}`)));
				return yield* repo.update(id, input);
			}),

			addMember: Effect.fn("GroupService.addMember")(function* (
				groupId: GroupId,
				userId: UserId,
			) {
				yield* Effect.logTrace("group.addMember", { groupId, userId });
				return yield* repo.findById(groupId).pipe(
					Effect.flatMap(someOrNotFound(`Group not found: ${groupId}`)),
					Effect.flatMap(() => repo.addMember(groupId, userId)),
				);
			}),

			removeMember: Effect.fn("GroupService.removeMember")(function* (
				groupId: GroupId,
				userId: UserId,
			) {
				yield* Effect.logTrace("group.removeMember", { groupId, userId });
				return yield* repo.findById(groupId).pipe(
					Effect.flatMap(someOrNotFound(`Group not found: ${groupId}`)),
					Effect.flatMap(() => repo.removeMember(groupId, userId)),
				);
			}),

			delete: Effect.fn("GroupService.delete")(function* (id: GroupId) {
				yield* Effect.logTrace("group.delete", { id });
				yield* repo
					.findById(id)
					.pipe(Effect.flatMap(someOrNotFound(`Group not found: ${id}`)));
				yield* repo.softDelete(id);
			}),

			setMembers: Effect.fn("GroupService.setMembers")(function* (
				groupId: GroupId,
				userIds: ReadonlyArray<UserId>,
			) {
				yield* Effect.logTrace("group.setMembers", {
					groupId,
					count: userIds.length,
				});
				yield* repo
					.findById(groupId)
					.pipe(Effect.flatMap(someOrNotFound(`Group not found: ${groupId}`)));
				yield* repo.setMembers(groupId, userIds);
			}),
		});
	}),
);
