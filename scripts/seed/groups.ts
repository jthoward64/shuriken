// ---------------------------------------------------------------------------
// Groups, membership, and the "member-owned + group-ACL" shared-calendar
// pattern that's the one true group-sharing model this app exposes over DAV
// (see plan notes — nothing routes a group principal's own calendar-home).
// ---------------------------------------------------------------------------

import { faker } from "@faker-js/faker";
import { Effect } from "effect";
import type { CollectionId, GroupId, PrincipalId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import {
	AclRepository,
	type AclRepositoryShape,
} from "#src/services/acl/repository.ts";
import { CollectionService } from "#src/services/collection/index.ts";
import { GroupService } from "#src/services/group/index.ts";
import { seedEvents } from "./events.ts";
import { sampleDistinct } from "./random.ts";
import type { SeededUser } from "./users.ts";

const WRITE_ACCESS_MAX_GROUP_SIZE = 40;
const MIN_SHARED_CALENDAR_EVENTS = 20;
const MAX_SHARED_CALENDAR_EVENTS = 50;
const SMALL_GROUP_ADDRESSBOOK_COUNT = 5;
const ACL_ORDINAL_STEP = 10;

export interface GroupSizeSpec {
	readonly min: number;
	readonly max: number;
}

/** One entry per group to create, in creation order. */
export const buildGroupSizePlan = (
	small: number,
	medium: number,
	large: number,
): Array<GroupSizeSpec> => [
	...Array.from({ length: small }, () => ({ min: 1, max: 3 })),
	...Array.from({ length: medium }, () => ({ min: 20, max: 40 })),
	...Array.from({ length: large }, () => ({ min: 50, max: 80 })),
];

export interface SeededGroup {
	readonly groupId: GroupId;
	readonly principalId: PrincipalId;
	readonly memberEmails: ReadonlyArray<string>;
}

/**
 * Create one group, assign it randomly sampled members, and — for a
 * "handful" of groups (every medium/large group, plus the first few small
 * ones) — give one member-owned calendar (and, for a further subset, an
 * addressbook) a group-principal ACL grant so the shared-collection paths
 * get real coverage.
 */
export const seedGroup = (
	index: number,
	size: number,
	shouldGetAddressbook: boolean,
	batchSize: number,
	users: ReadonlyArray<SeededUser>,
) =>
	Effect.gen(function* () {
		const groups = yield* GroupService;
		const acl = yield* AclRepository;
		const collections = yield* CollectionService;

		const groupSlug = Slug(`group-${index}`);
		const displayName = `${faker.commerce.department()} Team ${index}`;
		const created = yield* groups.create({ slug: groupSlug, displayName });
		const groupId = created.group.id as GroupId;
		const principalId = created.principal.id as PrincipalId;

		const members = sampleDistinct(users, size);
		yield* groups.setMembers(
			groupId,
			members.map((m) => m.userId),
		);

		const owner = members[0];
		if (!owner) {
			return {
				groupId,
				principalId,
				memberEmails: [],
			} satisfies SeededGroup;
		}

		const sharedCalendar = yield* collections.create({
			ownerPrincipalId: owner.principalId,
			collectionType: "calendar",
			slug: Slug(`${groupSlug}-shared-cal`),
			displayName: `${displayName} Calendar`,
			supportedComponents: ["VEVENT"],
		});
		yield* grantGroupAce(
			acl,
			sharedCalendar.id as CollectionId,
			principalId,
			size <= WRITE_ACCESS_MAX_GROUP_SIZE,
		);

		const memberEmails = members.map((m) => m.email);
		const eventCount = Math.floor(
			MIN_SHARED_CALENDAR_EVENTS +
				Math.random() *
					(MAX_SHARED_CALENDAR_EVENTS - MIN_SHARED_CALENDAR_EVENTS),
		);
		yield* seedEvents(
			sharedCalendar.id as CollectionId,
			eventCount,
			batchSize,
			memberEmails,
		);

		if (shouldGetAddressbook) {
			const sharedAddressBook = yield* collections.create({
				ownerPrincipalId: owner.principalId,
				collectionType: "addressbook",
				slug: Slug(`${groupSlug}-shared-ab`),
				displayName: `${displayName} Contacts`,
				supportedComponents: ["VCARD"],
			});
			yield* grantGroupAce(
				acl,
				sharedAddressBook.id as CollectionId,
				principalId,
				size <= WRITE_ACCESS_MAX_GROUP_SIZE,
			);
		}

		return { groupId, principalId, memberEmails } satisfies SeededGroup;
	});

const grantGroupAce = (
	acl: AclRepositoryShape,
	resourceId: CollectionId,
	groupPrincipalId: PrincipalId,
	allowWrite: boolean,
) =>
	Effect.gen(function* () {
		yield* acl.grantAce({
			resourceType: "collection",
			resourceId,
			principalType: "principal",
			principalId: groupPrincipalId,
			privilege: "DAV:read",
			grantDeny: "grant",
			protected: false,
			ordinal: 0,
		});
		if (allowWrite) {
			yield* acl.grantAce({
				resourceType: "collection",
				resourceId,
				principalType: "principal",
				principalId: groupPrincipalId,
				privilege: "DAV:write",
				grantDeny: "grant",
				protected: false,
				ordinal: ACL_ORDINAL_STEP,
			});
		}
	});

/** Whether the group at `index` (0-based, in size-plan order) should also
 * get a shared addressbook: every medium/large group, plus the first
 * `SMALL_GROUP_ADDRESSBOOK_COUNT` small groups. */
export const shouldSeedAddressbook = (
	index: number,
	smallGroupCount: number,
): boolean => index >= smallGroupCount || index < SMALL_GROUP_ADDRESSBOOK_COUNT;
