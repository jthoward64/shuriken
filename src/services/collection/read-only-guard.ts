import { Effect, Option } from "effect";
import type { DatabaseError } from "#src/domain/errors.ts";
import { CollectionId } from "#src/domain/ids.ts";
import type { DavPrivilege } from "#src/domain/types/dav.ts";
import { ExternalCalendarRepository } from "#src/services/external-calendar/repository.ts";
import { CollectionRepository, type CollectionRow } from "./repository.ts";

// ---------------------------------------------------------------------------
// Cross-cutting "is this collection writable by the client?" check.
//
// Two unrelated mechanisms make a collection read-only on the client side:
//
//   * external_calendar_claim — the subscription system owns the event set
//     and would overwrite any client PUT on the next sync.
//   * dav_collection.auto_managed_kind — server-derived calendars (e.g. the
//     birthdays calendar) are reconciled from another source of truth.
//
// Handlers care about the answer, not which mechanism triggered it. The two
// repo lookups run in parallel and short-circuit cheaply.
// ---------------------------------------------------------------------------

/** True iff `auto_managed_kind IS NOT NULL`. Used to block collection-level
 * mutations (DELETE, MOVE, RENAME) that would otherwise leave the server
 * generator without a target to reconcile into.
 */
export const isAutoManagedCollection = (
	id: CollectionId,
): Effect.Effect<boolean, DatabaseError, CollectionRepository> =>
	Effect.gen(function* () {
		const collRepo = yield* CollectionRepository;
		const opt = yield* collRepo.findById(id);
		return Option.isSome(opt) && opt.value.autoManagedKind !== null;
	});

export const isReadOnlyCollection = (
	id: CollectionId,
): Effect.Effect<
	boolean,
	DatabaseError,
	CollectionRepository | ExternalCalendarRepository
> =>
	Effect.gen(function* () {
		const collRepo = yield* CollectionRepository;
		const extRepo = yield* ExternalCalendarRepository;
		const [collOpt, claimOpt] = yield* Effect.all(
			[collRepo.findById(id), extRepo.findClaimByCollection(id)],
			{ concurrency: "unbounded" },
		);
		if (Option.isSome(claimOpt)) {
			return true;
		}
		if (Option.isSome(collOpt) && collOpt.value.autoManagedKind !== null) {
			return true;
		}
		return false;
	});

/** Same predicate as {@link isReadOnlyCollection} but starting from an already
 * loaded collection row. Auto-managed collections short-circuit with no query;
 * only the subscription-claim check touches the database. Used by PROPFIND when
 * enumerating members, where the rows are already in hand.
 */
export const isReadOnlyCollectionRow = (
	row: CollectionRow,
): Effect.Effect<boolean, DatabaseError, ExternalCalendarRepository> =>
	Effect.gen(function* () {
		if (row.autoManagedKind !== null) {
			return true;
		}
		const extRepo = yield* ExternalCalendarRepository;
		const claimOpt = yield* extRepo.findClaimByCollection(CollectionId(row.id));
		return Option.isSome(claimOpt);
	});

// ---------------------------------------------------------------------------
// current-user-privilege-set filtering
//
// The read-only mechanisms above are enforced server-side (PUT/DELETE/MOVE/COPY
// reject writes), but the collection is still *owned* by the caller, so the ACL
// grants full write. Clients decide whether to show a calendar as read-only by
// reading DAV:current-user-privilege-set, so we must also hide the write
// privileges there — otherwise the client offers editing and the PUT 403s.
//
// DAV:write-properties is deliberately KEPT: subscription calendars accept
// PROPPATCH of displayname/calendar-color (stored as per-user overrides) and
// birthdays can be renamed, so property writes remain genuinely available.
// ---------------------------------------------------------------------------

const HIDDEN_WRITE_PRIVILEGES: ReadonlySet<DavPrivilege> =
	new Set<DavPrivilege>([
		"DAV:all",
		"DAV:write",
		"DAV:write-content",
		"DAV:bind",
		"DAV:unbind",
	]);

/** Removes the content/binding write privileges from a privilege list when the
 * collection (or one of its members) is client read-only; a no-op otherwise.
 */
export const applyReadOnlyPrivileges = (
	privileges: ReadonlyArray<DavPrivilege>,
	readOnly: boolean,
): ReadonlyArray<DavPrivilege> =>
	readOnly
		? privileges.filter((p) => !HIDDEN_WRITE_PRIVILEGES.has(p))
		: privileges;
