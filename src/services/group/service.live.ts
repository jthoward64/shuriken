import { Effect, Layer } from "effect";
import { someOrNotFound } from "#src/domain/errors.ts";
import type { GroupId, PrincipalId, UserId } from "#src/domain/ids.ts";
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
				yield* Effect.annotateCurrentSpan({ "group.slug": input.slug });
				yield* Effect.logTrace("group.create", { slug: input.slug });
				const result = yield* repo.create(input);
				yield* Effect.logDebug("group.create: created", {
					groupId: result.group.id,
				});
				return result;
			}),

			findById: Effect.fn("GroupService.findById")(function* (id: GroupId) {
				yield* Effect.annotateCurrentSpan({ "group.id": id });
				yield* Effect.logTrace("group.findById", { id });
				const result = yield* repo
					.findById(id)
					.pipe(Effect.flatMap(someOrNotFound(`Group not found: ${id}`)));
				yield* Effect.logTrace("group.findById result", {
					groupId: result.group.id,
				});
				return result;
			}),

			findByPrincipalId: Effect.fn("GroupService.findByPrincipalId")(function* (
				principalId: PrincipalId,
			) {
				yield* Effect.annotateCurrentSpan({ "group.principalId": principalId });
				yield* Effect.logTrace("group.findByPrincipalId", { principalId });
				const result = yield* repo
					.findByPrincipalId(principalId)
					.pipe(
						Effect.flatMap(someOrNotFound(`Group not found: ${principalId}`)),
					);
				yield* Effect.logTrace("group.findByPrincipalId result", {
					groupId: result.group.id,
				});
				return result;
			}),

			findBySlug: Effect.fn("GroupService.findBySlug")(function* (slug) {
				yield* Effect.annotateCurrentSpan({ "group.slug": slug });
				yield* Effect.logTrace("group.findBySlug", { slug });
				const result = yield* repo
					.findBySlug(slug)
					.pipe(Effect.flatMap(someOrNotFound(`Group not found: ${slug}`)));
				yield* Effect.logTrace("group.findBySlug result", {
					groupId: result.group.id,
				});
				return result;
			}),

			list: Effect.fn("GroupService.list")(function* () {
				yield* Effect.logTrace("group.list");
				const results = yield* repo.list();
				yield* Effect.logTrace("group.list result", { count: results.length });
				return results;
			}),

			listMembers: Effect.fn("GroupService.listMembers")(function* (
				groupId: GroupId,
			) {
				yield* Effect.annotateCurrentSpan({ "group.id": groupId });
				yield* Effect.logTrace("group.listMembers", { groupId });
				yield* repo
					.findById(groupId)
					.pipe(Effect.flatMap(someOrNotFound(`Group not found: ${groupId}`)));
				const results = yield* repo.listMembers(groupId);
				yield* Effect.logTrace("group.listMembers result", {
					count: results.length,
				});
				return results;
			}),

			listByMember: Effect.fn("GroupService.listByMember")(function* (
				userId: UserId,
			) {
				yield* Effect.annotateCurrentSpan({ "user.id": userId });
				yield* Effect.logTrace("group.listByMember", { userId });
				const results = yield* repo.listByMember(userId);
				yield* Effect.logTrace("group.listByMember result", {
					count: results.length,
				});
				return results;
			}),

			update: Effect.fn("GroupService.update")(function* (
				id: GroupId,
				input: UpdateGroup,
			) {
				yield* Effect.annotateCurrentSpan({ "group.id": id });
				yield* Effect.logTrace("group.update", { id });
				yield* repo
					.findById(id)
					.pipe(Effect.flatMap(someOrNotFound(`Group not found: ${id}`)));
				const result = yield* repo.update(id, input);
				yield* Effect.logTrace("group.update done", { id });
				return result;
			}),

			addMember: Effect.fn("GroupService.addMember")(function* (
				groupId: GroupId,
				userId: UserId,
			) {
				yield* Effect.annotateCurrentSpan({
					"group.id": groupId,
					"user.id": userId,
				});
				yield* Effect.logTrace("group.addMember", { groupId, userId });
				const result = yield* repo.findById(groupId).pipe(
					Effect.flatMap(someOrNotFound(`Group not found: ${groupId}`)),
					Effect.flatMap(() => repo.addMember(groupId, userId)),
				);
				yield* Effect.logTrace("group.addMember done", { groupId, userId });
				return result;
			}),

			removeMember: Effect.fn("GroupService.removeMember")(function* (
				groupId: GroupId,
				userId: UserId,
			) {
				yield* Effect.annotateCurrentSpan({
					"group.id": groupId,
					"user.id": userId,
				});
				yield* Effect.logTrace("group.removeMember", { groupId, userId });
				const result = yield* repo.findById(groupId).pipe(
					Effect.flatMap(someOrNotFound(`Group not found: ${groupId}`)),
					Effect.flatMap(() => repo.removeMember(groupId, userId)),
				);
				yield* Effect.logTrace("group.removeMember done", { groupId, userId });
				return result;
			}),

			delete: Effect.fn("GroupService.delete")(function* (id: GroupId) {
				yield* Effect.annotateCurrentSpan({ "group.id": id });
				yield* Effect.logTrace("group.delete", { id });
				yield* repo
					.findById(id)
					.pipe(Effect.flatMap(someOrNotFound(`Group not found: ${id}`)));
				yield* repo.softDelete(id);
				yield* Effect.logDebug("group.delete: deleted", { id });
			}),

			setMembers: Effect.fn("GroupService.setMembers")(function* (
				groupId: GroupId,
				userIds: ReadonlyArray<UserId>,
			) {
				yield* Effect.annotateCurrentSpan({
					"group.id": groupId,
					"group.member_count": userIds.length,
				});
				yield* Effect.logTrace("group.setMembers", {
					groupId,
					count: userIds.length,
				});
				yield* repo
					.findById(groupId)
					.pipe(Effect.flatMap(someOrNotFound(`Group not found: ${groupId}`)));
				yield* repo.setMembers(groupId, userIds);
				yield* Effect.logTrace("group.setMembers done", { groupId });
			}),
		});
	}),
);
