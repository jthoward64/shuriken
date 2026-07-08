// ---------------------------------------------------------------------------
// Sharing beyond group ACLs: direct individual-to-individual calendar
// shares, and public multi-calendar share links.
// ---------------------------------------------------------------------------

import { Effect } from "effect";
import type { CollectionId } from "#src/domain/ids.ts";
import { AclRepository } from "#src/services/acl/repository.ts";
import { ShareLinkService } from "#src/services/share-link/service.ts";
import { chance, intBetween, pick, sampleDistinct } from "./random.ts";
import type { SeededUser } from "./users.ts";

const MIN_DIRECT_SHARE_TARGETS = 1;
const MAX_DIRECT_SHARE_TARGETS = 3;
const DIRECT_SHARE_WRITE_PROBABILITY = 0.3;
const ACL_ORDINAL = 0;
const SHARE_LINK_VISIBILITIES = ["all", "limited", "free_busy"] as const;
const MIN_SHARE_LINK_CALENDARS = 1;

/**
 * Grant 1-3 other random users direct (non-group) ACL access to one of a
 * user's non-primary calendars — the individual-principal sharing path
 * CalDAV clients use, distinct from the group-ACL sharing in groups.ts.
 */
export const seedDirectShare = (
	owner: SeededUser,
	allUsers: ReadonlyArray<SeededUser>,
) =>
	Effect.gen(function* () {
		const acl = yield* AclRepository;
		const shareable = owner.calendarIds.slice(1);
		if (shareable.length === 0) {
			return;
		}
		const calendarId = pick(shareable) as CollectionId;
		const otherUsers = allUsers.filter((u) => u.userId !== owner.userId);
		const targets = sampleDistinct(
			otherUsers,
			intBetween(MIN_DIRECT_SHARE_TARGETS, MAX_DIRECT_SHARE_TARGETS),
		);
		const allowWrite = chance(DIRECT_SHARE_WRITE_PROBABILITY);
		for (const target of targets) {
			yield* acl.grantAce({
				resourceType: "collection",
				resourceId: calendarId,
				principalType: "principal",
				principalId: target.principalId,
				privilege: allowWrite ? "DAV:write" : "DAV:read",
				grantDeny: "grant",
				protected: false,
				ordinal: ACL_ORDINAL,
			});
		}
	});

/**
 * Create one public share link covering 1..all of a user's calendars, each
 * with its own randomized visibility.
 */
export const seedShareLink = (owner: SeededUser) =>
	Effect.gen(function* () {
		const shareLinks = yield* ShareLinkService;
		const calendarCount = intBetween(
			MIN_SHARE_LINK_CALENDARS,
			owner.calendarIds.length,
		);
		const calendars = sampleDistinct(owner.calendarIds, calendarCount).map(
			(calendarId) => ({
				calendarId,
				visibility: pick(SHARE_LINK_VISIBILITIES),
			}),
		);
		yield* shareLinks.create(
			{ userId: owner.userId, principalId: owner.principalId },
			{ displayName: `${owner.displayName}'s Feed`, calendars },
		);
	});
