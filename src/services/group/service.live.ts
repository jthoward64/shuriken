import { Effect, Layer } from "effect";
import { noneOrConflict, someOrNotFound } from "#src/domain/errors.ts";
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
			create: (input: NewGroup) =>
				repo.findByName(input.primaryName).pipe(
					Effect.flatMap(
						noneOrConflict(
							undefined,
							`Group name already exists: ${input.primaryName}`,
						),
					),
					Effect.flatMap(() => repo.create(input)),
				),

			update: (id: GroupId, input: UpdateGroup) =>
				Effect.gen(function* () {
					yield* repo
						.findById(id)
						.pipe(Effect.flatMap(someOrNotFound(`Group not found: ${id}`)));

					if (input.primaryName !== undefined) {
						yield* repo
							.findByName(input.primaryName)
							.pipe(
								Effect.flatMap(
									noneOrConflict(
										undefined,
										`Group name already exists: ${input.primaryName}`,
									),
								),
							);
					}

					return yield* repo.update(id, input);
				}),

			addMember: (groupId: GroupId, userId: UserId) =>
				repo.findById(groupId).pipe(
					Effect.flatMap(someOrNotFound(`Group not found: ${groupId}`)),
					Effect.flatMap(() => repo.addMember(groupId, userId)),
				),

			removeMember: (groupId: GroupId, userId: UserId) =>
				repo.findById(groupId).pipe(
					Effect.flatMap(someOrNotFound(`Group not found: ${groupId}`)),
					Effect.flatMap(() => repo.removeMember(groupId, userId)),
				),
		});
	}),
);
