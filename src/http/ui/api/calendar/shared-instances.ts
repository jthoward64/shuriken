import { Effect } from "effect";
import { Temporal } from "temporal-polyfill";
import type { DatabaseError } from "#src/domain/errors.ts";
import type { PrincipalId } from "#src/domain/ids.ts";
import type { AuthenticatedPrincipal } from "#src/domain/types/dav.ts";
import { SHARED_READ_PRIVILEGES } from "#src/services/acl/read-privileges.ts";
import { AclRepository } from "#src/services/acl/repository.ts";
import {
	InstanceRepository,
	type InstanceRow,
} from "#src/services/instance/repository.ts";
import type { CalendarEventView } from "./collect-events.ts";

// ---------------------------------------------------------------------------
// Individually-shared event instances — events granted directly to a
// principal (or one of their groups) without sharing the whole calendar. The
// calendar sidebar surfaces these as a synthetic "Shared events" pseudo-
// calendar (id "shared-events", not backed by any dav_collection row).
//
// `InstanceRepository.listSharedWithPrincipals` only excludes instances whose
// parent collection the caller *owns* — it doesn't know about collections
// shared as a whole, so callers must additionally exclude any instance whose
// `collectionId` is already covered by an owned/shared collection (otherwise
// the event would double-appear: once via its calendar's normal feed, once
// via this synthetic one).
// ---------------------------------------------------------------------------

/** Individually-shared VEVENT instances not already covered by an
 * owned/shared collection. No component-tree load — cheap enough to use for
 * an unscoped "does the synthetic calendar exist at all" check. */
export const findUncoveredSharedInstances = (
	principal: AuthenticatedPrincipal,
	coveredCollectionIds: ReadonlySet<string>,
): Effect.Effect<
	ReadonlyArray<InstanceRow>,
	DatabaseError,
	AclRepository | InstanceRepository
> =>
	Effect.gen(function* () {
		const aclRepo = yield* AclRepository;
		const instRepo = yield* InstanceRepository;

		const groupIds = yield* aclRepo.getGroupPrincipalIds(principal.principalId);
		const principalSet: ReadonlyArray<PrincipalId> = [
			principal.principalId,
			...groupIds,
		];

		const shared = yield* instRepo.listSharedWithPrincipals(
			principalSet,
			SHARED_READ_PRIVILEGES,
		);
		return shared.filter((i) => !coveredCollectionIds.has(i.collectionId));
	});

const overlapsRange = (
	ev: CalendarEventView,
	rangeStart: Temporal.Instant | null,
	rangeEnd: Temporal.Instant | null,
): boolean => {
	if (rangeStart === null || rangeEnd === null) {
		return true;
	}
	try {
		const start = ev.allDay
			? Temporal.PlainDate.from(ev.start).toZonedDateTime("UTC").toInstant()
			: Temporal.PlainDateTime.from(ev.start)
					.toZonedDateTime("UTC")
					.toInstant();
		const end =
			ev.end === null
				? start
				: ev.allDay
					? Temporal.PlainDate.from(ev.end).toZonedDateTime("UTC").toInstant()
					: Temporal.PlainDateTime.from(ev.end)
							.toZonedDateTime("UTC")
							.toInstant();
		return (
			Temporal.Instant.compare(start, rangeEnd) < 0 &&
			Temporal.Instant.compare(end, rangeStart) >= 0
		);
	} catch {
		return true;
	}
};

/** Filter already-hydrated {@link CalendarEventView}s to the given range.
 * Volumes here are expected to be small (individual-event ACL grants are a
 * rare, manual action), so an in-memory filter after loading full component
 * trees is acceptable rather than a dedicated index-backed range query. */
export const filterViewsByRange = (
	views: ReadonlyArray<CalendarEventView>,
	rangeStart: Temporal.Instant | null,
	rangeEnd: Temporal.Instant | null,
): ReadonlyArray<CalendarEventView> =>
	views.filter((ev) => overlapsRange(ev, rangeStart, rangeEnd));
