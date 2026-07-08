import { Effect } from "effect";
import type { DatabaseError } from "#src/domain/errors.ts";
import {
	CollectionId,
	type PrincipalId,
	type UuidString,
} from "#src/domain/ids.ts";
import type {
	AuthenticatedPrincipal,
	DavPrivilege,
} from "#src/domain/types/dav.ts";
import { SHARED_READ_PRIVILEGES } from "#src/services/acl/read-privileges.ts";
import { AclRepository } from "#src/services/acl/repository.ts";
import { AclService } from "#src/services/acl/service.ts";
import {
	CollectionRepository,
	type CollectionRow,
	type CollectionType,
} from "#src/services/collection/repository.ts";
import { PrincipalRepository } from "#src/services/principal/repository.ts";

// ---------------------------------------------------------------------------
// listOwnedAndShared — the merged sidebar listing behind the Calendar and
// Contacts pages. Unions a principal's own collections with collections
// another principal (or one of their groups) has granted them, so shared
// calendars/address books show up alongside owned ones instead of only being
// discoverable from a separate page.
// ---------------------------------------------------------------------------

const WRITE_PRIVILEGES = new Set(["DAV:write-content", "DAV:bind", "DAV:all"]);

export interface CollectionWithSharing {
	readonly row: CollectionRow;
	/** null when the caller owns this collection. */
	readonly ownerSlug: string | null;
	readonly writable: boolean;
}

export const listOwnedAndShared = (
	principal: AuthenticatedPrincipal,
	collectionType: CollectionType,
): Effect.Effect<
	ReadonlyArray<CollectionWithSharing>,
	DatabaseError,
	AclRepository | AclService | CollectionRepository | PrincipalRepository
> =>
	Effect.gen(function* () {
		const aclRepo = yield* AclRepository;
		const aclService = yield* AclService;
		const collRepo = yield* CollectionRepository;
		const principalRepo = yield* PrincipalRepository;

		const groupIds = yield* aclRepo.getGroupPrincipalIds(principal.principalId);
		const principalSet: ReadonlyArray<PrincipalId> = [
			principal.principalId,
			...groupIds,
		];

		const [ownedAll, sharedAll] = yield* Effect.all(
			[
				collRepo.listByOwner(principal.principalId),
				collRepo.listSharedWithPrincipals(principalSet, SHARED_READ_PRIVILEGES),
			],
			{ concurrency: "unbounded" },
		);

		const owned = ownedAll.filter(
			(c) => c.collectionType === collectionType && c.deletedAt === null,
		);
		const shared = sharedAll.filter(
			(c) => c.collectionType === collectionType && c.deletedAt === null,
		);

		const ownedResults: ReadonlyArray<CollectionWithSharing> = owned.map(
			(row) => ({ row, ownerSlug: null, writable: true }),
		);

		// Skip the owner-slug and privilege lookups entirely when nothing is
		// shared — the common case, and avoids two round trips per page load.
		if (shared.length === 0) {
			return ownedResults;
		}

		const ownerIds = [...new Set(shared.map((c) => c.ownerPrincipalId))].map(
			(id) => id as PrincipalId,
		);
		const [owners, writableByCollectionId] = yield* Effect.all(
			[
				principalRepo.findPrincipalByIds(ownerIds),
				aclService.batchCurrentUserPrivileges(
					principal.principalId,
					shared.map((c) => CollectionId(c.id as UuidString)),
					"collection",
				),
			],
			{ concurrency: "unbounded" },
		);

		const sharedResults: Array<CollectionWithSharing> = shared.map((row) => {
			const ownerRow = owners.get(row.ownerPrincipalId as PrincipalId);
			const privileges: ReadonlyArray<DavPrivilege> =
				writableByCollectionId.get(CollectionId(row.id as UuidString)) ?? [];
			return {
				row,
				ownerSlug: ownerRow?.slug ?? row.ownerPrincipalId,
				writable: privileges.some((p) => WRITE_PRIVILEGES.has(p)),
			};
		});
		sharedResults.sort((a, b) =>
			(a.row.displayName ?? a.row.slug).localeCompare(
				b.row.displayName ?? b.row.slug,
			),
		);

		return [...ownedResults, ...sharedResults];
	});
